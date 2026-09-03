import { createHash } from 'node:crypto';

import {
  applyDraftCommand,
  canonicalJson,
  foldDraftEvents,
  inspectJsonBudget,
  type DraftCommand,
  type DraftEvent,
  type DraftSnapshot,
} from '@ui4a/engine';
import type { DraftAggregate } from '@ui4a/shared';
import { DRAFT_LIMITS } from '@ui4a/shared';
import type { PoolClient } from 'pg';

import { appendEvent, ensureEventsTable, type DbExecutor, type EventAppend } from './events';

export const DRAFT_DDL = `
CREATE TABLE IF NOT EXISTS draft_payloads (
  payload_hash              TEXT PRIMARY KEY,
  media_type                TEXT NOT NULL DEFAULT 'application/json',
  canonicalization_version  INTEGER NOT NULL DEFAULT 1,
  byte_length               INTEGER NOT NULL,
  payload                   JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_projection (
  draft_id        TEXT PRIMARY KEY,
  owner           TEXT NOT NULL,
  policy_scope    TEXT NOT NULL,
  kind            TEXT NOT NULL,
  target          TEXT,
  status          TEXT NOT NULL,
  active_version  INTEGER NOT NULL,
  max_version     INTEGER NOT NULL,
  payload_hash    TEXT NOT NULL REFERENCES draft_payloads(payload_hash),
  base_version    TEXT,
  aggregate       JSONB NOT NULL,
  updated_seq     BIGINT NOT NULL,
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS draft_projection_owner_status
  ON draft_projection (owner, policy_scope, status, updated_seq DESC);
CREATE INDEX IF NOT EXISTS draft_projection_target_status
  ON draft_projection (policy_scope, target, status, updated_seq DESC);
CREATE INDEX IF NOT EXISTS draft_projection_kind_status
  ON draft_projection (owner, policy_scope, kind, status, updated_seq DESC);
CREATE UNIQUE INDEX IF NOT EXISTS draft_event_id_unique
  ON events ((detail->>'eventId'))
  WHERE domain = 'draft' AND detail ? 'eventId';
CREATE UNIQUE INDEX IF NOT EXISTS draft_command_id_unique
  ON events ((detail->>'commandId'))
  WHERE domain = 'draft' AND detail ? 'commandId';

CREATE OR REPLACE FUNCTION draft_payloads_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'draft_payloads append-only: % is forbidden for %', TG_OP, OLD.payload_hash;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS draft_payloads_append_only_trigger ON draft_payloads;
CREATE TRIGGER draft_payloads_append_only_trigger
  BEFORE UPDATE OR DELETE ON draft_payloads
  FOR EACH ROW EXECUTE FUNCTION draft_payloads_append_only();
`;

interface ConnectableDb extends DbExecutor {
  connect?: () => Promise<PoolClient>;
}

async function withTransaction<T>(
  db: ConnectableDb,
  run: (client: DbExecutor) => Promise<T>,
): Promise<T> {
  const acquired = db.connect === undefined ? db : await db.connect();
  const client = acquired as DbExecutor;
  await client.query('BEGIN');
  try {
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if ('release' in acquired && typeof acquired.release === 'function') acquired.release();
  }
}

