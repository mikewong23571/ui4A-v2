import {
  createBoundedBearerFetch,
  createContractClient,
  createDriver,
  LlmConfigurationError,
  resolveLlmConfig,
  runAgent,
  type AgentGoal,
  type ConversationContext as AgentConversationContext,
  type ConversationMessage as AgentConversationMessage,
  type FactRef,
  type FetchLike,
} from '@ui4a/agent';
import {
  CHAT_NAVIGATION_PROTOCOL_VERSION,
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
import {
  failureReasonFromLoopException,
  failureReasonFromResult,
  phraseFailureWithLlm,
} from '../../../chat/failure-reason';
import { sitemapTitlesFromSummary, stepActivityData } from '../../../chat/step-activity';
import { startRelFromSituation } from '../../../chat/start-chain';
import { stepToMessage, trailToMessages } from '../../../chat/trail';
import { getProductionAgentTokenProvider } from '../../../auth/production-agent-token-provider';
import { getProductionBrowserAuthentication } from '../../../auth/production-browser-authentication';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
  type TrustedRequestAuditContext,
} from '../../../auth/request-identity';
import { appendEvent, readLog } from '../../../db/events';
import { situationForChat } from '../../../engine/chat-situation';
import { attachChatMessageToThread } from '../../../engine/chat-thread';
import { getDb, getEngine } from '../../../engine/service';
import {
  getPresentationBroker,
  getPresentationCapabilities,
} from '../../../engine/presentation/runtime';
import { runWebProductionDeploymentPreflight } from '../../../production-deployment-preflight';
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
//   {type:'step', message:{role:'assistant',text}, rel, activity, eventSeq?}
//   (text 为 trail.ts stepToMessage 口径的机器层原文;T24 Phase B 起
//   activity={op,title?,subject?} 为结构化显示数据——op 是协议动词、标题取自
//   合同 sitemap,客户端按固定 op 词表渲染活动语言;eventSeq 指向本步
//   chat-turn-progress 事件供审计下钻);llm 步 decide 产推理自述时先于同号
//   step 帧推一帧
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
// - delegated(T5 Phase B / spec 架构决定 5):校验 goal → 从 Situation 事实链取得 startRel 与
//   driverKind(auto 先解析)→ dispatchDelegation 派发 delegationWorkflow
//   (taskQueue ui4a;baseUrl=自身 origin,worker activity 回环走本源合同)→
//   响应 {mode:'delegated', delegationId, statusUrl};派发失败(Temporal 不可达)
//   据实 503——委托没派出去不能假装成功;
// - 起始 rel 来自同一回合的 Situation:focus → scope application entry → 站点兜底；
//   不做 sitemap 词级猜测或实体可达性预探测；
// - 一次性 JSON 仅剩参数错误/delegated；inline 始终使用同一 SSE agent loop。
//   B4:LLM 失败(401 等)如实进入 step 帧文本与 final.summary,route 不 5xx。
// 服务无会话态:事件日志是真相,聊天会话是客户端投影(localStorage)。

export const dynamic = 'force-dynamic';

// 本地 demo 的用户级 Sidecar 与 Chat session 解耦；生产则使用已认证 principal。
const LOCAL_PRESENTATION_PRINCIPAL = 'user:local';
const AGENT_CONTRACT_PATHS = [
  '/.well-known/ui4a.json',
  '/api/entity',
  '/api/exec',
  '/api/exec-plan',
  '/_meta/.well-known/ui4a.json',
  '/_meta/api/entity',
  '/_meta/api/exec',
] as const;

function bearerToken(authorizationHeader: string): string | undefined {
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader);
  return match?.[1];
}

function agentCredentialErrorResponse(error: unknown): Response {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('agent_')
      ? error.code
      : 'agent_token_endpoint_unavailable';
  return Response.json({ error: { code } }, { status: 503 });
}

function agentAuthorizationErrorResponse(code: string): Response {
  return Response.json({ error: { code } }, { status: 403 });
}

