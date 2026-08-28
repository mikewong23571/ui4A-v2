import type { SirenEntity } from '@ui4a/engine';

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

export interface ThreadDeskProps {
  threadId: string;
  scope?: string;
}
