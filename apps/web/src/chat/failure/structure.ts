import type { AgentRunResult, TrailStep } from '@ui4a/agent';
import type { ChatFailureReason } from '../sse';
import { stepToMessage } from '../trail';

/** T24/T25 机械失败码闭包；新增来源必须先显式修改这份合同与行为测试。 */
export const CHAT_FAILURE_REASON_CODES = [
  'no_progress_loop',
  'driver_fail',
  'start_entity_unavailable',
  'loop_exception',
] as const;

/** tried 概要上限(完整轨迹在 final.steps,审计不裁剪)。 */
const TRIED_CAP = 6;

/**
 * 已尝试步骤概要:终局 fail 步以外的轨迹步 → trail.ts 机器投影文本,
 * 有界保留最近 TRIED_CAP 条;零轨迹步(起始实体不可得)返回 undefined。
 */
function triedBrief(steps: TrailStep[]): string[] | undefined {
  const tried = steps
    .filter((step) => step.outcome !== 'failed')
    .map((step) => stepToMessage(step).text);
  if (tried.length === 0) return undefined;
  return tried.slice(-TRIED_CAP);
}

/**
 * 失败终局 → 结构化 reason(纯函数,无 LLM):非失败终局返回 undefined。
 * 机器句子(result.summary === fail op.reason)进 evidence 首行,作为机械层
 * 数据可达;面向用户的表述由 phraseFailureWithLlm 另行生成。
 */
export function failureReasonFromResult(
  result: Pick<AgentRunResult, 'outcome' | 'summary' | 'steps'>,
): ChatFailureReason | undefined {
  if (result.outcome !== 'failed') return undefined;
  const lastOp = result.steps.at(-1)?.op;
  if (lastOp?.kind === 'fail') {
    return {
      // Agent 循环当前唯一机械终止码是 no_progress_loop；driver 自述 fail
      // （包括未知/越界 code）统一归 driver_fail，避免扩张 Chat 失败码合同。
      code: lastOp.code === 'no_progress_loop' ? 'no_progress_loop' : 'driver_fail',
      evidence: [lastOp.reason, ...(lastOp.evidence ?? [])],
      ...(triedBrief(result.steps) !== undefined ? { tried: triedBrief(result.steps) } : {}),
    };
  }
  // 零轨迹失败:起始实体不可得(循环在第一步取实体时即返回)。
  return {
    code: 'start_entity_unavailable',
    evidence: [result.summary ?? '(无摘要)'],
  };
}

/** SSE 循环壳异常 → 固定结构化 reason；保留既有原文和 evidence 分层。 */
export function failureReasonFromLoopException(error: unknown): ChatFailureReason {
  const sentence = `聊天循环异常: ${error instanceof Error ? error.message : String(error)}`;
  return { code: 'loop_exception', evidence: [sentence] };
}
