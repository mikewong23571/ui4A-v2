import { createHash } from 'node:crypto';

import {
  applyCapabilityRunCommand,
  canonicalJson,
  foldCapabilityRunEvents,
  type CapabilityRun,
  type CapabilityRunCommand,
  type CapabilityRunEvent,
  type CapabilityRunSnapshot,
} from '@ui4a/engine';
import type { CodingNormalizedEvent, CodingRedactionPolicy } from '@ui4a/shared';
import type { PoolClient } from 'pg';

import { appendEvent, ensureEventsTable, type DbExecutor } from './events';

export const CAPABILITY_RUN_DDL = `
CREATE TABLE IF NOT EXISTS capability_payloads (
  payload_hash          TEXT PRIMARY KEY,
  media_type            TEXT NOT NULL,
  redaction_version     INTEGER NOT NULL DEFAULT 1,
  byte_length           INTEGER NOT NULL,
  payload               JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_run_projection (
  run_id            TEXT PRIMARY KEY,
  principal         TEXT NOT NULL,
  policy_scope      TEXT NOT NULL,
  status            TEXT NOT NULL,
  profile_name      TEXT NOT NULL,
  source_rel        TEXT NOT NULL,
  source_action     TEXT NOT NULL,
  revision          INTEGER NOT NULL,
  cursor            TEXT,
  aggregate         JSONB NOT NULL,
  updated_seq       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS capability_run_owner_status
  ON capability_run_projection (principal, policy_scope, status, updated_seq DESC);
CREATE INDEX IF NOT EXISTS capability_run_source
  ON capability_run_projection (policy_scope, source_rel, source_action, updated_seq DESC);
CREATE UNIQUE INDEX IF NOT EXISTS capability_event_id_unique
  ON events ((detail->>'eventId'))
  WHERE domain='capability' AND detail ? 'eventId';
DROP INDEX IF EXISTS capability_command_id_unique;
CREATE UNIQUE INDEX capability_command_id_unique
  ON events ((detail->>'commandId'))
  WHERE domain='capability' AND kind LIKE 'capability-run-%' AND detail ? 'commandId';
CREATE UNIQUE INDEX IF NOT EXISTS capability_raw_ordinal_unique
  ON events (rel, ((detail->>'ordinal')::integer))
  WHERE domain='capability' AND kind='capability-raw-chunk-recorded';

CREATE OR REPLACE FUNCTION capability_payloads_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'capability_payloads append-only: % is forbidden for %', TG_OP, OLD.payload_hash;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS capability_payloads_append_only_trigger ON capability_payloads;
CREATE TRIGGER capability_payloads_append_only_trigger
  BEFORE UPDATE OR DELETE ON capability_payloads
  FOR EACH ROW EXECUTE FUNCTION capability_payloads_append_only();
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

export async function ensureCapabilityRunTables(db: DbExecutor): Promise<void> {
  await ensureEventsTable(db);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740938)');
    await db.query(CAPABILITY_RUN_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function loadSnapshot(db: DbExecutor): Promise<CapabilityRunSnapshot> {
  const result = await db.query<{ detail: CapabilityRunEvent }>(
    `SELECT detail FROM events
     WHERE domain='capability' AND kind LIKE 'capability-run-%' ORDER BY seq ASC`,
  );
  return foldCapabilityRunEvents(result.rows.map((row) => row.detail));
}

async function upsertProjection(
  db: DbExecutor,
  aggregate: CapabilityRun,
  updatedSeq: number,
): Promise<void> {
  await db.query(
    `INSERT INTO capability_run_projection
       (run_id,principal,policy_scope,status,profile_name,source_rel,source_action,
        revision,cursor,aggregate,updated_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     ON CONFLICT (run_id) DO UPDATE SET
       principal=EXCLUDED.principal, policy_scope=EXCLUDED.policy_scope,
       status=EXCLUDED.status, profile_name=EXCLUDED.profile_name,
       source_rel=EXCLUDED.source_rel, source_action=EXCLUDED.source_action,
       revision=EXCLUDED.revision, cursor=EXCLUDED.cursor,
       aggregate=EXCLUDED.aggregate, updated_seq=EXCLUDED.updated_seq`,
    [
      aggregate.runId,
      aggregate.principal,
      aggregate.policyScope,
      aggregate.status,
      aggregate.profileName,
      aggregate.source.rel,
      aggregate.source.action,
      aggregate.revision,
      aggregate.cursor,
      JSON.stringify(aggregate),
      updatedSeq,
    ],
  );
}

export async function appendCapabilityRunCommand(
  db: ConnectableDb,
  command: CapabilityRunCommand,
): Promise<{ aggregate: CapabilityRun; event?: CapabilityRunEvent; seq?: number }> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740939)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [command.runId]);
    const snapshot = await loadSnapshot(client);
    if (snapshot.commandEventIds[command.commandId] !== undefined) {
      const aggregate = snapshot.runs[command.runId];
      if (aggregate === undefined) throw new Error('deduplicated command has no capability run');
      return { aggregate };
    }
    const applied = applyCapabilityRunCommand(snapshot, command);
    const event = applied.events[0];
    if (event === undefined) {
      const aggregate = applied.snapshot.runs[command.runId];
      if (aggregate === undefined) throw new Error('capability command produced no aggregate');
      return { aggregate };
    }
    const aggregate = applied.snapshot.runs[command.runId]!;
    const appended = await appendEvent(client, {
      domain: 'capability',
      kind: event.kind,
      rel: `capability-run:${command.runId}`,
      actor: 'agent',
      principal: aggregate.principal,
      channel: 'capability',
      detail: event,
    });
    await upsertProjection(client, aggregate, appended.seq);
    return { aggregate, event, seq: appended.seq };
  });
}

function redactPayload(
  value: unknown,
  policy: CodingRedactionPolicy,
  workspacePath?: string,
  secretValues = policy.secretNames
    .map((name) => process.env[name])
    .filter((secret): secret is string => secret !== undefined && secret.length >= 4),
): unknown {
  if (Array.isArray(value))
    return value.map((item) => redactPayload(item, policy, workspacePath, secretValues));
  if (typeof value === 'string') {
    let redacted =
      workspacePath !== undefined && policy.redactHostPaths
        ? value.replaceAll(workspacePath, 'workspace://')
        : value;
    for (const secret of secretValues) redacted = redacted.replaceAll(secret, '[REDACTED]');
    return redacted;
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      policy.secretNames.some((name) => name.toLowerCase() === key.toLowerCase())
        ? '[REDACTED]'
        : redactPayload(child, policy, workspacePath, secretValues),
    ]),
  );
}

export async function storeCapabilityPayload(
  db: DbExecutor,
  payload: unknown,
  mediaType: string,
): Promise<{ hash: string; bytes: number }> {
  const serialized = canonicalJson(payload);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  const hash = `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
  await db.query(
    `INSERT INTO capability_payloads
       (payload_hash,media_type,redaction_version,byte_length,payload)
     VALUES ($1,$2,1,$3,$4::jsonb) ON CONFLICT (payload_hash) DO NOTHING`,
    [hash, mediaType, bytes, serialized],
  );
  return { hash, bytes };
}

