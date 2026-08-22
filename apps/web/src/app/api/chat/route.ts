import {
  createDriver,
  entityFocusForDisplayIntent,
  generateRenderSpecWithLlm,
  hasDisplayIntent,
  LlmConfigurationError,
  renderSpecFor,
  renderSpecGroundingErrors,
  resolveLlmConfig,
  runAgent,
  type AgentGoal,
  type GeneratedRenderSpec,
  type RenderSitemapContext,
  type RenderWordSummary,
} from '@ui4a/agent';

import type {
  ChatTurnDetail,
  ChatTurnProgressDetail,
  ChatTurnStartedDetail,
} from '../../../chat/history';
import { wrapDriverForAudit, type AgentDecisionDetail } from '../../../chat/decisions';
import { hasExplicitMetaIntent, isDiscoveryOnlyIntent, resolveStartRel } from '../../../chat/start';
import type { ChatRenderPayload } from '../../../chat/sse';
import { stepToMessage, trailToMessages } from '../../../chat/trail';
import { appendEvent } from '../../../db/events';
import { getDb, getEngine, type EngineRuntime } from '../../../engine/service';
import { dispatchDelegation } from '../../../temporal/delegation';
import { RENDER_WORDS } from '../../../render/registry';
import type { RenderSpec } from '../../../render/spec';
import { validateSpec } from '../../../render/validator';
import { validateWordBind } from '../../../render/word-bind';

// POST /api/chat — 悬浮聊天的合同后端(spec FR6/FR7,arch-brief §8)。
// - 请求 {goal: {verb, targetRel?, resource?, fields?}, sessionId?, driver?,
//   mode?: 'inline'|'delegated'};mode 缺省 inline(既有行为与测试零改动);
// - render capability(T7 Phase C / S5):展示类意图(按分类展示文章)先于
//   inline/delegated 分派短路——renderSpecFor(机械生成路径)产零字面 spec →
//   零字面校验 → freezeSpec(首冻事件留痕,同 concern 复用首冻)→ 响应携带
//   render 载荷(spec + 画布入口);零 /api/exec(渲染不是执行,不走循环);
//   意图未命中/引擎不可达 → 原路交回 agent 循环(诚实失败口径不变);
//   T12 Phase A(架构决定 1):机械生成未命中的展示意图 → LLM
//   fallthrough——buildRenderPrompt(词汇表 + sitemap 处境)→ streamText
//   (环境配置模型,60s abort)→ parseRenderResponse(fail-safe)→ 同一零字面
//   校验器 + 处境核对(集合/字段真实性)+ 词条形状 bindSchema → freezeSpec
//   凝固留痕 → 响应(形状不变);解析失败/校验失败/端点失败 → 原路交回普通
//   agent 循环(不留半成品 spec,不凝固);LLM 路径 inline 模式已 SSE 化
//   (sseRenderResponse):思考增量 thinking-delta + render 帧回执(与 JSON
//   回执同形),过闸失败同流交回循环;delegated 模式保持阻塞 JSON;
// - inline(T9 Phase B 起为 SSE 流式,text/event-stream):服务端只组装
//   LLM driver(default/auto 均是 llm),runAgent 循环过本源
//   HTTP 合同(actor=agent,principal=user:<sessionId>,channel=chat)——
//   "agent 走合同"字面成立;onStep 每步推一帧
//   {type:'step', message:{role:'assistant',text}, rel}(text 为 trail.ts
//   stepToMessage 口径);llm 步 decide 产推理自述时先于同号 step 帧推一帧
//   {type:'thinking', step, text}(T11 Phase C / 架构决定 4:聚合整段权威
//   终帧——D22 GLM reasoning 末尾齐发,非打字机;step 与对应 step 帧同号,
//   便于客户端归步;端点不返回 reasoning 时零 thinking 帧);
//   增量通道 {type:'thinking-delta',
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
//   落库失败 console.error 不阻断响应(同 chat-turn 口径);delegated/render
//   短路回合不写(轨迹分别在舰队页/凝固事件,口径同 chat-turn);
// - delegated(T5 Phase B / spec 架构决定 5):校验 goal → 解析 startRel 与
//   driverKind(auto 先解析)→ dispatchDelegation 派发 delegationWorkflow
//   (taskQueue ui4a;baseUrl=自身 origin,worker activity 回环走本源合同)→
//   响应 {mode:'delegated', delegationId, statusUrl};派发失败(Temporal 不可达)
//   据实 503——委托没派出去不能假装成功;
// - 起始 rel 由 sitemap 词级交集解析(客户端行为),缺省 articles;
// - 一次性 JSON 仅剩:机械 render 命中短路(瞬时)/参数错误/delegated;
//   LLM render 路径(inline)与 inline 循环同为 SSE;thinking/render 帧见上。
//   B4:LLM 失败(401 等)如实进入 step 帧文本与 final.summary,route 不 5xx。
// 服务无会话态:事件日志是真相,聊天会话是客户端投影(localStorage)。

