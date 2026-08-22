/**
 * /api/chat SSE 帧协议(T9 Phase B / B1)的客户端读取器。
 *
 * 帧协议(每帧一条 `data: <json>\n\n`):
 * - {type:'step', message:{role:'assistant',text}, rel?} —— 轨迹一步
 *   (text 为 trail.ts stepToMessage 口径;rel 供 flow 徽章展示);
 * - {type:'thinking-delta', step, text} —— 推理增量片段(逐 raw chunk 到达
 *   即推;客户端同号原地累积);
 * - {type:'thinking', step, text} —— llm 步推理自述(T11 Phase C:聚合整段
 *   权威终帧,先于同号 step 帧;到达时替换同号累积;rule driver / 端点不返回
 *   reasoning 时零帧);
 * - {type:'render', payload} —— 渲染回执帧(渲染短路 LLM 路径 SSE 化:
 *   payload 与一次性 JSON 回执同形状,rule 命中路径仍走 JSON);
 * - {type:'heartbeat'} —— 长回合连接保活(不产生消息,只刷新客户端空闲计时);
 * - {type:'final', payload:{sessionId, driver, requestedDriver, outcome,
 *   summary, steps, successes, render?}} —— 回合终帧;
 * - {type:'error', error} —— 服务端兜底(循环异常,200 流内如实报告)。
 *
 * 停止/超时(B2/B1):signal 中止时主动 cancel reader——真实 fetch 的流会随
 * signal 报错,而测试桩的手造流不会;显式 cancel 让两种来源行为一致,
 * 读完以 signal.reason 抛出(AbortError / TimeoutError 由调用方折算文案)。
 */
import type { AgentOutcome, ExecSuccess, TrailStep } from '@ui4a/agent';

/** step 帧的 assistant 消息(trail.ts stepToMessage 口径)。 */
export interface ChatStepMessage {
  role: 'assistant';
  text: string;
}

/** final 帧载荷(inline 回合的完整结果投影)。 */
export interface ChatFinalPayload {
  sessionId: string;
  driver: 'rule' | 'llm';
  requestedDriver: 'rule' | 'llm' | 'auto';
  outcome: AgentOutcome;
  summary: string | null;
  steps: TrailStep[];
  successes: ExecSuccess[];
  render?: {
    concern: string;
    canvasUrl: string;
  };
}

/** render 帧载荷(渲染短路 LLM 路径的回执;与一次性 JSON 回执同形状)。 */
export interface ChatRenderPayload {
  sessionId: string;
  driver: 'rule' | 'llm';
  requestedDriver: 'rule' | 'llm' | 'auto';
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
  | { type: 'focus'; rel: string }
  | { type: 'heartbeat' }
  | { type: 'step'; message: ChatStepMessage; rel?: string }
  | { type: 'thinking-delta'; step: number; text: string }
  | { type: 'thinking'; step: number; text: string }
  | { type: 'render'; payload: ChatRenderPayload }
  | { type: 'final'; payload: ChatFinalPayload }
  | { type: 'error'; error: string };

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
