import {
  createDriver,
  LlmConfigurationError,
  resolveLlmConfig,
  runAgent,
  type AgentGoal,
  type ConversationContext as AgentConversationContext,
  type ConversationMessage as AgentConversationMessage,
  type FactRef,
} from '@ui4a/agent';
import {
  CHAT_VIEW_PROTOCOL_VERSION,
  completePresentationRequest,
  parseClientViewReport,
  type ClientViewReport,
  type NavigationCompletion,
} from '@ui4a/shared';

import type {
  ChatTurnDetail,
  ChatTurnProgressDetail,
  ChatTurnStartedDetail,
} from '../../../chat/history';
import { wrapDriverForAudit, type AgentDecisionDetail } from '../../../chat/decisions';
import { conversationView } from '../../../chat/conversation';
import { executionAuditContext } from '../../../chat/audit-context';
import { hasExplicitMetaIntent, resolveStartRel } from '../../../chat/start';
import { stepToMessage, trailToMessages } from '../../../chat/trail';
import { appendEvent, readLog } from '../../../db/events';
import { getDb } from '../../../engine/service';
import {
  getPresentationBroker,
  getPresentationCapabilities,
} from '../../../engine/presentation/runtime';
import { dispatchDelegation } from '../../../temporal/delegation';

// POST /api/chat — 悬浮聊天的合同后端(spec FR6/FR7,arch-brief §8)。
// - 请求 {goal: {verb, targetRel?, resource?, fields?}, sessionId?, driver?,
//   mode?: 'inline'|'delegated'};mode 缺省 inline(既有行为与测试零改动);
// - Presentation(T16):Chat 模型只可调用薄 present(subject,intent,constraints,
//   delivery);route 补 requestId/principal/sourceMessageIds 后异步交给独立 Broker。
//   Chat route 不读取 catalog、Surface Tree、bindings 或 dependencies，也没有展示
//   关键词/业务实体特判；Presentation 失败不改变 Chat outcome。
// - inline(T9 Phase B 起为 SSE 流式,text/event-stream):服务端只组装
//   LLM driver(default/auto 均是 llm),runAgent 循环过本源
//   HTTP 合同(actor=agent,principal=user:<sessionId>,channel=chat)——
//   "agent 走合同"字面成立;onStep 每步推一帧
//   {type:'step', message:{role:'assistant',text}, rel}(text 为 trail.ts
//   stepToMessage 口径);llm 步 decide 产推理自述时先于同号 step 帧推一帧
//   {type:'thinking', turnId, step, text}(T11 Phase C / 架构决定 4:聚合整段权威
//   终帧——D22 GLM reasoning 末尾齐发,非打字机;turnId + step 与对应 step 帧同号,
//   便于客户端归步;端点不返回 reasoning 时零 thinking 帧);
//   增量通道 {type:'thinking-delta', turnId,
//   step, text} 逐 raw chunk 即推(与聚合几乎同刻,管线为真流式就绪),
//   结束推 {type:'final', payload:{sessionId,
//   driver, requestedDriver, outcome, summary, steps, successes}};异常兜底
//   {type:'error', error};客户端断开仅中断推帧,循环照常跑完(留痕);
// - 聊天历史(T9 Phase B):inline 回合完成(含 failed/max-steps)后直写一条
//   chat-turn 事件(rel=chat:<sessionId>,detail 含 goal/outcome/summary/
//   messages/steps/driver——T11 Phase B 起 steps 为结构化 TrailStep[] 原料)
//   ——与 worker 同一双写者模式;engine fold 忽略该 kind
//   (纯审计留痕);落库失败 console.error 不阻断响应。GET /api/chat/history
//   按 sessionId 投影回合序列(服务端零会话态);
// - 决策审计(T11 Phase B / 架构决定 3):inline 路径每步决策直写一条
//   agent-decision 事件(rel/actor/principal/channel 与 chat-turn 同源同值,
//   detail 五要素 step/driver/prompt/reasoning/op——llm 的 prompt 为 system/user
//   全量原文、reasoning 为聚合整段自述(Phase C 起填真值;端点不返回时如实
//   null),
//   先于 chat-turn 落库;engine fold 忽略该 kind(纯留痕,I5 重放 hash 不变),
//   落库失败 console.error 不阻断响应(同 chat-turn 口径);delegated 回合不写
//   agent-decision(轨迹在舰队页);
// - delegated(T5 Phase B / spec 架构决定 5):校验 goal → 解析 startRel 与
//   driverKind(auto 先解析)→ dispatchDelegation 派发 delegationWorkflow
//   (taskQueue ui4a;baseUrl=自身 origin,worker activity 回环走本源合同)→
//   响应 {mode:'delegated', delegationId, statusUrl};派发失败(Temporal 不可达)
//   据实 503——委托没派出去不能假装成功;
// - 起始 rel 由 sitemap 词级交集解析(客户端行为),缺省 articles;
// - 一次性 JSON 仅剩参数错误/delegated；inline 始终使用同一 SSE agent loop。
//   B4:LLM 失败(401 等)如实进入 step 帧文本与 final.summary,route 不 5xx。
// 服务无会话态:事件日志是真相,聊天会话是客户端投影(localStorage)。