export async function appendCapabilityRawEvent(
  db: ConnectableDb,
  input: {
    runId: string;
    principal: string;
    policyScope: string;
    ordinal: number;
    cursor?: string;
    payload: unknown;
    workspacePath?: string;
    redaction: CodingRedactionPolicy;
  },
): Promise<{ payloadHash: string; seq: number }> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740939)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.runId]);
    const found = await client.query<{ aggregate: CapabilityRun }>(
      `SELECT aggregate FROM capability_run_projection
       WHERE run_id=$1 AND principal=$2 AND policy_scope=$3`,
      [input.runId, input.principal, input.policyScope],
    );
    const aggregate = found.rows[0]?.aggregate;
    if (aggregate === undefined)
      throw new Error('capability run is not authorized or does not exist');
    const stats = await client.query<{
      count: string | number;
      bytes: string | number | null;
      ordinal: string | number | null;
    }>(
      `SELECT count(*) AS count, coalesce(sum((detail->>'byteLength')::bigint),0) AS bytes,
              max((detail->>'ordinal')::integer) AS ordinal
       FROM events WHERE domain='capability' AND kind='capability-raw-chunk-recorded' AND rel=$1`,
      [`capability-run:${input.runId}`],
    );
    const current = stats.rows[0];
    if (input.ordinal !== Number(current?.ordinal ?? 0) + 1)
      throw new Error('raw event ordinal is not consecutive');
    if (Number(current?.count ?? 0) >= aggregate.task.budget.maxRawEvents)
      throw new Error('raw event count budget exhausted');
    const redacted = redactPayload(input.payload, input.redaction, input.workspacePath);
    const serialized = canonicalJson(redacted);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > aggregate.task.budget.maxRawChunkBytes)
      throw new Error('raw event chunk budget exceeded');
    if (Number(current?.bytes ?? 0) + bytes > aggregate.task.budget.maxRawBytes)
      throw new Error('raw event byte budget exhausted');
    const stored = await storeCapabilityPayload(client, redacted, 'application/json');
    const appended = await appendEvent(client, {
      domain: 'capability',
      kind: 'capability-raw-chunk-recorded',
      rel: `capability-run:${input.runId}`,
      actor: 'agent',
      principal: input.principal,
      channel: 'capability',
      detail: {
        runId: input.runId,
        ordinal: input.ordinal,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        payloadHash: stored.hash,
        byteLength: stored.bytes,
        redacted: true,
        truncated: false,
      },
    });
    return { payloadHash: stored.hash, seq: appended.seq };
  });
}

