/**
 * /api/chat SSE 帧协议(T9 Phase B / B1)的客户端读取器。
 *
 * 帧协议(每帧一条 `data: <json>\n\n`):
 * - {type:'step', turnId, message:{role:'assistant',text}, rel?, activity?,
 *   eventSeq?} —— 轨迹一步(text 为 trail.ts stepToMessage 口径的机器层原文;
 *   rel 供 flow 徽章展示;T24 Phase B 起 activity 携带 {op, title?, subject?}
 *   结构化显示数据——op 为 agent 协议动词,title/subject 由服务器从实体/
 *   动作合同取,客户端按固定 op 词表渲染活动语言)。轨迹步帧必附 activity;
 *   无 activity 的 step 帧仅用于轨迹之外的补充说明(如 max-steps 上限说明),
 *   客户端按机器原文中性显示。eventSeq 为本步 chat-turn-progress 事件的日志
 *   seq,供审计下钻定位;落库失败时缺省(下钻退事件流页,不伪造定位参数)。
 * - {type:'thinking-delta', turnId, step, text} —— 推理增量片段(逐 raw chunk 到达
 *   即推;客户端同号原地累积);
 * - {type:'thinking', turnId, step, text} —— llm 步推理自述(T11 Phase C:聚合整段
 *   权威终帧,先于同号 step 帧;到达时替换同号累积;rule driver / 端点不返回
 *   reasoning 时零帧);
 * - {type:'render', turnId, payload} —— 渲染回执帧(渲染短路 LLM 路径 SSE 化:
 *   payload 与一次性 JSON 回执同形状,rule 命中路径仍走 JSON);
 * - {type:'heartbeat'} —— 长回合连接保活(不产生消息,只刷新客户端空闲计时);
 * - {type:'final', turnId, payload:{sessionId, turnId, driver, requestedDriver, outcome,
 *   summary, steps, successes, render?, reason?}} —— 回合终帧;失败终局
 *   (T24 Phase B Task 3)必附 reason={code, evidence?, tried?, phrasing?} 结构化
 *   失败数据(phrasing 为 LLM 在场时的表述,缺席=诚实降级为中性结构化展示),
 *   summary 保留为机器层/审计数据;
 * - {type:'error', error, reason} —— 服务端兜底(循环异常,200 流内如实报告),
 *   必附结构化失败 reason(D48:error 帧恒为客户端中性结构化呈现,LLM 表述
 *   仅覆盖 final 帧——见 DECISIONS D48 第 4 小节)。
 *
 * 停止/超时(B2/B1):signal 中止时主动 cancel reader——真实 fetch 的流会随
 * signal 报错,而测试桩的手造流不会;显式 cancel 让两种来源行为一致,
 * 读完以 signal.reason 抛出(AbortError / TimeoutError 由调用方折算文案)。
 */
import type { AgentOutcome, ExecSuccess, FactRef, TrailStep } from '@ui4a/agent';
import type { PresentationReceipt } from '@ui4a/shared';

/** step 帧的 assistant 消息(trail.ts stepToMessage 口径;机器层原文)。 */
export interface ChatStepMessage {
  role: 'assistant';
  text: string;
}

/**
 * step 帧的结构化活动数据(T24 Phase B):主呈现用「正在做什么」的活动语言,
 * 由客户端固定 op 词表渲染。op 是 agent 协议动词原样(AgentOperation kind);
 * title/subject 由服务器从合同(sitemap 表面标题/流程动作标题)取,客户端
 * 零猜测、零每实体分支。
 */
export interface ChatStepActivity {
  /** agent 协议动词(navigate/exec/present/answer/…);未知值客户端中性回退。 */
  op: string;
  /** 服务器自合同解析的标题(navigate 的表面/流程标题、exec 的动作标题)。 */
  title?: string;
  /** present 的呈现对象(字符串原样;selection 以「、」联结,服务器侧完成)。 */
  subject?: string;
}

/**
 * 结构化失败 reason(T24 Phase B Task 3:失败措辞分层):机械层只产结构化
 * 数据——code 为机械失败码(no_progress_loop / driver_fail /
 * start_entity_unavailable / loop_exception),evidence 为机械事实原文,
 * tried 为已尝试步骤概要;phrasing 是 LLM 在场时生成的面向用户表述
 * (AI-first:缺席 = 诚实降级,客户端走中性结构化展示,不伪造)。
 */
export interface ChatFailureReason {
  /** 机械失败码(结构化数据,不是面向用户叙句)。 */
  code: string;
  /** 机械事实(协议/合同层原文;审计视角)。 */
  evidence?: string[];
  /** 已尝试步骤的简短列举(机器投影;完整轨迹在 final.steps)。 */
  tried?: string[];
  /** LLM 生成的面向用户表述;LLM 不可用/调用失败时缺省。 */
  phrasing?: string;
}

