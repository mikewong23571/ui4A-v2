/**
 * worker deliverNotification activity(apps/worker/src/activities.ts)的测试镜像。
 *
 * 与 worker 真身保持同构:notificationId = `notif:<confirmation.id>`,按
 * (kind, rel) 精确匹配跳过重复送达(deduplicated=true),否则经 web 自己的
 * 事件日志边界 appendEvent 一条 notification-delivered(channel='notify')。
 * 仅供 web 侧双写一致性/回放测试模拟"worker 写侧追加",不构成生产代码路径
 * (T23 GR1:web 测试不得跨 app import worker 生产代码)。
 */
import type { DbExecutor } from '../db/events';
import { appendEvent } from '../db/events';

/** 与 apps/worker/src/workflows.ts NotifyConfirmation 同构的确认摘要。 */
export interface NotifyConfirmationFixture {
  id: string;
  targetRel: string;
  targetAction: string;
  proposedBy: { actor: 'human' | 'agent'; principal?: string };
  reason?: string;
}

/** 幂等键:事件表无业务唯一约束,按 (kind, rel) 精确匹配已送达通知。 */
async function findDelivered(db: DbExecutor, rel: string): Promise<number | null> {
  const result = await db.query<{ seq: string | number }>(
    'SELECT seq FROM events WHERE kind = $1 AND rel = $2 LIMIT 1',
    ['notification-delivered', rel],
  );
  return (result.rowCount ?? 0) > 0 ? Number(result.rows[0]!.seq) : null;
}

/** 送达:已送达则跳过;否则 append notification-delivered(detail 含 inbox 条目数据)。 */
export async function deliverNotification(
  db: DbExecutor,
  confirmation: NotifyConfirmationFixture,
): Promise<{ seq: number; deduplicated: boolean }> {
  const rel = `confirmation:${confirmation.id}`;
  const existing = await findDelivered(db, rel);
  if (existing !== null) {
    return { seq: existing, deduplicated: true };
  }
  const appended = await appendEvent(db, {
    kind: 'notification-delivered',
    rel,
    actor: confirmation.proposedBy.actor,
    principal: confirmation.proposedBy.principal,
    channel: 'notify',
    detail: {
      notificationId: `notif:${confirmation.id}`,
      confirmation,
    },
  });
  return { seq: appended.seq, deduplicated: false };
}
