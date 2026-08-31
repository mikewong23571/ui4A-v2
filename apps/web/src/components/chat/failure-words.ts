/**
 * 失败措辞分层(T24 Phase B Task 3)的固定结构词汇:结构化 reason → 中性
 * 展示行。纯常量格式——零友好文案模板(红线:文案滑梯;主叙句只能来自 LLM
 * phrasing,缺席时以结构标签 + 机械数据如实呈现)。
 *
 * 与 step-activity-words 同源纪律:固定格式常量;label 是结构标签(「失败」
 * 「已尝试」)不是叙事;数据字段(code/tried)原样输出,客户端零猜测。
 * T40 B1 起同模块承载起步降级 notice 的固定结构词汇(noticeNeutralLine):
 * 主行只做 D47.1 式固定框架插值(合同 sitemap 标题)或结构标签 + 机械数据。
 */
import type { ChatFailureReason, ChatStartNotice } from '@/chat/sse';

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
 * 起步降级 notice 的形状守卫(T40 B1,metadata.custom.notice 通道):
 * 只认 focus_degraded 码 + 机械 rel 事实,其余形状中性回退。
 */
export function isChatStartNotice(value: unknown): value is ChatStartNotice {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['code'] === 'focus_degraded' &&
    typeof record['droppedRel'] === 'string' &&
    typeof record['startedRel'] === 'string'
  );
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

/**
 * 注视降级 notice 的中性结构化主行(T40 B1):合同 sitemap 标题在场时用
 * D47.1 式固定框架插值(「已从「{startedTitle}」继续」,零叙事);标题缺席
 * (如 meta 兜底面不在业务 sitemap)时回结构标签 + 机械数据,与
 * failureNeutralLine 同纪律——机械 code 不进主行,退折叠层。
 */
export function noticeNeutralLine(notice: ChatStartNotice): string {
  if (notice.startedTitle !== undefined) return `已从「${notice.startedTitle}」继续`;
  return `注视已调整 · 原注视:${notice.droppedRel}`;
}