export const dynamic = 'force-dynamic';

interface ParsedChatBody {
  ok: true;
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  driver: 'llm' | 'auto';
  mode: 'inline' | 'delegated';
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
  const { goal, sessionId, turnId, driver, mode } = body;
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
  return {
    ok: true,
    // 双重断言理由:goal 的 verb/targetRel/resource/fields 各键已在上文逐键校验,
    // Record<string,unknown> 与 AgentGoal 结构不重叠是 TS 的保守判断,运行时形状已收敛。
    goal: goal as unknown as AgentGoal,
    sessionId: sessionId ?? crypto.randomUUID(),
    turnId: turnId ?? crypto.randomUUID(),
    driver: driver ?? 'auto',
    mode: mode ?? 'inline',
  };
}

/** 词汇表摘要(buildRenderPrompt 的处境披露输入;注册表与 /api/render/catalog 同源,D12)。 */
function renderWordSummaries(): RenderWordSummary[] {
  return RENDER_WORDS.map((word) => ({
    name: word.name,
    description: word.description,
    bindSchema: word.bindSchema,
  }));
}

/**
 * 凝固 + render 回执载荷(rule 命中 JSON 与 LLM 路径 SSE render 帧共用;
 * 形状自 T7 以来不变)。spec 须已过零字面校验;freezeSpec 入口复校
 * (校验器 + 词汇表词名,双闸口径)。
 */
async function frozenRenderPayload(
  engine: EngineRuntime,
  generated: GeneratedRenderSpec,
  sessionId: string,
  requested: 'llm' | 'auto',
  resolved: 'llm',
): Promise<ChatRenderPayload> {
  // 断言理由:validateSpec 已确认形状(引用节点 + 结构容器),Record 与
  // BindTree 的差异仅是类型层收窄,运行时形状已收敛。
  const spec = generated as unknown as RenderSpec;
  const frozen = await engine.freezeSpec(spec.concern, spec, {
    actor: 'agent',
    principal: `user:${sessionId}`,
  });
  const concern = frozen.spec.concern;
  const canvasUrl = `/canvas?concern=${encodeURIComponent(concern)}`;
  return {
    sessionId,
    driver: resolved,
    requestedDriver: requested,
    outcome: 'done',
    summary: `渲染已生成:${concern}(词条 ${frozen.spec.component})→ 画布 ${canvasUrl}`,
    messages: [
      {
        role: 'assistant',
        text: `已生成渲染「${concern}」(${frozen.spec.component}${
          frozen.frozen ? ',首次凝固' : ',复用已凝固布局'
        })→ 在画布打开:${canvasUrl}`,
      },
    ],
    steps: [],
    successes: [],
    render: { concern, spec: frozen.spec, frozenNow: frozen.frozen, canvasUrl },
  };
}

/** rule 命中路径的 JSON 回执包装(瞬时响应,形状不动)。 */
async function respondWithFrozenSpec(
  engine: EngineRuntime,
  generated: GeneratedRenderSpec,
  sessionId: string,
  requested: 'llm' | 'auto',
  resolved: 'llm',
): Promise<Response> {
  return Response.json(
    await frozenRenderPayload(engine, generated, sessionId, requested, resolved),
  );
}