export async function appendCapabilityNormalizedEvent(
  db: ConnectableDb,
  input: { event: CodingNormalizedEvent; principal: string; policyScope: string },
): Promise<{ seq: number }> {
  const serialized = canonicalJson(input.event);
  if (new TextEncoder().encode(serialized).byteLength > 16 * 1024) {
    throw new Error('normalized event exceeds 16 KiB');
  }
  const exact = await getCapabilityRun(db, input.event.runId, input.principal, input.policyScope);
  if (exact === undefined) throw new Error('capability run is not authorized or does not exist');
  const appended = await appendEvent(db, {
    domain: 'capability',
    kind: 'capability-normalized-event-recorded',
    rel: `capability-run:${input.event.runId}`,
    actor: 'agent',
    principal: input.principal,
    channel: 'capability',
    detail: input.event,
  });
  return { seq: appended.seq };
}

export async function getCapabilityRun(
  db: DbExecutor,
  runId: string,
  principal: string,
  policyScope: string,
): Promise<CapabilityRun | undefined> {
  const result = await db.query<{ aggregate: CapabilityRun }>(
    `SELECT aggregate FROM capability_run_projection
     WHERE run_id=$1 AND principal=$2 AND policy_scope=$3`,
    [runId, principal, policyScope],
  );
  return result.rows[0]?.aggregate;
}

/** Internal callback lookup; external routes must use owner/scope filtered getCapabilityRun. */
export async function getCapabilityRunInternal(
  db: DbExecutor,
  runId: string,
): Promise<CapabilityRun | undefined> {
  const result = await db.query<{ aggregate: CapabilityRun }>(
    'SELECT aggregate FROM capability_run_projection WHERE run_id=$1',
    [runId],
  );
  return result.rows[0]?.aggregate;
}

export async function findCapabilityRunsBySource(
  db: DbExecutor,
  sourceRel: string,
  principal: string,
  policyScope: string,
): Promise<CapabilityRun[]> {
  const result = await db.query<{ aggregate: CapabilityRun }>(
    `SELECT aggregate FROM capability_run_projection
     WHERE source_rel=$1 AND principal=$2 AND policy_scope=$3 ORDER BY updated_seq DESC`,
    [sourceRel, principal, policyScope],
  );
  return result.rows.map((row) => row.aggregate);
}

export async function listCapabilityRuns(
  db: DbExecutor,
  input: { principal: string; policyScope: string; limit?: number },
): Promise<CapabilityRun[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const result = await db.query<{ aggregate: CapabilityRun }>(
    `SELECT aggregate FROM capability_run_projection
     WHERE principal=$1 AND policy_scope=$2 ORDER BY updated_seq DESC LIMIT $3`,
    [input.principal, input.policyScope, limit],
  );
  return result.rows.map((row) => row.aggregate);
}

export async function rebuildCapabilityRunProjection(db: ConnectableDb): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740939)');
    const snapshot = await loadSnapshot(client);
    await client.query('DELETE FROM capability_run_projection');
    const seq = await client.query<{ seq: string | number | null }>(
      `SELECT max(seq) AS seq FROM events WHERE domain='capability'`,
    );
    for (const aggregate of Object.values(snapshot.runs)) {
      await upsertProjection(client, aggregate, Number(seq.rows[0]?.seq ?? 0));
    }
  });
}

export async function readCapabilityPayload(
  db: DbExecutor,
  hash: string,
): Promise<unknown | undefined> {
  const result = await db.query<{ payload: unknown }>(
    'SELECT payload FROM capability_payloads WHERE payload_hash=$1',
    [hash],
  );
  return result.rows[0]?.payload;
}

export async function capabilityRawStats(
  db: DbExecutor,
  runId: string,
): Promise<{ count: number; bytes: number; maxOrdinal: number }> {
  const result = await db.query<{
    count: string | number;
    bytes: string | number | null;
    ordinal: string | number | null;
  }>(
    `SELECT count(*) AS count, coalesce(sum((detail->>'byteLength')::bigint),0) AS bytes,
            max((detail->>'ordinal')::integer) AS ordinal
     FROM events WHERE domain='capability' AND kind='capability-raw-chunk-recorded' AND rel=$1`,
    [`capability-run:${runId}`],
  );
  return {
    count: Number(result.rows[0]?.count ?? 0),
    bytes: Number(result.rows[0]?.bytes ?? 0),
    maxOrdinal: Number(result.rows[0]?.ordinal ?? 0),
  };
}

export async function listCapabilityNormalizedEvents(
  db: DbExecutor,
  runId: string,
): Promise<CodingNormalizedEvent[]> {
  const result = await db.query<{ detail: CodingNormalizedEvent }>(
    `SELECT detail FROM events
     WHERE domain='capability' AND kind='capability-normalized-event-recorded' AND rel=$1
     ORDER BY seq ASC`,
    [`capability-run:${runId}`],
  );
  return result.rows.map((row) => row.detail);
}

export async function listCapabilityRawReceipts(
  db: DbExecutor,
  runId: string,
): Promise<Record<string, unknown>[]> {
  const result = await db.query<{ detail: Record<string, unknown> }>(
    `SELECT detail FROM events
     WHERE domain='capability' AND kind='capability-raw-chunk-recorded' AND rel=$1
     ORDER BY seq ASC`,
    [`capability-run:${runId}`],
  );
  return result.rows.map((row) => row.detail);
}

export type { ConnectableDb };
