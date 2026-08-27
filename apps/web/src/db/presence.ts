import { createHash } from 'node:crypto';

import {
  parsePresenceChange,
  presenceChangeKind,
  presenceEventKind,
  presenceValuesEqual,
  PRESENCE_MAX_EVENTS_PER_WINDOW,
  type PresenceChange,
  type PresenceEventKind,
  type PresenceProjection,
  type PresenceSnapshot,
  type PresenceValue,
} from '@ui4a/shared';
import {
  appendEvent,
  ensureEventsTable,
  type ConnectableDb,
  type DbExecutor,
  type EventKind,
} from './events';

export const PRESENCE_DDL = `
CREATE TABLE IF NOT EXISTS presence_current (
  principal   TEXT PRIMARY KEY,
  site        TEXT,
  scope       TEXT,
  thread      TEXT,
  focus       JSONB,
  updated_seq BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS presence_events_principal_seq
  ON events (principal, seq)
  WHERE domain = 'presence';
`;

export interface PresenceEventRow {
  seq: number;
  principal: string;
  kind: PresenceEventKind;
  detail: PresenceChange;
}

export interface AppendPresenceIdentity {
  principal: string;
  actor: 'human' | 'agent';
  channel: string;
}

export class PresenceRateLimitError extends Error {
  readonly code = 'presence_rate_limited';

  constructor() {
    super('presence changes exceeded the bounded rate limit');
  }
}

async function withTransaction<T>(db: ConnectableDb, run: (client: DbExecutor) => Promise<T>) {
  const acquired = db.connect === undefined ? db : await db.connect();
  const client = acquired as DbExecutor;
  await client.query('BEGIN');
  try {
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if ('release' in acquired && typeof acquired.release === 'function') acquired.release();
  }
}

