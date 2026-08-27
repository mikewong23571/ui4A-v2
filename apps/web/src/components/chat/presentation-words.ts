/**
 * presentation 回执条目的固定结构词汇(SSE presentation 帧,pending 占位 →
 * 终局 ready/fallback/failed 两帧必达):pending 占位文案与 failed 的
 * reasonCode → 中性短语映射。与 step-activity-words/failure-words 同源纪律:
 * 纯常量映射,零友好文案模板,不编造原因——已知 code 查表出短语,未知/缺失
 * code 只留通用主行;机制词(reasonCode 原文)只作末尾次要附属信息。
 * reasonCode 字面量来自 @ui4a/shared 的 D51 taxonomy 常量,禁止两处字面量漂移。
 */
import {
  PRESENTATION_DENIED_AUDIENCE_UNREACHABLE,
  PRESENTATION_DENIED_SUBJECT_UNAVAILABLE,
} from '@ui4a/shared';

/** pending 占位文案(回执不携 subject,中性直白;零机制词)。 */
export const PRESENTATION_PENDING_WORD = '正在准备呈现';

/** 已知 reasonCode → 中性短语(主行附属;协议演进新增 code 直接追加字面量)。 */
export const PRESENTATION_FAILURE_WORDS: Readonly<Record<string, string>> = {
  'authorization-failed': '未获授权',
  'planning-failed': '无法准备呈现',
  'partial-authorization': '部分内容未获授权',
  [PRESENTATION_DENIED_AUDIENCE_UNREACHABLE]: '所属应用未启用',
  [PRESENTATION_DENIED_SUBJECT_UNAVAILABLE]: '没有这个内容',
};

/** 未知/缺失 reasonCode 的通用主行(不编造原因)。 */
export const PRESENTATION_FAILURE_GENERIC = '呈现失败';

/**
 * failed 条目全文:主行「呈现失败」+ 已知 code 的中性短语;reasonCode 原文
 * 只作末尾次要附属信息(reasonCode=…);未知 code 与缺失时均不伪造短语。
 */
export function presentationFailureText(reasonCode: string | undefined): string {
  const gloss = reasonCode !== undefined ? PRESENTATION_FAILURE_WORDS[reasonCode] : undefined;
  const head =
    gloss !== undefined
      ? `${PRESENTATION_FAILURE_GENERIC} · ${gloss}`
      : PRESENTATION_FAILURE_GENERIC;
  return reasonCode !== undefined ? `${head} · reasonCode=${reasonCode}` : head;
}