function isCanonicalDelegatedIdentity(input: {
  human: TrustedRequestAuditContext;
  delegated: TrustedRequestAuditContext;
  agentClientId: string;
  requestedScopes: readonly string[];
}): boolean {
  const { human, delegated, agentClientId, requestedScopes } = input;
  return (
    delegated.actor === 'agent' &&
    delegated.humanApprovalEligible === false &&
    delegated.principal === human.principal &&
    delegated.delegation?.subject === human.principal &&
    delegated.delegation.actorClientId === agentClientId &&
    delegated.delegation.source === 'token-exchange-sub-azp' &&
    delegated.scopes.every((scope) => requestedScopes.includes(scope))
  );
}

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
        const reason = failureReasonFromLoopException(error);
        send({
          type: 'error',
          error: reason.evidence?.[0] ?? '聊天循环异常',
          // 结构化失败合同(T24 Phase B Task 3;边界为既定裁决,D48):机械层
          // 只产结构化数据;error 帧恒由客户端中性结构化展示,LLM phrasing 仅
          // 覆盖 final 帧的失败来源(loop_exception 是循环壳的最后兜底,该路径
          // 零新增故障面)。补齐 error 帧 LLM 表述须新决策——见 DECISIONS D48
          // 第 4 小节(R14 边界登记)。
          reason,
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
  principal = `user:${sessionId}`,
): Promise<number | undefined> {
  try {
    const appended = await appendEvent(getDb(), {
      kind,
      actor: 'agent',
      principal,
      channel: 'chat',
      rel: `chat:${sessionId}`,
      detail,
    });
    return appended.seq;
  } catch (persistError) {
    console.error(`${kind} 事件落库失败(不阻断聊天响应):`, persistError);
    return undefined;
  }
}

async function appendConversationMessage(args: {
  sessionId: string;
  principal?: string;
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
    principal: args.principal ?? `user:${args.sessionId}`,
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
  principal?: string;
  basedOnSeq: number;
  sourceMessageIds: string[];
  patch: Record<string, unknown>;
}): Promise<void> {
  await appendEvent(getDb(), {
    kind: 'chat-context-updated',
    actor: 'agent',
    principal: args.principal ?? `user:${args.sessionId}`,
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

async function appendNavigationCompletion(
  completion: NavigationCompletion,
  principal = `user:${completion.sessionId}`,
): Promise<void> {
  await appendEvent(getDb(), {
    kind: 'chat-navigation-completed',
    actor: 'agent',
    principal,
    channel: 'chat',
    rel: `chat:${completion.sessionId}`,
    detail: completion,
  });
}

async function loadAgentConversation(
  sessionId: string,
  principal = `user:${sessionId}`,
): Promise<{
  messages: AgentConversationMessage[];
  context: AgentConversationContext;
  clientView: ReturnType<typeof conversationView>['clientView'];
  lastNavigation: ReturnType<typeof conversationView>['lastNavigation'];
}> {
  const events = await readLog(getDb());
  const view = conversationView(events, sessionId);
  const executionAudit = executionAuditContext(events, principal);
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
 * fact-based startRel → runAgent(thinking-delta/thinking/step 帧)→ 冗余步帧 →
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
  principal: string;
  presentationPrincipal: string;
  startRel: string;
  scope: string | null;
  presentationPolicyScope: string;
  fetchImpl: FetchLike;
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
    principal,
    conversationMessages,
    conversation,
    clientView,
    lastNavigation,
  } = args;
  send({ type: 'session', sessionId, turnId });
  // 同一已解析 sitemap 同时供 Agent 静态上下文与 T24 活动标题投影；
  // 不可得时显式预载 undefined，循环不二次抓取且照常仅实体导航。
  const sitemap = await createContractClient(baseUrl, args.fetchImpl).getSitemap();
  const sitemapTitles = sitemapTitlesFromSummary(sitemap);
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
      fetchImpl: args.fetchImpl,
      sitemap,
      actor: 'agent',
      principal,
      channel: 'chat',
      startRel: args.startRel,
      app: args.scope ?? undefined,
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
          principal: args.presentationPrincipal,
          sourceMessageIds: [turnId],
        });
        presentationRequestIds.push(request.requestId);
        send({
          type: 'presentation',
          turnId,
          payload: { schemaVersion: 1, requestId: request.requestId, status: 'pending' },
        });
        const job = getPresentationBroker()
          .present(request, { policyScope: args.presentationPolicyScope })
          .then(async (payload) => {
            if (
              (payload.status === 'ready' || payload.status === 'fallback') &&
              payload.surfaceUrl !== undefined
            ) {
              await appendNavigationCompletion(
                {
                  schemaVersion: CHAT_NAVIGATION_PROTOCOL_VERSION,
                  navigationId: `${request.requestId}:presentation-navigation`,
                  source: 'presentation-receipt',
                  sessionId,
                  turnId,
                  subject: request.subject,
                  route: payload.surfaceUrl,
                  sourceMessageIds: [...request.sourceMessageIds],
                  presentationRequestId: request.requestId,
                },
                principal,
              );
            }
            send({ type: 'presentation', turnId, payload });
          });
        presentationJobs.push(job);
      },
      onStep: async (step) => {
        stepFramesSent += 1;
        if (step.op.kind === 'navigate' && step.outcome === 'navigated') {
          await appendNavigationCompletion(
            {
              schemaVersion: CHAT_NAVIGATION_PROTOCOL_VERSION,
              navigationId: `${turnId}:navigate:${step.step}`,
              source: 'agent-navigate',
              sessionId,
              turnId,
              subject: step.rel,
              route: `/canvas?focus=${encodeURIComponent(step.rel)}`,
              sourceMessageIds: [turnId],
              step: step.step,
            },
            principal,
          );
          send({ type: 'focus', turnId, rel: step.rel });
        } else if (step.op.kind === 'exec' && step.outcome === 'executed') {
          // navigate 帧展示动作前处境；执行成功后显式刷新同一 rel，让共享
          // 画布立即切到动作后的合同投影，避免“完成了但仍显示旧状态”。
          send({ type: 'focus', turnId, rel: step.rel, refresh: true });
        } else if (step.op.kind === 'exec-plan' && step.outcome === 'executed') {
          send({ type: 'focus', turnId, rel: step.rel, refresh: true });
        }
        const message = stepToMessage(step);
        // T24 Phase B:message.text(机器层原文)随帧保留供审计/回退;activity
        // 携带 {op, title?, subject?} 结构化显示数据(标题取自合同 sitemap),
        // 客户端按固定 op 词表渲染「正在做什么」的活动语言。先落
        // chat-turn-progress 拿日志 seq,帧内 eventSeq 供审计下钻定位;
        // 落库失败时帧照发(下钻退事件流页,不伪造定位)。
        const activity = stepActivityData(step, sitemapTitles);
        const eventSeq = await appendChatProjection(
          'chat-turn-progress',
          sessionId,
          { sessionId, turnId, message, step },
          principal,
        );
        send({
          type: 'step',
          turnId,
          message,
          rel: step.rel,
          activity,
          ...(eventSeq !== undefined ? { eventSeq } : {}),
        });
      },
    },
  );

  const messages = trailToMessages(result);
  // max-steps 的上限说明不是轨迹步(无 TrailStep 可挂 onStep),补一帧,
  // 保持客户端「消息 = 各 step 帧文本」的重建口径与 trailToMessages 等值。
  for (const extra of messages.slice(result.steps.length)) {
    send({ type: 'step', turnId, message: extra });
    await appendChatProjection(
      'chat-turn-progress',
      sessionId,
      { sessionId, turnId, message: extra },
      principal,
    );
  }

  // agent-decision 落库:inline 每步决策一条,与 chat-turn 同源同值
  // (actor/principal/channel);先于回合投影写入(决策在先,回合在后)。
  // 落库失败 console.error 不阻断响应(同 chat-turn 口径:审计是投影)。
  try {
    for (const detail of decisions) {
      await appendEvent(getDb(), {
        kind: 'agent-decision',
        actor: 'agent',
        principal,
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
  await appendChatProjection('chat-turn', sessionId, turnDetail, principal);

  const assistantMessageId = `${turnId}:assistant`;
  const assistantContent = result.summary ?? '';
  if (assistantContent !== '') {
    const assistantSeq = await appendConversationMessage({
      sessionId,
      principal,
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
        principal,
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

  // 失败措辞分层(T24 Phase B Task 3):机械层组装结构化 reason;LLM 在场时
  // 由 reason 生成一句面向用户表述(AI-first),缺席则帧内无 phrasing、客户端
  // 中性结构化展示。summary 机器句子保留为机械层/审计数据,不从呈现消失真相。
  const failureReason = failureReasonFromResult(result);
  const phrasing =
    failureReason === undefined
      ? undefined
      : await phraseFailureWithLlm({
          reason: failureReason,
          goal,
          summary: result.summary,
        });

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
      ...(failureReason !== undefined
        ? { reason: phrasing === undefined ? failureReason : { ...failureReason, phrasing } }
        : {}),
      ...(result.sources !== undefined ? { sources: result.sources } : {}),
      ...(presentationRequestIds.length > 0 ? { presentationRequestIds } : {}),
    },
  });
  await Promise.allSettled(presentationJobs);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  let productionIdentity: TrustedRequestAuditContext | undefined;
  let productionSubjectToken: string | undefined;
  let productionOrigin: string | undefined;
  let productionAgentScopes: string[] | undefined;
  let productionConfig:
    NonNullable<ReturnType<typeof runWebProductionDeploymentPreflight>> | undefined;

  if (requestIdentityProfile() === 'production') {
    let config;
    try {
      config = runWebProductionDeploymentPreflight();
    } catch {
      return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
    }
    if (config === undefined) {
      return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
    }
    const configuredOrigin = new URL(config.settings.service.publicOrigin);
    const requestHost = request.headers.get('host');
    // TLS 在 edge(Istio gateway / Caddy)终止,pod 内 request.url 协议恒为 http;
    // origin 比较采用 edge 覆写的 x-forwarded-proto + Host 重建外部 origin(edge
    // default-deny 保证外部流量必经 gateway,伪造头到不了 pod;直接集群内访问仍按
    // request.url 兜底)。Host 本身仍必须等于配置 host。
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const effectiveOrigin =
      requestHost !== null
        ? `${forwardedProto ?? requestUrl.protocol.replace(/:$/, '')}://${requestHost}`
        : requestUrl.origin;
    if (
      effectiveOrigin !== configuredOrigin.origin ||
      (requestHost !== null && requestHost !== configuredOrigin.host)
    ) {
      return Response.json({ error: { code: 'request_origin_invalid' } }, { status: 400 });
    }

    const agentScopes = config.settings.auth.oidc.agentScopes;
    const policyScopes = agentScopes
      .filter((scope) => scope.startsWith('ui4a:policy:'))
      .map((scope) => scope.slice('ui4a:policy:'.length));
    if (policyScopes.length === 0) {
      return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
    }
    try {
      const browserSession = await getProductionBrowserAuthentication().resolveSession(request);
      const subjectToken = bearerToken(browserSession.authorizationHeader);
      if (subjectToken === undefined) {
        return Response.json({ error: { code: 'credential_malformed' } }, { status: 401 });
      }
      const identityRequest = new Request(request.url, {
        headers: { authorization: browserSession.authorizationHeader },
      });
      productionIdentity = await resolveTrustedRequestIdentity(identityRequest, {
        profile: 'production',
        productionConfig: config,
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: policyScopes,
        defaultPolicyScope: policyScopes[0]!,
        plane: 'business',
      });
      productionSubjectToken = subjectToken;
      productionOrigin = configuredOrigin.origin;
      productionAgentScopes = [...agentScopes];
      productionConfig = config;
    } catch (error) {
      return (
        authenticationErrorResponse(error) ??
        Response.json({ error: { code: 'credential_malformed' } }, { status: 401 })
      );
    }
  }

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

  const { goal, turnId, driver: requested, mode, clientView } = parsed;
  const sessionId = productionIdentity?.principal ?? parsed.sessionId;
  const principal = productionIdentity?.principal ?? `user:${sessionId}`;
  const presentationPrincipal = productionIdentity?.principal ?? LOCAL_PRESENTATION_PRINCIPAL;
  const presentationPolicyScope = productionIdentity?.policyScope ?? 'local-demo';
  const situation = await situationForChat({
    principal,
    identity: productionIdentity,
    clientView,
  });
  let turnFetch: FetchLike = (url, init) => fetch(url, init);
  if (
    productionIdentity !== undefined &&
    productionSubjectToken !== undefined &&
    productionOrigin !== undefined &&
    productionAgentScopes !== undefined &&
    productionConfig !== undefined
  ) {
    let authorizationHeader: string;
    if (mode === 'inline') {
      // 收窄口径:human granted ∩ agentScopes 的 policy scopes 全量携带(chat 无 scope
      // 选择器,回合内合同读取的 rel 归属哪个应用事先不可知;接收端 /api/entity 的
      // scopeCoverage 再按 rel 逐请求收窄)。相对 human grant 仍是严格收窄(剥离
      // ui4a:approve 与非 agent scope)。
      const requestedScopes = [
        'ui4a:read',
        'ui4a:write',
        ...productionAgentScopes.filter(
          (scope) => scope.startsWith('ui4a:policy:') && productionIdentity.scopes.includes(scope),
        ),
      ];
      // 纵深防御:identity 宣称的 policyScope 必须有对应 granted scope 背书(正常路径
      // 由 resolveCredentialPolicyScope 保证;此处防 identity 适配层漂移)。
      if (!requestedScopes.includes(`ui4a:policy:${productionIdentity.policyScope}`)) {
        return agentAuthorizationErrorResponse('agent_scope_exceeded');
      }
      if (requestedScopes.some((scope) => !productionIdentity.scopes.includes(scope))) {
        return agentAuthorizationErrorResponse('agent_scope_exceeded');
      }
      if (requestedScopes.some((scope) => !productionAgentScopes.includes(scope))) {
        return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
      }
      try {
        const credential = await getProductionAgentTokenProvider().exchangeDelegatedCredential({
          subjectToken: productionSubjectToken,
          requestedScopes,
        });
        // 接收端校验的 delegated scope 白名单必须与本次交换携带的 policy scopes 一致
        // (全量 granted),否则 policyFor 按单个 policyScope 收窄会误报
        // delegation_scope_exceeded。
        const exchangedPolicyScopes = requestedScopes
          .filter((scope) => scope.startsWith('ui4a:policy:'))
          .map((scope) => scope.slice('ui4a:policy:'.length));
        const delegatedIdentity = await resolveTrustedRequestIdentity(
          new Request(request.url, {
            headers: { authorization: credential.authorizationHeader },
          }),
          {
            profile: 'production',
            productionConfig,
            requiredScopes: requestedScopes,
            authorizedPolicyScopes: exchangedPolicyScopes,
            defaultPolicyScope: productionIdentity.policyScope,
            plane: 'business',
          },
        );
        const agentClientId = productionConfig.settings.auth.oidc.agentClientId;
        if (
          !isCanonicalDelegatedIdentity({
            human: productionIdentity,
            delegated: delegatedIdentity,
            agentClientId,
            requestedScopes,
          })
        ) {
          return agentAuthorizationErrorResponse('agent_delegation_identity_invalid');
        }
        authorizationHeader = credential.authorizationHeader;
      } catch (error) {
        return authenticationErrorResponse(error) ?? agentCredentialErrorResponse(error);
      }
    } else {
      authorizationHeader = `Bearer ${productionSubjectToken}`;
    }
    turnFetch = createBoundedBearerFetch({
      origin: productionOrigin,
      authorizationHeader,
      allowedPaths: AGENT_CONTRACT_PATHS,
      fetch,
    });
  }
  // baseUrl 口径(终审 M-2):delegated 派发的 workflow args.baseUrl 不信任
  // 请求 Host 头(可被调用方控制,进 workflow 会让 worker 以服务端身份持续
  // 回环抓取任意 origin)。APP_ORIGIN 显式覆盖;否则仅放行本机 Host(dev/
  // e2e 都在 localhost),非本机且未配置 → 拒绝 delegated 派发。
  const resolved = 'llm' as const;
  let baseUrl: string;
  if (productionOrigin !== undefined) {
    baseUrl = productionOrigin;
  } else if (mode !== 'delegated') {
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
  // 平面归属:跟用户当下位置走(meta 控制台/正在查看定义实体 → 定义合同站;
  // 其余 → 业务站);`_meta` 原话记号保留为显式越界入口。不做自然语言意图猜测。
  if (goal.verb.includes('_meta') || situation.site === 'meta') {
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

  const engine = await getEngine(getDb());
  const startRel = startRelFromSituation(situation, engine.getSnapshot().applications ?? {});

  const userMessageId = turnId;
  await appendConversationMessage({
    sessionId,
    principal,
    turnId,
    messageId: userMessageId,
    role: 'user',
    content: goal.verb,
    ...(clientView === undefined ? {} : { clientView }),
  });
  await attachChatMessageToThread(engine, {
    thread: situation.thread,
    principal,
    messageId: userMessageId,
  });
  const agentConversation = await loadAgentConversation(sessionId, principal);

  await appendChatProjection(
    'chat-turn-started',
    sessionId,
    { sessionId, turnId, goal, driver: resolved, mode },
    principal,
  );

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
          principal,
          presentationPrincipal,
          startRel,
          scope: situation.scope,
          presentationPolicyScope,
          fetchImpl: turnFetch,
          conversationMessages: agentConversation.messages,
          conversation: agentConversation.context,
          clientView: agentConversation.clientView,
          lastNavigation: agentConversation.lastNavigation,
        });
      });
    }
    const messages = [{ role: 'assistant' as const, text: `失败: ${configurationFailure}` }];
    await appendChatProjection(
      'chat-turn',
      sessionId,
      {
        sessionId,
        turnId,
        goal,
        outcome: 'failed',
        summary: configurationFailure,
        messages,
        steps: [],
        driver: resolved,
      },
      principal,
    );
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
      const { delegationId } = await dispatchDelegation({
        goal,
        driverKind: resolved,
        scope: situation.scope,
        startRel,
        principal,
        baseUrl,
      });
      const message = {
        role: 'assistant' as const,
        text: `已派发委托 ${delegationId.replace(/^delegation-/, '').slice(0, 8)}…(后台执行中),进度见委托监控页 /delegations`,
      };
      await appendChatProjection(
        'chat-turn',
        sessionId,
        {
          sessionId,
          turnId,
          goal,
          outcome: 'done',
          summary: `委托已派发:${delegationId}`,
          messages: [message],
          steps: [],
          driver: resolved,
        },
        principal,
      );
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
      await appendChatProjection(
        'chat-turn',
        sessionId,
        {
          sessionId,
          turnId,
          goal,
          outcome: 'failed',
          summary,
          messages: [{ role: 'assistant', text: `失败: ${summary}` }],
          steps: [],
          driver: resolved,
        },
        principal,
      );
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
      principal,
      presentationPrincipal,
      startRel,
      scope: situation.scope,
      presentationPolicyScope,
      fetchImpl: turnFetch,
      conversationMessages: agentConversation.messages,
      conversation: agentConversation.context,
      clientView: agentConversation.clientView,
      lastNavigation: agentConversation.lastNavigation,
    });
  });
}
