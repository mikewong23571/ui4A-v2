import type { DbExecutor } from '../../../web/src/db/events';

/** 幂等键:事件表无业务唯一约束,按 (kind, rel) 精确匹配已写入事件。 */
export function findEvent(db: DbExecutor, kind: string, rel: string): Promise<number | null> {
  return db
    .query<{ seq: string | number }>(
      'SELECT seq FROM events WHERE kind = $1 AND rel = $2 LIMIT 1',
      [kind, rel],
    )
    .then((result) => ((result.rowCount ?? 0) > 0 ? Number(result.rows[0]!.seq) : null));
}