/** final 帧载荷的基础字段(结局无关;outcome 决定 reason 的在场性,见下)。 */
interface ChatFinalPayloadBase {
  sessionId: string;
  turnId: string;
  driver: 'llm';
  requestedDriver: 'llm' | 'auto';
  summary: string | null;
  steps: TrailStep[];
  successes: ExecSuccess[];
  sources?: FactRef[];
  presentationRequestIds?: string[];
  render?: {
    concern: string;
    canvasUrl: string;
  };
}

/**
 * final 帧载荷(inline 回合的完整结果投影)。协议不变式(T24 Phase B
 * Task 3):outcome='failed' 时必附结构化 reason——类型层直接编码该不变式,
 * 不存在「failed 而 reason 缺席」的第二实现路径。
 */
export type ChatFinalPayload =
  | (ChatFinalPayloadBase & { outcome: Exclude<AgentOutcome, 'failed'> })
  | (ChatFinalPayloadBase & { outcome: 'failed'; reason: ChatFailureReason });

/** render 帧载荷(渲染短路 LLM 路径的回执;与一次性 JSON 回执同形状)。 */
export interface ChatRenderPayload {
  sessionId: string;
  turnId: string;
  driver: 'llm';
  requestedDriver: 'llm' | 'auto';
  outcome: string;
  summary: string;
  messages: { role: 'assistant'; text: string }[];
  steps: [];
  successes: [];
  render: {
    concern: string;
    spec: unknown;
    frozenNow: boolean;
    canvasUrl: string;
  };
}

export type ChatSseFrame =
  | { type: 'session'; sessionId: string; turnId: string }
  | { type: 'focus'; turnId: string; rel: string; refresh?: boolean }
  | { type: 'heartbeat' }
  | {
      type: 'step';
      turnId: string;
      message: ChatStepMessage;
      /** 步骤实体的 rel(flow 徽章展示用);轨迹外补充说明帧缺省。 */
      rel?: string;
      /**
       * 结构化活动数据(T24 Phase B)。轨迹步帧必附;缺席仅见于轨迹外的
       * 补充说明帧(如 max-steps 上限说明),客户端按机器原文中性显示。
       */
      activity?: ChatStepActivity;
      /** 本步 chat-turn-progress 事件的日志 seq(审计下钻定位);落库失败时缺省。 */
      eventSeq?: number;
    }
  | { type: 'thinking-delta'; turnId: string; step: number; text: string }
  | { type: 'thinking'; turnId: string; step: number; text: string }
  | { type: 'render'; turnId: string; payload: ChatRenderPayload }
  | { type: 'presentation'; turnId: string; payload: PresentationReceipt }
  | { type: 'final'; turnId: string; payload: ChatFinalPayload }
  | {
      type: 'error';
      error: string;
      /** 循环异常兜底的结构化 reason(T24 Phase B Task 3);服务端必附。 */
      reason: ChatFailureReason;
    };

/** AbortSignal.any 的便携版(jsdom 等环境可能缺该静态方法)。 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** AbortSignal.timeout 的便携版(回退路径以 TimeoutError 名义中止)。 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
  }, ms);
  // Node 侧(timer 有 unref)不拖累进程退出;浏览器无此方法。
  (timer as { unref?: () => void }).unref?.();
  return controller.signal;
}

/**
 * 可续期的空闲超时。与固定总时长不同，每个有效 SSE 帧（含 heartbeat）都会
 * touch；因此持续产出超过 120s 的正常回合不会被误杀，真正静默才中止。
 */
export function createIdleTimeout(ms: number): {
  signal: AbortSignal;
  touch: () => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = (): void => {
    if (controller.signal.aborted) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(new DOMException('The stream was idle too long.', 'TimeoutError'));
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  };
  const dispose = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  touch();
  return { signal: controller.signal, touch, dispose };
}

/** 逐帧读取 SSE 流;signal 中止时取消读取并以 signal.reason 抛出。 */
export async function readChatSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onFrame: (frame: ChatSseFrame) => void,
): Promise<void> {
  const reader = body.getReader();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort);
  try {
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((candidate) => candidate.startsWith('data:'));
        if (line === undefined) continue;
        onFrame(JSON.parse(line.slice('data:'.length).trim()) as ChatSseFrame);
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  // 手造流(测试桩)随 cancel 正常读完而非报错:以中止原因补齐拒绝语义。
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('请求已中止');
  }
}