/**
 * LLM 产 spec 的入口把关(双闸不动,同 rule 路径口径):同一零字面校验器 →
 * 处境核对(collection ∈ sitemap 集合面、维度字段已声明——rule 路径由构造
 * 保证,LLM 路径显式核对)→ 词条形状 bindSchema(与画布渲染流同源)。
 * 任一不过返回 false:调用方交回普通 agent 循环(不留半成品 spec,不凝固)。
 */
function llmSpecPassesGates(spec: GeneratedRenderSpec, sitemap: RenderSitemapContext): boolean {
  if (!validateSpec(spec).valid) return false;
  if (renderSpecGroundingErrors(spec, sitemap).length > 0) return false;
  return validateWordBind(spec.bind, spec.component).valid;
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
}): Promise<void> {
  const { send, goal, sessionId, turnId, requested, resolved, baseUrl } = args;
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
  let progressWrite = Promise.resolve();
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
      // thinking 帧(T11 Phase C / 架构决定 4):llm 步的推理自述聚合整段
      // 权威终帧(D22 末尾齐发),先于同号 step 帧;增量通道 thinking-delta
      // 逐片段即推(当前与聚合几乎同刻,管线为真流式就绪);
      // 端点无 reasoning 回调时自然零帧。
      onReasoning: (text) => {
        send({ type: 'thinking', step: stepFramesSent + 1, text });
      },
      onReasoningDelta: (piece) => {
        send({ type: 'thinking-delta', step: stepFramesSent + 1, text: piece });
      },
      onStep: (step) => {
        stepFramesSent += 1;
        if (step.op.kind === 'navigate' && step.outcome === 'navigated') {
          send({ type: 'focus', rel: step.rel });
        } else if (step.op.kind === 'exec' && step.outcome === 'executed') {
          // navigate 帧展示动作前处境；执行成功后显式刷新同一 rel，让共享
          // 画布立即切到动作后的合同投影，避免“完成了但仍显示旧状态”。
          send({ type: 'focus', rel: step.rel, refresh: true });
        } else if (step.op.kind === 'exec-plan' && step.outcome === 'executed') {
          send({ type: 'focus', rel: step.rel, refresh: true });
        }
        const message = stepToMessage(step);
        send({ type: 'step', message, rel: step.rel });
        progressWrite = progressWrite.then(() =>
          appendChatProjection('chat-turn-progress', sessionId, {
            sessionId,
            turnId,
            message,
            step,
          }),
        );
      },
    },
  );

  const messages = trailToMessages(result);
  // max-steps 的上限说明不是轨迹步(无 TrailStep 可挂 onStep),补一帧,
  // 保持客户端「消息 = 各 step 帧文本」的重建口径与 trailToMessages 等值。
  for (const extra of messages.slice(result.steps.length)) {
    send({ type: 'step', message: extra });
    progressWrite = progressWrite.then(() =>
      appendChatProjection('chat-turn-progress', sessionId, { sessionId, turnId, message: extra }),
    );
  }
  await progressWrite;

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
    driver: resolved,
  };
  await appendChatProjection('chat-turn', sessionId, turnDetail);

  send({
    type: 'final',
    payload: {
      sessionId,
      driver: resolved,
      requestedDriver: requested,
      outcome: result.outcome,
      summary: result.summary ?? null,
      steps: result.steps,
      successes: result.successes,
    },
  });
}

/**
 * 渲染短路 LLM 路径的 SSE 化(inline 模式):思考增量(thinking-delta,
 * 单次生成步号恒 1)+ render 帧回执(与 JSON 回执同形,客户端处置等价);
 * 过闸失败/引擎异常同流交回 agent 循环(诚实失败口径不变:不留半成品
 * spec,不凝固)。delegated 模式不走此路(委托派发的阻塞 JSON 口径不变)。
 */
