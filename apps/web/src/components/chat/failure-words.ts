/**
 * 失败措辞分层(T24 Phase B Task 3)的固定结构词汇:结构化 reason → 中性
 * 展示行。纯常量格式——零友好文案模板(红线:文案滑梯;主叙句只能来自 LLM
 * phrasing,缺席时以结构标签 + 机械数据如实呈现)。
 *
 * 与 step-activity-words 同源纪律:固定格式常量;label 是结构标签(「失败」
 * 「已尝试」)不是叙事;数据字段(code/tried)原样输出,客户端零猜测。
 */
import type { ChatFailureReason } from '@/chat/sse';

/**
 * metadata.custom.failure 边界的运行时形状守卫(外部 store 的 custom 是
 * unknown 通道);命中时返回原引用——选择器以 Object.is 判稳,不得重建对象。
 */
export function isChatFailureReason(value: unknown): value is ChatFailureReason {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['code'] === 'string' && record['code'] !== '';
}

/**
 * 无 LLM 表述时的中性结构化主行:「失败 · code={code} · 已尝试:{tried 概要}」。
 * 结构标签 + 机械数据,零叙事;tried 缺省(零轨迹失败)时省略已尝试段。
 */
export function failureNeutralLine(failure: ChatFailureReason): string {
  const tried = failure.tried ?? [];
  const triedPart = tried.length > 0 ? ` · 已尝试:${tried.join('、')}` : '';
  return `失败 · code=${failure.code}${triedPart}`;
}
