/**
 * notify activity(T3 Phase C):第一个 capability 的落地。
 *
 * 效果动词"触达"(arch-brief §3):向人类送达确认门通知。T3 的物理信道是
 * 事件日志 + 收件箱投影(Web Push/SMTP 后续切片叠加);因此 activity 的全部
 * 职责 = 向**同一 PG 事件日志**追加 `notification-delivered` 事件
 * (spec 架构决定 4 双写者方案:worker 直接 appendEvent,web 读路径按 seq
 * 增量 fold 看见)。
 *
 * 幂等方案(activity 层检查,报告口径):
 * - Temporal workflowId(`notify-<id>`)防并发重复派发;
 * - activity 内先查同 rel 的 notification-delivered 是否已存在,存在即跳过
 *   (重试/重跑不双写);fold 对重复送达事件同样幂等(engine fold 分支)。
 */
import type { DbExecutor } from '../../../web/src/db/events';
import { appendEvent } from '../../../web/src/db/events';

import type { NotifyConfirmation } from '../workflows';
import { workerDb } from '../worker-db';
import { findEvent } from './event-log';

/** activity 注册表(workflow 经 proxyActivities 按名调用)。 */
export interface NotifyActivities {
  notify(confirmation: NotifyConfirmation): Promise<{ seq: number; deduplicated: boolean }>;
}

/** notification-delivered 事件的 detail 载荷:inbox 条目数据(Phase D 收件箱渲染输入)。 */
export interface NotificationDeliveredDetail {
  /** 通知去重键(spec:notificationId = `notif:<confirmation.id>`)。 */
  notificationId: string;
  /** 确认摘要(提议者/目标/策略原因——人类在推送上做决定所需的全部信息)。 */
  confirmation: NotifyConfirmation;
}

function findDelivered(db: DbExecutor, rel: string): Promise<number | null> {
  return findEvent(db, 'notification-delivered', rel);
}

/**
 * 送达核心(db 注入,单测用假 DbExecutor):
 * 写 notification-delivered(rel=confirmation:<id>,detail 含 inbox 条目数据);
 * 已送达则跳过(deduplicated=true)。Worker 启动前必须已完成显式 migration。
 */
export async function deliverNotification(
  db: DbExecutor,
  confirmation: NotifyConfirmation,
): Promise<{ seq: number; deduplicated: boolean }> {
  const rel = `confirmation:${confirmation.id}`;
  const existing = await findDelivered(db, rel);
  if (existing !== null) {
    return { seq: existing, deduplicated: true };
  }
  const detail: NotificationDeliveredDetail = {
    notificationId: `notif:${confirmation.id}`,
    confirmation,
  };
  const appended = await appendEvent(db, {
    kind: 'notification-delivered',
    rel,
    actor: confirmation.proposedBy.actor,
    principal: confirmation.proposedBy.principal,
    channel: 'notify',
    detail,
  });
  return { seq: appended.seq, deduplicated: false };
}

/** Temporal activity 入口(注册名 notify);委托 deliverNotification。 */
export async function notify(
  confirmation: NotifyConfirmation,
): Promise<{ seq: number; deduplicated: boolean }> {
  return deliverNotification(workerDb(), confirmation);
}