function sseRenderResponse(args: {
  engine: EngineRuntime;
  sitemap: RenderSitemapContext;
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  requested: 'llm' | 'auto';
  resolved: 'llm';
  baseUrl: string;
}): Response {
  const { engine, sitemap, goal, sessionId, turnId, requested, resolved, baseUrl } = args;
  return sseResponse(async (send) => {
    send({ type: 'session', sessionId, turnId });
    let handled = false;
    try {
      const llmGenerated = await generateRenderSpecWithLlm(
        { intent: goal.verb, sitemap, words: renderWordSummaries() },
        {},
        {
          onReasoningDelta: (piece) => {
            send({ type: 'thinking-delta', step: 1, text: piece });
          },
        },
      );
      if (llmGenerated !== undefined && llmSpecPassesGates(llmGenerated, sitemap)) {
        const payload = await frozenRenderPayload(
          engine,
          llmGenerated,
          sessionId,
          requested,
          resolved,
        );
        send({ type: 'render', payload });
        await appendChatProjection('chat-turn', sessionId, {
          sessionId,
          turnId,
          goal,
          outcome: 'done',
          summary: payload.summary,
          messages: payload.messages,
          steps: [],
          driver: resolved,
        });
        handled = true;
      }
    } catch {
      // 引擎/凝固故障:如实交回 agent 循环(同旧 JSON 路径的外层 catch 口径)。
    }
    if (!handled) {
      await streamAgentLoop({ send, goal, sessionId, turnId, requested, resolved, baseUrl });
    }
  });
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

  const { goal, sessionId, turnId, driver: requested, mode } = parsed;
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
        await streamAgentLoop({ send, goal, sessionId, turnId, requested, resolved, baseUrl });
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

  // 歧义发现意图只定位入口，不替用户选择 approve/reject/delete 等写动作。
  // 这是人类权威边界，不交给概率模型自由解释。
  if (mode === 'inline' && isDiscoveryOnlyIntent(goal.verb)) {
    const rel = await resolveStartRel(
      baseUrl,
      goal,
      (url, init) => fetch(url, init),
      baseUrl.endsWith('/_meta') ? 'meta/flows' : 'articles',
    );
    const canvasUrl = `/canvas?focus=${encodeURIComponent(rel)}`;
    const summary = `已定位 ${rel}；未执行具体动作`;
    const messages = [
      {
        role: 'assistant' as const,
        text: `已打开相关入口 ${rel}；你尚未指定通过、驳回等具体动作，因此没有修改数据。`,
      },
    ];
    await appendChatProjection('chat-turn', sessionId, {
      sessionId,
      turnId,
      goal,
      outcome: 'done',
      summary,
      messages,
      steps: [],
      driver: resolved,
    });
    return Response.json({
      sessionId,
      driver: resolved,
      requestedDriver: requested,
      outcome: 'done',
      summary,
      messages,
      steps: [],
      successes: [],
      focus: { rel, canvasUrl },
    });
  }

  // render capability(T7 Phase C / S5;T12 Phase A 起含 LLM fallthrough;
  // 本轮起 LLM 路径 inline 模式 SSE 化):展示类意图 → spec 生成 + 凝固。
  // 先于 inline/delegated 分派:渲染说明不是委托任务,也不进执行循环。
  // rule 命中 → 瞬时 JSON(形状自 T7 不变);rule miss 的展示意图:inline
  // 走 SSE(思考增量 + render 帧,过闸失败同流交回循环),delegated 保持
  // 阻塞 JSON(委托 UX 不变)。引擎不可达 → 原路交回下方既分派(口径不变)。
  try {
    const engine = await getEngine(getDb());
    const sitemap = engine.getSitemap();
    // 具体阅读优先于集合 render：从真实集合成员解析 title/序号，只回 focus rel。
    // focus 是临时共享处境，不 freeze、不把实体内容塞进响应。
    if (hasDisplayIntent(goal.verb)) {
      for (const surface of sitemap.surfaces.filter((candidate) => candidate.collection === true)) {
        const collection = await engine.getEntity(surface.rel);
        if (collection === undefined) continue;
        const rel = entityFocusForDisplayIntent(goal.verb, collection);
        if (rel === undefined) continue;
        const member = collection.entities?.find((candidate) => candidate.properties.rel === rel);
        const memberFields = member?.properties.fields;
        const title =
          typeof memberFields === 'object' && memberFields !== null && !Array.isArray(memberFields)
            ? (memberFields as Record<string, unknown>).title
            : undefined;
        const label = typeof title === 'string' && title !== '' ? title : rel;
        const canvasUrl = `/canvas?focus=${encodeURIComponent(rel)}`;
        const payload = {
          sessionId,
          driver: resolved,
          requestedDriver: requested,
          outcome: 'done',
          summary: `查看具体实体 ${label}`,
          messages: [
            { role: 'assistant' as const, text: `正在查看「${label}」→ 在画布打开:${canvasUrl}` },
          ],
          steps: [],
          successes: [],
          focus: { rel, canvasUrl },
        };
        await appendChatProjection('chat-turn', sessionId, {
          sessionId,
          turnId,
          goal,
          outcome: 'done',
          summary: payload.summary,
          messages: payload.messages,
          steps: [],
          driver: resolved,
        });
        return Response.json(payload);
      }
    }
    const generated = renderSpecFor(goal.verb, sitemap, engine.listFrozenSpecs());
    if (generated !== undefined) {
      const validation = validateSpec(generated);
      if (!validation.valid) {
        // 生成器产出非法 spec 属内部缺陷:如实失败,不落日志不渲染(零字面入口把关)。
        const summary = validation.errors
          .map((error) => `${error.path}: ${error.message}`)
          .join('; ');
        const payload = {
          sessionId,
          driver: resolved,
          requestedDriver: requested,
          outcome: 'failed',
          summary: `生成的渲染说明未过零字面校验: ${summary}`,
          messages: [
            { role: 'assistant' as const, text: `失败: 生成的渲染说明未过零字面校验: ${summary}` },
          ],
          steps: [],
          successes: [],
        };
        await appendChatProjection('chat-turn', sessionId, {
          sessionId,
          turnId,
          goal,
          outcome: 'failed',
          summary: payload.summary,
          messages: payload.messages,
          steps: [],
          driver: resolved,
        });
        return Response.json(payload);
      }
      const response = await respondWithFrozenSpec(
        engine,
        generated,
        sessionId,
        requested,
        resolved,
      );
      const payload = (await response.clone().json()) as ChatRenderPayload;
      await appendChatProjection('chat-turn', sessionId, {
        sessionId,
        turnId,
        goal,
        outcome: 'done',
        summary: payload.summary,
        messages: payload.messages,
        steps: [],
        driver: resolved,
      });
      return response;
    }
    // T12(架构决定 1):rule miss 的展示意图 → LLM fallthrough。仅展示意图
    // 进入(非展示意图直落既分派);inline 模式 SSE 化(思考增量 + render 帧,
    // 无 key 跳过 I1、端点/解析失败 undefined → 流内交回 agent 循环);
    // delegated 模式保持阻塞 JSON → 失败原样落委托派发。
    if (hasDisplayIntent(goal.verb)) {
      if (mode === 'delegated') {
        const llmGenerated = await generateRenderSpecWithLlm({
          intent: goal.verb,
          sitemap,
          words: renderWordSummaries(),
        });
        if (llmGenerated !== undefined && llmSpecPassesGates(llmGenerated, sitemap)) {
          const response = await respondWithFrozenSpec(
            engine,
            llmGenerated,
            sessionId,
            requested,
            resolved,
          );
          const payload = (await response.clone().json()) as ChatRenderPayload;
          await appendChatProjection('chat-turn', sessionId, {
            sessionId,
            turnId,
            goal,
            outcome: 'done',
            summary: payload.summary,
            messages: payload.messages,
            steps: [],
            driver: resolved,
          });
          return response;
        }
      } else {
        return sseRenderResponse({
          engine,
          sitemap,
          goal,
          sessionId,
          turnId,
          requested,
          resolved,
          baseUrl,
        });
      }
    }
  } catch {
    // 引擎/库故障:不吞——交回既分派,由循环或委托路径如实报告失败。
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
    await streamAgentLoop({ send, goal, sessionId, turnId, requested, resolved, baseUrl });
  });
}