export async function ensureDraftTables(db: DbExecutor): Promise<void> {
  await ensureEventsTable(db);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740936)');
    await db.query(DRAFT_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export function payloadSha256(payload: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

async function loadDraftSnapshot(db: DbExecutor): Promise<DraftSnapshot> {
  const result = await db.query<{ detail: DraftEvent }>(
    `SELECT detail FROM events WHERE domain='draft' AND kind LIKE 'draft-%' ORDER BY seq ASC`,
  );
  return foldDraftEvents(result.rows.map((row) => row.detail));
}

async function storePayload(db: DbExecutor, payload: unknown, expectedHash: string): Promise<void> {
  const budget = inspectJsonBudget({ value: payload });
  if (!budget.valid) throw new Error(`draft payload rejected: ${budget.issues.join('; ')}`);
  const hash = payloadSha256(payload);
  if (hash !== expectedHash) throw new Error('draft payload hash mismatch');
  await db.query(
    `INSERT INTO draft_payloads
       (payload_hash,media_type,canonicalization_version,byte_length,payload)
     VALUES ($1,'application/json',1,$2,$3::jsonb)
     ON CONFLICT (payload_hash) DO NOTHING`,
    [hash, budget.bytes, JSON.stringify(payload)],
  );
  const stored = await db.query<{ payload: unknown }>(
    'SELECT payload FROM draft_payloads WHERE payload_hash=$1',
    [hash],
  );
  if (
    stored.rows[0] === undefined ||
    canonicalJson(stored.rows[0].payload) !== canonicalJson(payload)
  ) {
    throw new Error('draft payload integrity failure');
  }
}

async function upsertProjection(
  db: DbExecutor,
  aggregate: DraftAggregate,
  updatedSeq: number,
): Promise<void> {
  const payloadHash = aggregate.versions[aggregate.activeVersion]!.payloadHash;
  await db.query(
    `INSERT INTO draft_projection
       (draft_id,owner,policy_scope,kind,target,status,active_version,max_version,payload_hash,
        base_version,aggregate,updated_seq,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
     ON CONFLICT (draft_id) DO UPDATE SET
       owner=EXCLUDED.owner, policy_scope=EXCLUDED.policy_scope, kind=EXCLUDED.kind,
       target=EXCLUDED.target, status=EXCLUDED.status, active_version=EXCLUDED.active_version,
       max_version=EXCLUDED.max_version, payload_hash=EXCLUDED.payload_hash,
       base_version=EXCLUDED.base_version, aggregate=EXCLUDED.aggregate,
       updated_seq=EXCLUDED.updated_seq, expires_at=EXCLUDED.expires_at`,
    [
      aggregate.id,
      aggregate.owner,
      aggregate.policyScope,
      aggregate.kind,
      aggregate.target ?? null,
      aggregate.status,
      aggregate.activeVersion,
      aggregate.maxVersion,
      payloadHash,
      aggregate.baseVersion ?? null,
      JSON.stringify(aggregate),
      updatedSeq,
      aggregate.expiresAt ?? null,
    ],
  );
}

async function enforceCreateBudgets(
  db: DbExecutor,
  command: Extract<DraftCommand, { kind: 'create' }>,
  payloadBytes: number,
): Promise<void> {
  const active = await db.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM draft_projection
     WHERE owner=$1 AND policy_scope=$2 AND status NOT IN ('accepted','rejected','abandoned','expired')`,
    [command.owner, command.policyScope],
  );
  if (Number(active.rows[0]?.count ?? 0) >= DRAFT_LIMITS.maxActivePerScope) {
    throw new Error('active draft count limit');
  }
  const bytes = await db.query<{ total: string | number | null }>(
    `SELECT sum(p.byte_length) AS total FROM draft_projection d
       JOIN draft_payloads p ON p.payload_hash=d.payload_hash
     WHERE d.owner=$1 AND d.policy_scope=$2
       AND d.status NOT IN ('accepted','rejected','abandoned','expired')`,
    [command.owner, command.policyScope],
  );
  if (Number(bytes.rows[0]?.total ?? 0) + payloadBytes > DRAFT_LIMITS.maxScopeBytes) {
    throw new Error('draft scope byte limit');
  }
}

export async function appendDraftCommand(
  db: ConnectableDb,
  command: DraftCommand,
  payload?: unknown,
): Promise<{ aggregate: DraftAggregate; event?: DraftEvent; seq?: number }> {
  return withTransaction(db, async (client) => {
    // Serializes domain cursors and command-id checks; the draft lock provides per-aggregate CAS.
    await client.query('SELECT pg_advisory_xact_lock(740937)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [command.draftId]);
    const snapshot = await loadDraftSnapshot(client);
    const deduplicated = snapshot.commandEventIds[command.commandId];
    if (deduplicated !== undefined) {
      const aggregate = snapshot.drafts[command.draftId];
      if (aggregate === undefined) throw new Error('deduplicated command has no draft');
      return { aggregate };
    }
    if (command.kind === 'create' || command.kind === 'revise') {
      if (payload === undefined) throw new Error('draft payload is required');
      const budget = inspectJsonBudget({ value: payload });
      if (!budget.valid) throw new Error(`draft payload rejected: ${budget.issues.join('; ')}`);
      if (command.kind === 'create') await enforceCreateBudgets(client, command, budget.bytes);
      await storePayload(client, payload, command.payloadHash);
    }
    const result = applyDraftCommand(snapshot, command);
    if (result.events.length === 0) {
      const aggregate = result.snapshot.drafts[command.draftId];
      if (aggregate === undefined) throw new Error('draft command produced no aggregate');
      return { aggregate };
    }
    const event = result.events[0]!;
    const appended = await appendEvent(client, {
      domain: 'draft',
      kind: event.kind,
      rel: `draft:${command.draftId}`,
      actor: event.kind === 'draft-created' ? event.version.provenance.actor : undefined,
      principal: result.snapshot.drafts[command.draftId]!.owner,
      channel: 'meta',
      detail: event,
    });
    const aggregate = result.snapshot.drafts[command.draftId]!;
    await upsertProjection(client, aggregate, appended.seq);
    return { aggregate, event, seq: appended.seq };
  });
}

/**
 * Multi-event core mutation applied atomically before the Draft acceptance event.
 * The events array is the unified contract: one planned append batch in array
 * order, plus an optional projection hook that runs inside the same transaction
 * with the actually allocated sequence numbers.
 */
export interface AtomicCoreMutationPlan {
  events: EventAppend[];
  applyProjection?: (input: { client: DbExecutor; seqs: number[] }) => Promise<void>;
}

/**
 * Append one validated core change set and `draft-accepted` in the same transaction. The callback
 * runs after Draft locks and receives exact payload; it must re-read and validate current core
 * truth and return one atomic plan: every core event of the acceptance (array order is the
 * append order) and an optional same-transaction projection hook. Any failure anywhere in the
 * batch rolls the whole acceptance back.
 */
export async function acceptDraftWithCoreEvent(
  db: ConnectableDb,
  command: Extract<DraftCommand, { kind: 'accept' }>,
  planCoreMutation: (input: {
    client: DbExecutor;
    aggregate: DraftAggregate;
    payload: unknown;
  }) => Promise<AtomicCoreMutationPlan>,
): Promise<{
  aggregate: DraftAggregate;
  coreSeq?: number;
  coreSeqs?: number[];
  draftSeq?: number;
}> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740937)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [command.draftId]);
    const snapshot = await loadDraftSnapshot(client);
    if (snapshot.commandEventIds[command.commandId] !== undefined) {
      const aggregate = snapshot.drafts[command.draftId];
      if (aggregate === undefined) throw new Error('deduplicated acceptance has no draft');
      return { aggregate };
    }
    const aggregate = snapshot.drafts[command.draftId];
    if (aggregate === undefined) throw new Error('draft does not exist');
    if (aggregate.status !== 'pending-approval') throw new Error('draft is not pending');
    const payloadHash = aggregate.versions[aggregate.activeVersion]?.payloadHash;
    if (payloadHash === undefined) throw new Error('draft active payload is missing');
    const payloadResult = await client.query<{ payload: unknown }>(
      'SELECT payload FROM draft_payloads WHERE payload_hash=$1',
      [payloadHash],
    );
    const payload = payloadResult.rows[0]?.payload;
    if (payload === undefined || payloadSha256(payload) !== payloadHash) {
      throw new Error('draft payload integrity failure');
    }
    const plan = await planCoreMutation({ client, aggregate, payload });
    const result = applyDraftCommand(snapshot, command);
    const event = result.events[0]!;
    if (plan.events.length === 0) throw new Error('draft acceptance requires a core event');
    const coreSeqs: number[] = [];
    for (const coreEvent of plan.events) {
      coreSeqs.push((await appendEvent(client, coreEvent)).seq);
    }
    if (plan.applyProjection !== undefined) {
      await plan.applyProjection({ client, seqs: coreSeqs });
    }
    const draft = await appendEvent(client, {
      domain: 'draft',
      kind: event.kind,
      rel: `draft:${command.draftId}`,
      actor: 'human',
      principal: aggregate.owner,
      channel: 'meta',
      detail: event,
    });
    const accepted = result.snapshot.drafts[command.draftId]!;
    await upsertProjection(client, accepted, draft.seq);
    return {
      aggregate: accepted,
      coreSeq: coreSeqs[0],
      coreSeqs,
      draftSeq: draft.seq,
    };
  });
}

export async function getDraft(
  db: DbExecutor,
  draftId: string,
  owner: string,
  policyScope: string,
): Promise<{ aggregate: DraftAggregate; payload: unknown } | undefined> {
  const result = await db.query<{ aggregate: DraftAggregate; payload: unknown }>(
    `SELECT d.aggregate, p.payload FROM draft_projection d
       JOIN draft_payloads p ON p.payload_hash=d.payload_hash
     WHERE d.draft_id=$1 AND d.owner=$2 AND d.policy_scope=$3`,
    [draftId, owner, policyScope],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const expected = row.aggregate.versions[row.aggregate.activeVersion]?.payloadHash;
  if (expected === undefined || payloadSha256(row.payload) !== expected) {
    throw new Error('draft payload integrity failure');
  }
  return row;
}

/** Exact owner lookup used by an authenticated action; scope remains server-derived from the row. */
export async function getDraftByOwner(
  db: DbExecutor,
  draftId: string,
  owner: string,
): Promise<{ aggregate: DraftAggregate; payload: unknown } | undefined> {
  const result = await db.query<{ aggregate: DraftAggregate; payload: unknown }>(
    `SELECT d.aggregate, p.payload FROM draft_projection d
       JOIN draft_payloads p ON p.payload_hash=d.payload_hash
     WHERE d.draft_id=$1 AND d.owner=$2`,
    [draftId, owner],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const expected = row.aggregate.versions[row.aggregate.activeVersion]?.payloadHash;
  if (expected === undefined || payloadSha256(row.payload) !== expected) {
    throw new Error('draft payload integrity failure');
  }
  return row;
}

/** D51:policyScope 可缺省(缺省 = 按属主返回全部目标应用)。 */
export async function listDrafts(
  db: DbExecutor,
  options: { owner: string; policyScope?: string; status?: string; limit?: number },
): Promise<DraftAggregate[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const values: unknown[] = [options.owner, options.policyScope ?? null];
  const status = options.status === undefined ? '' : ` AND status=$${values.push(options.status)}`;
  values.push(limit);
  const result = await db.query<{ aggregate: DraftAggregate }>(
    `SELECT aggregate FROM draft_projection
     WHERE owner=$1 AND ($2::text IS NULL OR policy_scope=$2)${status}
     ORDER BY updated_seq DESC LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => row.aggregate);
}

/** Bounded reverse lookup used by the human Run → governed Draft relationship view. */
export async function findDraftsBySource(
  db: ConnectableDb,
  input: { owner: string; policyScope?: string; source: string },
): Promise<DraftAggregate[]> {
  const drafts = await listDrafts(db, {
    owner: input.owner,
    ...(input.policyScope === undefined ? {} : { policyScope: input.policyScope }),
    limit: 100,
  });
  return drafts.filter((draft) =>
    Object.values(draft.versions).some((version) =>
      version.provenance.sources.includes(input.source),
    ),
  );
}

export async function rebuildDraftProjection(db: ConnectableDb): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740937)');
    const snapshot = await loadDraftSnapshot(client);
    await client.query('DELETE FROM draft_projection');
    const seq = await client.query<{ seq: string | number | null }>(
      `SELECT max(seq) AS seq FROM events WHERE domain='draft'`,
    );
    for (const aggregate of Object.values(snapshot.drafts)) {
      await upsertProjection(client, aggregate, Number(seq.rows[0]?.seq ?? 0));
    }
  });
}

export type { ConnectableDb };