export async function ensurePresenceTables(db: DbExecutor): Promise<void> {
  // 生产运行时角色无 DDL 权限:presence_current 由版本化迁移(见 migrations.ts
  // version 2)以 migration 角色创建,运行时只读写;本地/测试保持懒建便利。
  if (process.env.UI4A_DEPLOYMENT_PROFILE === 'production') return;
  await ensureEventsTable(db);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740936)');
    await db.query(PRESENCE_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function emptyProjection(principal: string): PresenceProjection {
  return { principal, site: null, scope: null, thread: null, focus: null, updatedSeq: 0 };
}

function valueOf(projection: PresenceProjection, kind: PresenceChange['kind']): PresenceValue {
  return projection[kind];
}

function applyChange(
  previous: PresenceProjection,
  change: PresenceChange,
  seq: number,
): PresenceProjection {
  return {
    ...previous,
    [change.kind]: change.value,
    updatedSeq: Math.max(previous.updatedSeq, seq),
  } as PresenceProjection;
}

/** Pure independent fold for presence events; it never enters the Business Snapshot. */
export function foldPresenceEvents(events: readonly PresenceEventRow[]): PresenceSnapshot {
  const snapshot: PresenceSnapshot = {};
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    const kind = presenceChangeKind(event.kind);
    if (kind === undefined || event.detail.kind !== kind) {
      throw new Error(`invalid presence event at seq=${event.seq}`);
    }
    const change = parsePresenceChange(event.detail);
    const previous = snapshot[event.principal] ?? emptyProjection(event.principal);
    snapshot[event.principal] = applyChange(previous, change, event.seq);
  }
  return snapshot;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

export function presenceContentVersion(snapshot: PresenceSnapshot): string {
  return `sha256:${createHash('sha256').update(canonicalJson(snapshot)).digest('hex')}`;
}

async function presenceEvents(db: DbExecutor, principal?: string): Promise<PresenceEventRow[]> {
  const result = await db.query<{
    seq: string | number;
    principal: string;
    kind: PresenceEventKind;
    detail: PresenceChange;
  }>(
    `SELECT seq, principal, kind, detail FROM events
     WHERE domain='presence' AND principal IS NOT NULL${
       principal === undefined ? '' : ' AND principal=$1'
     }
     ORDER BY seq ASC`,
    principal === undefined ? [] : [principal],
  );
  return result.rows.map((row) => ({
    seq: Number(row.seq),
    principal: row.principal,
    kind: row.kind,
    detail: row.detail,
  }));
}

export async function loadPresenceSnapshot(db: DbExecutor): Promise<PresenceSnapshot> {
  const result = await db.query<{
    principal: string;
    site: string | null;
    scope: string | null;
    thread: string | null;
    focus: PresenceValue;
    updated_seq: string | number;
  }>(
    `SELECT principal, site, scope, thread, focus, updated_seq
     FROM presence_current ORDER BY principal ASC`,
  );
  return Object.fromEntries(
    result.rows.map((row) => [
      row.principal,
      {
        principal: row.principal,
        site: row.site,
        scope: row.scope,
        thread: row.thread,
        focus: row.focus ?? null,
        updatedSeq: Number(row.updated_seq),
      },
    ]),
  );
}

export async function loadPresenceForPrincipal(
  db: DbExecutor,
  principal: string,
): Promise<PresenceProjection | undefined> {
  const result = await db.query<{
    principal: string;
    site: string | null;
    scope: string | null;
    thread: string | null;
    focus: PresenceValue;
    updated_seq: string | number;
  }>(
    `SELECT principal, site, scope, thread, focus, updated_seq
     FROM presence_current WHERE principal=$1`,
    [principal],
  );
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : {
        principal: row.principal,
        site: row.site,
        scope: row.scope,
        thread: row.thread,
        focus: row.focus ?? null,
        updatedSeq: Number(row.updated_seq),
      };
}

async function upsertPresence(db: DbExecutor, projection: PresenceProjection): Promise<void> {
  await db.query(
    `INSERT INTO presence_current (principal, site, scope, thread, focus, updated_seq)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (principal) DO UPDATE SET
       site=EXCLUDED.site, scope=EXCLUDED.scope, thread=EXCLUDED.thread,
       focus=EXCLUDED.focus, updated_seq=EXCLUDED.updated_seq`,
    [
      projection.principal,
      projection.site,
      projection.scope,
      projection.thread,
      projection.focus === null ? null : JSON.stringify(projection.focus),
      projection.updatedSeq,
    ],
  );
}

export async function appendPresenceChange(
  db: ConnectableDb,
  rawChange: unknown,
  identity: AppendPresenceIdentity,
): Promise<{ changed: boolean; seq?: number; presence: PresenceProjection }> {
  const change = parsePresenceChange(rawChange);
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `presence:${identity.principal}`,
    ]);
    const current =
      (await loadPresenceForPrincipal(client, identity.principal)) ??
      emptyProjection(identity.principal);
    if (presenceValuesEqual(valueOf(current, change.kind), change.value)) {
      return { changed: false, presence: current };
    }
    const rate = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM events
       WHERE domain='presence' AND principal=$1
         AND ts > now() - interval '1 minute'`,
      [identity.principal],
    );
    if (Number(rate.rows[0]?.count ?? 0) >= PRESENCE_MAX_EVENTS_PER_WINDOW) {
      throw new PresenceRateLimitError();
    }
    const eventKind = presenceEventKind(change.kind);
    const appended = await appendEvent(client, {
      domain: 'presence',
      kind: eventKind as EventKind,
      actor: identity.actor,
      principal: identity.principal,
      channel: identity.channel,
      rel: `presence:${identity.principal}`,
      detail: change,
    });
    const presence = applyChange(current, change, appended.seq);
    await upsertPresence(client, presence);
    return { changed: true, seq: appended.seq, presence };
  });
}

/** Rebuild the materialized projection from only the presence event domain. */
export async function rebuildPresenceProjection(db: ConnectableDb): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740937)');
    const snapshot = foldPresenceEvents(await presenceEvents(client));
    await client.query('DELETE FROM presence_current');
    for (const projection of Object.values(snapshot)) await upsertPresence(client, projection);
  });
}
