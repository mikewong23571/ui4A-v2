import type { FieldValue } from '@ui4a/shared';

import type { DbExecutor, EventDomain, EventKind, StoredEvent } from '../events';

export interface ListEventsOptions {
  domain?: EventDomain;
  rel?: string;
  kind?: string;
  principal?: string;
  limit?: number;
  order?: 'asc' | 'desc';
  beforeSeq?: number;
}

interface StoredEventRow {
  domain: EventDomain;
  seq: string | number;
  ts: Date;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
  kind: EventKind;
  rel: string | null;
  action: string | null;
  params: Record<string, FieldValue>;
  reason: string | null;
  detail: unknown;
}

/** Default ascending replay reads stay stable; human audit feeds opt into descending cursors. */
export async function listEvents(
  db: DbExecutor,
  afterSeq = 0,
  options?: ListEventsOptions,
): Promise<StoredEvent[]> {
  const limit = options?.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 101)) {
    throw new Error('event limit must be an integer between 1 and 101');
  }
  const order = options?.order ?? 'asc';
  const beforeSeq = options?.beforeSeq;
  if (beforeSeq !== undefined && (!Number.isInteger(beforeSeq) || beforeSeq < 1)) {
    throw new Error('event beforeSeq must be a positive integer');
  }
  if (order === 'asc' && beforeSeq !== undefined) {
    throw new Error('event beforeSeq requires descending order');
  }
  if (order === 'desc' && afterSeq !== 0) {
    throw new Error('event afterSeq requires ascending order');
  }

  const values: unknown[] = [];
  const where: string[] = [];
  if (order === 'asc') {
    values.push(afterSeq);
    where.push('seq > $1');
  } else if (beforeSeq !== undefined) {
    values.push(beforeSeq);
    where.push('seq < $1');
  }
  if (options?.domain !== undefined) {
    values.push(options.domain);
    where.push(`domain = $${values.length}`);
  }
  for (const [column, value] of [
    ['rel', options?.rel],
    ['kind', options?.kind],
    ['principal', options?.principal],
  ] as const) {
    if (value !== undefined) {
      values.push(value);
      where.push(`${column} = $${values.length}`);
    }
  }

  const limitSql = limit === undefined ? '' : ` LIMIT $${values.push(limit)}`;
  const whereSql = where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`;
  const result = await db.query<StoredEventRow>(
    `SELECT seq, ts, domain, actor, principal, channel, kind, rel, action, params, reason, detail
     FROM events${whereSql} ORDER BY seq ${order === 'asc' ? 'ASC' : 'DESC'}${limitSql}`,
    values,
  );
  return result.rows.map((row) => ({
    domain: row.domain,
    seq: Number(row.seq),
    ts: new Date(row.ts).toISOString(),
    actor: row.actor,
    principal: row.principal,
    channel: row.channel,
    kind: row.kind,
    rel: row.rel,
    action: row.action,
    params: row.params ?? {},
    reason: row.reason,
    detail: row.detail ?? null,
  }));
}
