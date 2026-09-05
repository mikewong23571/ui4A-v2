import type { SirenEntity, SirenFieldPresentation } from '@ui4a/engine';

/** 线工作台书桌/舞台共享的纯工具:事件通道与实体声明字段读取(零发明)。 */

/** 书桌/舞台共享的线程更新事件:exec 成功后各消费方自行重读(单一路径)。 */
export const THREAD_UPDATED_EVENT = 'ui4a:thread-updated';

export function notifyThreadUpdated(threadRel: string): void {
  window.dispatchEvent(new CustomEvent(THREAD_UPDATED_EVENT, { detail: threadRel }));
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** 实体的一行业务身份:声明字段优先,回退 rel(零发明)。 */
export function identityOf(entity: SirenEntity): string {
  return (
    firstString(entity.properties.identity, entity.properties.title) ??
    String(entity.properties.rel ?? '')
  );
}

/** 实体的状态 chip 文案:任务语字段优先(statusText/节点标题/机器名);与身份
 * 重复时跳过(成员投影的 title=节点标题,实例投影的 title=业务标题,形状不一,
 * 不得把业务标题二次渲染成 chip)。 */
export function statusOf(entity: SirenEntity): string | undefined {
  const identity = identityOf(entity);
  for (const candidate of [
    entity.properties.statusText,
    entity.properties.title,
    entity.properties.status,
  ]) {
    if (typeof candidate === 'string' && candidate !== '' && candidate !== identity) {
      return candidate;
    }
  }
  return undefined;
}

export function relOf(entity: SirenEntity): string {
  return firstString(entity.properties.rel) ?? '';
}

// ---- 对象选择器候选标题(G07 DoD2:可区分、声明驱动、零猜测)---------------------

/** 选择器候选的一行身份及其来源:declared=true 表示文本取自成员的逐成员字段
 * 声明(identity 角色字段值,或 primary-content/overview 声明序的字段值);
 * false 表示仅来自投影回退(identity/title)——可能是集合级常量(如 flow 标题
 * 兜底成每个成员的 identity),调用方据此做「全组同名零区分度」判定。 */
export interface SelectorCandidateLabel {
  text: string;
  declared: boolean;
}

/** 按 'properties.fields.title' 式声明路径读取成员实体的引用值(零复制)。 */
function readMemberPath(member: SirenEntity, path: string): unknown {
  let current: unknown = member;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** 标量文本:空白视同缺;对象/数组不成行(不猜测标题)。 */
function memberScalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** 成员携带的字段呈现声明(properties.presentation.fields,非数组/非对象跳过)。 */
function declaredPresentations(member: SirenEntity): readonly SirenFieldPresentation[] {
  const presentation = member.properties.presentation;
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) {
    return [];
  }
  const fields = (presentation as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (field): field is SirenFieldPresentation =>
      typeof field === 'object' &&
      field !== null &&
      !Array.isArray(field) &&
      typeof (field as { path?: unknown }).path === 'string',
  );
}

/**
 * 选择器候选成员的一行可区分身份(声明驱动,如实使用):
 * 声明 identity 角色字段值 → 声明 primary-content/overview 字段值(声明序,
 * 首个非空;如评论成员的正文)→ 投影 identity/title 回退(declared=false)。
 * 全缺返回 undefined——调用方用 rel 兜底,不替合同造标题。
 */
export function selectorCandidateLabel(member: SirenEntity): SelectorCandidateLabel | undefined {
  const declared = declaredPresentations(member);
  const identityDeclared = declared
    .filter((field) => field.role === 'identity')
    .map((field) => memberScalarText(readMemberPath(member, field.path)))
    .find((text) => text !== undefined);
  if (identityDeclared !== undefined) return { text: identityDeclared, declared: true };
  const contentDeclared = declared
    .filter((field) => field.role === 'primary-content' || field.overview === true)
    .map((field) => memberScalarText(readMemberPath(member, field.path)))
    .find((text) => text !== undefined);
  if (contentDeclared !== undefined) return { text: contentDeclared, declared: true };
  const fallback = firstString(member.properties.identity, member.properties.title);
  return fallback === undefined ? undefined : { text: fallback, declared: false };
}

/**
 * 全组候选共用同一「非声明」标签时,该标签是集合级常量兜底(典型:flow 标题
 * 被投影成每个成员的 identity),零区分度——如实退 rel,不猜测标题。
 * 声明字段值(declared)即使撞名也原样保留(合同标题如实使用)。
 */
export function collapseSharedFallbackLabel<
  T extends { rel: string; identity: string; labelDeclared: boolean },
>(members: readonly T[]): T[] {
  if (members.length < 2) return [...members];
  const shared = members[0]!.identity;
  if (members.some((member) => member.labelDeclared || member.identity !== shared)) {
    return [...members];
  }
  return members.map((member) => ({ ...member, identity: member.rel }));
}

export interface ThreadDeskProps {
  threadId: string;
  scope?: string;
}