export const dynamic = 'force-dynamic';

// D8 自报身份口径下的本地 demo 用户；与 Chat Session id 解耦，供用户级 Sidecar 迁移。
const PRESENTATION_PRINCIPAL = 'user:local';

interface ParsedChatBody {
  ok: true;
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  driver: 'llm' | 'auto';
  mode: 'inline' | 'delegated';
  clientView?: ClientViewReport;
}

interface ParseError {
  ok: false;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): ParsedChatBody | ParseError {
  if (!isPlainObject(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  const { goal, sessionId, turnId, driver, mode, clientView } = body;
  if (!isPlainObject(goal) || typeof goal.verb !== 'string' || goal.verb === '') {
    return { ok: false, error: 'goal 必须是 {verb: 非空字符串, …}' };
  }
  for (const key of ['targetRel', 'resource'] as const) {
    if (goal[key] !== undefined && typeof goal[key] !== 'string') {
      return { ok: false, error: `goal.${key} 必须是字符串` };
    }
  }
  if (goal.fields !== undefined && !isPlainObject(goal.fields)) {
    return { ok: false, error: 'goal.fields 必须是对象' };
  }
  if (sessionId !== undefined && typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId 必须是字符串' };
  }
  if (turnId !== undefined && typeof turnId !== 'string') {
    return { ok: false, error: 'turnId 必须是字符串' };
  }
  if (driver === 'rule') {
    return { ok: false, error: 'rule driver 已退出产品运行时；driver 仅支持 "llm" | "auto"' };
  }
  if (driver !== undefined && driver !== 'llm' && driver !== 'auto') {
    return { ok: false, error: 'driver 必须是 "llm" | "auto"' };
  }
  if (mode !== undefined && mode !== 'inline' && mode !== 'delegated') {
    return { ok: false, error: 'mode 必须是 "inline" | "delegated"' };
  }
  let parsedClientView: ClientViewReport | undefined;
  if (clientView !== undefined) {
    try {
      parsedClientView = parseClientViewReport(clientView);
    } catch (error) {
      return {
        ok: false,
        error: `clientView 无效: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return {
    ok: true,
    // 双重断言理由:goal 的 verb/targetRel/resource/fields 各键已在上文逐键校验,
    // Record<string,unknown> 与 AgentGoal 结构不重叠是 TS 的保守判断,运行时形状已收敛。
    goal: goal as unknown as AgentGoal,
    sessionId: sessionId ?? crypto.randomUUID(),
    turnId: turnId ?? crypto.randomUUID(),
    driver: driver ?? 'auto',
    mode: mode ?? 'inline',
    ...(parsedClientView === undefined ? {} : { clientView: parsedClientView }),
  };
}

/**
 * SSE 响应壳(inline 常规路径与渲染路径 SSE 化共用):send 包装(客户端断开
 * 停推帧,服务端循环照常跑完)、异常兜底 error 帧、finally close——各路径
 * 只关心帧序列本身。
 */
function sseResponse(
  start: (send: (frame: Record<string, unknown>) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let pushable = true;
      const send = (frame: Record<string, unknown>): void => {
        if (!pushable) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          // 客户端已断开(停止/关窗):停推帧,循环照常跑完。
          pushable = false;
        }
      };
      // 中间无模型 token 时仍证明连接活着；客户端把它视为续期信号而非业务消息。
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000);
      (heartbeat as { unref?: () => void }).unref?.();
      try {
        await start(send);
      } catch (error) {
        // 委托不崩溃:循环与 driver 都不应抛出;此处兜底为 error 帧(200 流内)。
        send({
          type: 'error',
          error: `聊天循环异常: ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // 流已被客户端取消:关闭动作无副作用要求。
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}

async function appendChatProjection(
  kind: 'chat-turn-started' | 'chat-turn-progress' | 'chat-turn',
  sessionId: string,
  detail: ChatTurnStartedDetail | ChatTurnProgressDetail | ChatTurnDetail,
): Promise<void> {
  try {
    await appendEvent(getDb(), {
      kind,
      actor: 'agent',
      principal: `user:${sessionId}`,
      channel: 'chat',
      rel: `chat:${sessionId}`,
      detail,
    });
  } catch (persistError) {
    console.error(`${kind} 事件落库失败(不阻断聊天响应):`, persistError);
  }
}

async function appendConversationMessage(args: {
  sessionId: string;
  turnId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  citations?: FactRef[];
  clientView?: ClientViewReport;
}): Promise<number> {
  const appended = await appendEvent(getDb(), {
    kind: 'chat-message-appended',
    actor: args.role === 'user' ? 'human' : 'agent',
    principal: `user:${args.sessionId}`,
    channel: 'chat',
    rel: `chat:${args.sessionId}`,
    detail: {
      sessionId: args.sessionId,
      turnId: args.turnId,
      messageId: args.messageId,
      role: args.role,
      content: args.content,
      provenance:
        args.role === 'user'
          ? { kind: 'user-input' as const }
          : { kind: 'assistant-output' as const, ...(args.model ? { model: args.model } : {}) },
      ...(args.citations !== undefined ? { citations: args.citations } : {}),
      ...(args.clientView === undefined ? {} : { clientView: args.clientView }),
    },
  });
  return appended.seq;
}

async function appendConversationContext(args: {
  sessionId: string;
  basedOnSeq: number;
  sourceMessageIds: string[];
  patch: Record<string, unknown>;
}): Promise<void> {
  await appendEvent(getDb(), {
    kind: 'chat-context-updated',
    actor: 'agent',
    principal: `user:${args.sessionId}`,
    channel: 'chat',
    rel: `chat:${args.sessionId}`,
    detail: {
      sessionId: args.sessionId,
      basedOnSeq: args.basedOnSeq,
      provenance: { kind: 'mechanical-projection', sourceMessageIds: args.sourceMessageIds },
      patch: args.patch,
    },
  });
}

async function appendNavigationCompletion(completion: NavigationCompletion): Promise<void> {
  await appendEvent(getDb(), {
    kind: 'chat-navigation-completed',
    actor: 'agent',
    principal: `user:${completion.sessionId}`,
    channel: 'chat',
    rel: `chat:${completion.sessionId}`,
    detail: completion,
  });
}

async function loadAgentConversation(sessionId: string): Promise<{
  messages: AgentConversationMessage[];
  context: AgentConversationContext;
  clientView: ReturnType<typeof conversationView>['clientView'];
  lastNavigation: ReturnType<typeof conversationView>['lastNavigation'];
}> {
  const events = await readLog(getDb());
  const view = conversationView(events, sessionId);
  const executionAudit = executionAuditContext(events, `user:${sessionId}`);
  return {
    messages: view.recentMessages.map(({ messageId, role, content }) => ({
      messageId,
      role,
      content,
    })),
    clientView: view.clientView,
    lastNavigation: view.lastNavigation,
    context: {
      ...(view.context.activeGoal !== null ? { activeGoal: view.context.activeGoal } : {}),
      ...(view.context.focus !== null
        ? {
            focus: {
              ...(view.context.focus.currentRel !== null
                ? { currentRel: view.context.focus.currentRel }
                : {}),
              history: view.context.focus.history.map((entry) => ({ ...entry })),
            },
          }
        : {}),
      ...(view.context.referents.length > 0
        ? { referents: view.context.referents.map((referent) => ({ ...referent })) }
        : {}),
      ...(view.context.constraints.length > 0
        ? { constraints: view.context.constraints.map((constraint) => ({ ...constraint })) }
        : {}),
      ...(view.context.authorizedEffects.length > 0
        ? {
            authorizedEffects: view.context.authorizedEffects.map((authorization) => ({
              ...authorization,
            })),
          }
        : {}),
      ...(view.context.pendingClarification !== null
        ? {
            pendingClarification: {
              question: view.context.pendingClarification.question,
              continuation: view.context.pendingClarification.continuation,
              sourceMessageIds: [...view.context.pendingClarification.sourceMessageIds],
            },
          }
        : {}),
      ...(executionAudit.length > 0 ? { executionAudit } : {}),
    },
  };
}

/**
 * inline 循环的流内执行(inline 常规路径与渲染路径过闸失败的兜底共用):
 * resolveStartRel → runAgent(thinking-delta/thinking/step 帧)→ 冗余步帧 →
 * agent-decision/chat-turn 落库 → final 帧。
 */
async function streamAgentLoop(args: {
  send: (frame: Record<string, unknown>) => void;
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  requested: 'llm' | 'auto';
  resolved: 'llm';
  baseUrl: string;
  conversationMessages: AgentConversationMessage[];
  conversation: AgentConversationContext;
  clientView: ReturnType<typeof conversationView>['clientView'];
  lastNavigation: ReturnType<typeof conversationView>['lastNavigation'];
}): Promise<void> {
  const {
    send,
    goal,
    sessionId,
    turnId,
    requested,
    resolved,
    baseUrl,
    conversationMessages,
    conversation,
    clientView,
    lastNavigation,
  } = args;
  send({ type: 'session', sessionId, turnId });
  const startRel = await resolveStartRel(
    baseUrl,
    goal,
    (url, init) => fetch(url, init),
    baseUrl.endsWith('/_meta') ? 'meta/flows' : 'articles',
  );
  // agent-decision 审计(T11 Phase B):包装 driver 在 decide 时刻捕获
  // (prompt/reasoning/op)——决策输入只存在于 decide 时的 DriverContext,
  // 执行后的 TrailStep 回推不出 prompt(捕获方案见 chat/decisions.ts)。
  const decisions: AgentDecisionDetail[] = [];
  // 已发 step 帧计数:thinking 帧的步号 = 计数 + 1(decide 先于 trail.push,
  // 回调时第 N 步的 step 帧尚未发出)——与对应 step 帧同号,便于客户端归步。
  let stepFramesSent = 0;
  let presentationCount = 0;
  const presentationRequestIds: string[] = [];
  const presentationJobs: Promise<void>[] = [];
  const result = await runAgent(
    wrapDriverForAudit(createDriver(requested), resolved, (detail) => decisions.push(detail)),
    goal,
    {
      baseUrl,
      fetchImpl: (url, init) => fetch(url, init),
      actor: 'agent',
      principal: `user:${sessionId}`,
      channel: 'chat',
      startRel,
      conversationMessages,
      conversation,
      clientView,
      lastNavigation,
      requireEffectAuthorization: true,
      chatMarkdown: true,
      presentationMarkdown: getPresentationCapabilities().markdownWord,
      // thinking 帧(T11 Phase C / 架构决定 4):llm 步的推理自述聚合整段
      // 权威终帧(D22 末尾齐发),先于同号 step 帧;增量通道 thinking-delta
      // 逐片段即推(当前与聚合几乎同刻,管线为真流式就绪);
      // 端点无 reasoning 回调时自然零帧。
      onReasoning: (text) => {
        send({ type: 'thinking', turnId, step: stepFramesSent + 1, text });
      },
      onReasoningDelta: (piece) => {
        send({ type: 'thinking-delta', turnId, step: stepFramesSent + 1, text: piece });
      },
      onPresentation: (intent) => {
        presentationCount += 1;
        const request = completePresentationRequest(intent, {
          requestId: `${turnId}:presentation:${presentationCount}`,
          principal: PRESENTATION_PRINCIPAL,
          sourceMessageIds: [turnId],
        });
        presentationRequestIds.push(request.requestId);
        send({
          type: 'presentation',
          turnId,
          payload: { schemaVersion: 1, requestId: request.requestId, status: 'pending' },
        });
        const job = getPresentationBroker()
          .present(request)
          .then(async (payload) => {
            if (
              (payload.status === 'ready' || payload.status === 'fallback') &&
              payload.surfaceUrl !== undefined
            ) {
              await appendNavigationCompletion({
                schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
                navigationId: `${request.requestId}:presentation-navigation`,
                source: 'presentation-receipt',
                sessionId,
                turnId,
                subject: request.subject,
                route: payload.surfaceUrl,
                sourceMessageIds: [...request.sourceMessageIds],
                presentationRequestId: request.requestId,
              });
            }
            send({ type: 'presentation', turnId, payload });
          });
        presentationJobs.push(job);
      },
      onStep: async (step) => {
        stepFramesSent += 1;
        if (step.op.kind === 'navigate' && step.outcome === 'navigated') {
          await appendNavigationCompletion({
            schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
            navigationId: `${turnId}:navigate:${step.step}`,
            source: 'agent-navigate',
            sessionId,
            turnId,
            subject: step.rel,
            route: `/canvas?focus=${encodeURIComponent(step.rel)}`,
            sourceMessageIds: [turnId],
            step: step.step,
          });
          send({ type: 'focus', turnId, rel: step.rel });
        } else if (step.op.kind === 'exec' && step.outcome === 'executed') {
          // navigate 帧展示动作前处境；执行成功后显式刷新同一 rel，让共享
          // 画布立即切到动作后的合同投影，避免“完成了但仍显示旧状态”。
          send({ type: 'focus', turnId, rel: step.rel, refresh: true });
        } else if (step.op.kind === 'exec-plan' && step.outcome === 'executed') {
          send({ type: 'focus', turnId, rel: step.rel, refresh: true });
        }
        const message = stepToMessage(step);
        send({ type: 'step', turnId, message, rel: step.rel });
        await appendChatProjection('chat-turn-progress', sessionId, {
          sessionId,
          turnId,
          message,
          step,
        });
      },
    },
  );

  const messages = trailToMessages(result);
  // max-steps 的上限说明不是轨迹步(无 TrailStep 可挂 onStep),补一帧,
  // 保持客户端「消息 = 各 step 帧文本」的重建口径与 trailToMessages 等值。
  for (const extra of messages.slice(result.steps.length)) {
    send({ type: 'step', turnId, message: extra });
    await appendChatProjection('chat-turn-progress', sessionId, {
      sessionId,
      turnId,
      message: extra,
    });
  }

  // agent-decision 落库:inline 每步决策一条,与 chat-turn 同源同值
  // (actor/principal/channel);先于回合投影写入(决策在先,回合在后)。
  // 落库失败 console.error 不阻断响应(同 chat-turn 口径:审计是投影)。
  try {
    for (const detail of decisions) {
      await appendEvent(getDb(), {
        kind: 'agent-decision',
        actor: 'agent',
        principal: `user:${sessionId}`,
        channel: 'chat',
        rel: `chat:${sessionId}`,
        detail,
      });
    }
  } catch (persistError) {
    console.error('agent-decision 事件落库失败(不阻断聊天响应):', persistError);
  }

  // 聊天历史(B3):inline 回合完成(含 failed/max-steps)直写 chat-turn
  // 事件——与 worker 同一双写者模式;engine fold 忽略该 kind。落库失败
  // 不阻断聊天响应(历史是投影,丢失可从轨迹推知,响应才是合同)。
  // T11 Phase B:detail 增结构化 steps(result.steps 原样)——messages
  // 是人读投影,steps 是机器可读原料(架构决定 2)。
  const turnDetail: ChatTurnDetail = {
    sessionId,
    turnId,
    goal,
    outcome: result.outcome,
    summary: result.summary ?? null,
    messages,
    steps: result.steps,
    ...(presentationRequestIds.length > 0 ? { presentationRequestIds } : {}),
    driver: resolved,
  };
  await appendChatProjection('chat-turn', sessionId, turnDetail);

  const assistantMessageId = `${turnId}:assistant`;
  const assistantContent = result.summary ?? '';
  if (assistantContent !== '') {
    const assistantSeq = await appendConversationMessage({
      sessionId,
      turnId,
      messageId: assistantMessageId,
      role: 'assistant',
      content: assistantContent,
      model: process.env.LLM_MODEL,
      citations: result.sources,
    });
    if (result.outcome === 'clarification-needed' && result.continuation !== undefined) {
      await appendConversationContext({
        sessionId,
        basedOnSeq: assistantSeq,
        sourceMessageIds: [turnId, assistantMessageId],
        patch: {
          activeGoal: result.continuation,
          pendingClarification: {
            question: assistantContent,
            continuation: result.continuation,
            sourceMessageIds: [assistantMessageId],
          },
        },
      });
    }
  }

  send({
    type: 'final',
    turnId,
    payload: {
      sessionId,
      turnId,
      driver: resolved,
      requestedDriver: requested,
      outcome: result.outcome,
      summary: result.summary ?? null,
      steps: result.steps,
      successes: result.successes,
      ...(result.sources !== undefined ? { sources: result.sources } : {}),
      ...(presentationRequestIds.length > 0 ? { presentationRequestIds } : {}),
    },
  });
  await Promise.allSettled(presentationJobs);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const { goal, sessionId, turnId, driver: requested, mode, clientView } = parsed;
  // baseUrl 口径(终审 M-2):delegated 派发的 workflow args.baseUrl 不信任
  // 请求 Host 头(可被调用方控制,进 workflow 会让 worker 以服务端身份持续
  // 回环抓取任意 origin)。APP_ORIGIN 显式覆盖;否则仅放行本机 Host(dev/
  // e2e 都在 localhost),非本机且未配置 → 拒绝 delegated 派发。
  const requestUrl = new URL(request.url);
  const resolved = 'llm' as const;
  let baseUrl: string;
  if (mode !== 'delegated') {
    baseUrl = requestUrl.origin;
  } else if (process.env.APP_ORIGIN !== undefined) {
    baseUrl = process.env.APP_ORIGIN;
  } else if (
    requestUrl.hostname === 'localhost' ||
    requestUrl.hostname === '127.0.0.1' ||
    requestUrl.hostname === '[::1]'
  ) {
    baseUrl = requestUrl.origin;
  } else {
    return Response.json(
      { error: 'delegated 派发要求配置 APP_ORIGIN(当前 Host 非本机,拒绝以不可信 origin 派发委托)' },
      { status: 400 },
    );
  }
  if (hasExplicitMetaIntent(goal.verb)) {
    baseUrl = `${baseUrl.replace(/\/$/, '')}/_meta`;
  }

  // AI-first 产品边界:缺少模型配置时不进入任何确定性 chat
  // 短路(render/focus/discovery),也不派发注定失败的委托。inline
  // 仍经标准 agent 流输出可恢复 fail；delegated 以 JSON 据实拒绝。
  let configurationFailure: string | undefined;
  try {
    resolveLlmConfig();
  } catch (error) {
    if (!(error instanceof LlmConfigurationError)) throw error;
    configurationFailure = `LLM 不可用: ${error.message}。配置后可重试。`;
  }

  const userMessageId = turnId;
  await appendConversationMessage({
    sessionId,
    turnId,
    messageId: userMessageId,
    role: 'user',
    content: goal.verb,
    ...(clientView === undefined ? {} : { clientView }),
  });
  const agentConversation = await loadAgentConversation(sessionId);

  await appendChatProjection('chat-turn-started', sessionId, {
    sessionId,
    turnId,
    goal,
    driver: resolved,
    mode,
  });

  if (configurationFailure !== undefined) {
    if (mode === 'inline') {
      return sseResponse(async (send) => {
        await streamAgentLoop({
          send,
          goal,
          sessionId,
          turnId,
          requested,
          resolved,
          baseUrl,
          conversationMessages: agentConversation.messages,
          conversation: agentConversation.context,
          clientView: agentConversation.clientView,
          lastNavigation: agentConversation.lastNavigation,
        });
      });
    }
    const messages = [{ role: 'assistant' as const, text: `失败: ${configurationFailure}` }];
    await appendChatProjection('chat-turn', sessionId, {
      sessionId,
      turnId,
      goal,
      outcome: 'failed',
      summary: configurationFailure,
      messages,
      steps: [],
      driver: resolved,
    });
    return Response.json(
      {
        sessionId,
        driver: resolved,
        requestedDriver: requested,
        outcome: 'failed',
        summary: configurationFailure,
        messages,
        steps: [],
        successes: [],
        error: configurationFailure,
      },
      { status: 503 },
    );
  }

  // delegated(T5 Phase B):派发 delegationWorkflow,响应委托 id 与轮询入口;
  // 轨迹/状态经事件日志(/api/delegations/<id>)查询,与 inline 的消息语义等价。
  if (mode === 'delegated') {
    try {
      const startRel = await resolveStartRel(
        baseUrl,
        goal,
        (url, init) => fetch(url, init),
        baseUrl.endsWith('/_meta') ? 'meta/flows' : 'articles',
      );
      const { delegationId } = await dispatchDelegation({
        goal,
        driverKind: resolved,
        startRel,
        principal: `user:${sessionId}`,
        baseUrl,
      });
      const message = {
        role: 'assistant' as const,
        text: `已派发委托 ${delegationId.replace(/^delegation-/, '').slice(0, 8)}…(后台执行中),进度见委托监控页 /delegations`,
      };
      await appendChatProjection('chat-turn', sessionId, {
        sessionId,
        turnId,
        goal,
        outcome: 'done',
        summary: `委托已派发:${delegationId}`,
        messages: [message],
        steps: [],
        driver: resolved,
      });
      return Response.json({
        mode: 'delegated',
        delegationId,
        statusUrl: `/api/delegations/${delegationId}`,
        sessionId,
      });
    } catch (error) {
      // 派发失败据实 503(委托未出发;与 inline 的"失败也是 200"不同——
      // 这里连循环都没开始,客户端必须知道派发本身未成)。
      const summary = `委托派发失败: ${error instanceof Error ? error.message : String(error)}`;
      await appendChatProjection('chat-turn', sessionId, {
        sessionId,
        turnId,
        goal,
        outcome: 'failed',
        summary,
        messages: [{ role: 'assistant', text: `失败: ${summary}` }],
        steps: [],
        driver: resolved,
      });
      return Response.json(
        {
          sessionId,
          error: summary,
        },
        { status: 503 },
      );
    }
  }

  // inline(T9 Phase B):SSE 流式响应——轨迹逐步可见(过程可见性);
  // 循环在流内跑完,客户端断开只中断推帧,不中断循环(服务端留痕完整)。
  // 帧序列与审计/落库口径全在 streamAgentLoop(与渲染路径 SSE 化共用)。
  return sseResponse(async (send) => {
    await streamAgentLoop({
      send,
      goal,
      sessionId,
      turnId,
      requested,
      resolved,
      baseUrl,
      conversationMessages: agentConversation.messages,
      conversation: agentConversation.context,
      clientView: agentConversation.clientView,
      lastNavigation: agentConversation.lastNavigation,
    });
  });
}
