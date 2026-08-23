import { createHash } from 'node:crypto';

import {
  applyAgentRunCommand,
  canonicalJson,
  createAgentRunSnapshot,
  decodeLegacyCapabilityRunEvents,
  foldAgentRunEvents,
  type AgentResultEnvelope,
  type AgentRun,
  type AgentRunCommand,
  type AgentRunEvent,
  type AgentRunSnapshot,
  type CapabilityRunEvent,
} from '@ui4a/engine';
import type { PoolClient } from 'pg';

import { appendEvent, ensureEventsTable, type DbExecutor } from './events';

const AGENT_RUN_KINDS = [
  'agent-run-created',
  'agent-run-preparing',
  'agent-run-started',
  'agent-run-cursor-advanced',
  'agent-run-restarted',
  'agent-run-question-asked',
  'agent-run-question-answered',
  'agent-run-resource-grant-requested',
  'agent-run-resource-grant-decided',
  'agent-run-succeeded',
  'agent-run-failed',
  'agent-run-cancelled',
  'agent-run-staled',
] as const;

const LEGACY_RUN_KINDS = [
  'capability-run-created',
  'capability-run-preparing',
  'capability-run-started',
  'capability-run-cursor-advanced',
  'capability-run-restarted',
  'capability-run-approval-requested',
  'capability-run-resumed',
  'capability-run-succeeded',
  'capability-run-failed',
  'capability-run-cancelled',
  'capability-run-staled',
] as const;

export const AGENT_RUN_DDL = `
CREATE TABLE IF NOT EXISTS agent_run_payloads (
  payload_hash      TEXT PRIMARY KEY,
  media_type        TEXT NOT NULL,
  byte_length       INTEGER NOT NULL,
  payload           JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run_projection (
  run_id              TEXT PRIMARY KEY,
  origin               TEXT NOT NULL,
  principal            TEXT NOT NULL,
  policy_scope         TEXT NOT NULL,
  status               TEXT NOT NULL,
  definition_ref       TEXT NOT NULL,
  definition_version   INTEGER NOT NULL,
  runtime_profile      TEXT NOT NULL,
  source_rel           TEXT NOT NULL,
  source_action        TEXT NOT NULL,
  source_event_id      TEXT NOT NULL UNIQUE,
  revision             INTEGER NOT NULL,
  cursor               TEXT,
  aggregate            JSONB NOT NULL,
  updated_seq          BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run_projection_state (
  singleton       BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_seq        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_run_owner_status
  ON agent_run_projection (principal, policy_scope, status, updated_seq DESC);
CREATE INDEX IF NOT EXISTS agent_run_source
  ON agent_run_projection (policy_scope, source_rel, source_action, updated_seq DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_run_source_creation_unique
  ON events ((detail->'source'->>'eventId'))
  WHERE domain='capability'
    AND kind IN ('capability-run-created', 'agent-run-created')
    AND detail->'source'->>'eventId' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agent_run_native_command_unique
  ON events ((detail->>'commandId'))
  WHERE domain='capability' AND kind LIKE 'agent-run-%' AND detail ? 'commandId';
CREATE UNIQUE INDEX IF NOT EXISTS agent_run_raw_ordinal_unique
  ON events (rel, ((detail->>'ordinal')::integer))
  WHERE domain='capability' AND kind='agent-run-raw-chunk-recorded';

CREATE OR REPLACE FUNCTION agent_run_payloads_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_run_payloads append-only: % is forbidden for %', TG_OP, OLD.payload_hash;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_run_payloads_append_only_trigger ON agent_run_payloads;
CREATE TRIGGER agent_run_payloads_append_only_trigger
  BEFORE UPDATE OR DELETE ON agent_run_payloads
  FOR EACH ROW EXECUTE FUNCTION agent_run_payloads_append_only();
`;

export interface ConnectableDb extends DbExecutor {
  connect?: () => Promise<PoolClient>;
}

type PersistedResultEvent = Omit<
  Extract<AgentRunEvent, { kind: 'agent-run-succeeded' }>,
  'result'
> & {
  resultRef: string;
};

interface LoadedSnapshot {
  snapshot: AgentRunSnapshot;
  updatedSeqByRun: Map<string, number>;
  latestSeq: number;
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

export async function ensureAgentRunTables(db: DbExecutor): Promise<void> {
  await ensureEventsTable(db);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740942)');
    await db.query(AGENT_RUN_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function sha256(value: unknown): { hash: string; serialized: string; bytes: number } {
  const serialized = canonicalJson(value);
  return {
    hash: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    serialized,
    bytes: new TextEncoder().encode(serialized).byteLength,
  };
}

export function agentRunProjectionSha256(runs: readonly AgentRun[]): string {
  return sha256(
    [...runs]
      .sort((left, right) => left.runId.localeCompare(right.runId))
      .map((run) => ({ runId: run.runId, aggregate: run })),
  ).hash;
}

export async function storeAgentRunPayload(
  db: DbExecutor,
  payload: unknown,
  mediaType: string,
): Promise<{ hash: string; bytes: number }> {
  const stored = sha256(payload);
  await db.query(
    `INSERT INTO agent_run_payloads (payload_hash,media_type,byte_length,payload)
     VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (payload_hash) DO NOTHING`,
    [stored.hash, mediaType, stored.bytes, stored.serialized],
  );
  return { hash: stored.hash, bytes: stored.bytes };
}

export async function readAgentRunPayload(
  db: DbExecutor,
  hash: string,
): Promise<unknown | undefined> {
  const result = await db.query<{ payload: unknown }>(
    'SELECT payload FROM agent_run_payloads WHERE payload_hash=$1',
    [hash],
  );
  return result.rows[0]?.payload;
}

function isLegacyKind(kind: string): boolean {
  return (LEGACY_RUN_KINDS as readonly string[]).includes(kind);
}

function isNativeKind(kind: string): boolean {
  return (AGENT_RUN_KINDS as readonly string[]).includes(kind);
}

async function hydrateNativeEvent(
  db: DbExecutor,
  detail: AgentRunEvent | PersistedResultEvent,
): Promise<AgentRunEvent> {
  if (detail.kind !== 'agent-run-succeeded' || !('resultRef' in detail)) {
    return detail as AgentRunEvent;
  }
  const result = await readAgentRunPayload(db, detail.resultRef);
  if (result === undefined)
    throw new Error(`agent run result payload ${detail.resultRef} is missing`);
  if (sha256(result).hash !== detail.resultRef) {
    throw new Error(`agent run result payload ${detail.resultRef} failed integrity check`);
  }
  const base = Object.fromEntries(
    Object.entries(detail).filter(([key]) => key !== 'resultRef'),
  ) as Omit<PersistedResultEvent, 'resultRef'>;
  return { ...base, result: result as AgentResultEnvelope };
}

async function loadMixedSnapshot(db: DbExecutor): Promise<LoadedSnapshot> {
  const rows = await db.query<{ seq: string | number; kind: string; detail: unknown }>(
    `SELECT seq,kind,detail FROM events
     WHERE domain='capability' AND (kind = ANY($1::text[]) OR kind = ANY($2::text[]))
     ORDER BY seq ASC`,
    [LEGACY_RUN_KINDS, AGENT_RUN_KINDS],
  );
  let snapshot = createAgentRunSnapshot();
  const updatedSeqByRun = new Map<string, number>();
  let latestSeq = 0;
  for (const row of rows.rows) {
    let events: AgentRunEvent[];
    if (isLegacyKind(row.kind)) {
      events = decodeLegacyCapabilityRunEvents([row.detail as CapabilityRunEvent]);
    } else if (isNativeKind(row.kind)) {
      events = [await hydrateNativeEvent(db, row.detail as AgentRunEvent | PersistedResultEvent)];
    } else {
      continue;
    }
    snapshot = foldAgentRunEvents(events, snapshot);
    const runId = events[0]?.runId;
    const seq = Number(row.seq);
    if (runId !== undefined) updatedSeqByRun.set(runId, seq);
    latestSeq = seq;
  }
  return { snapshot, updatedSeqByRun, latestSeq };
}

async function upsertProjection(db: DbExecutor, run: AgentRun, updatedSeq: number): Promise<void> {
  await db.query(
    `INSERT INTO agent_run_projection
       (run_id,origin,principal,policy_scope,status,definition_ref,definition_version,
        runtime_profile,source_rel,source_action,source_event_id,revision,cursor,aggregate,updated_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
     ON CONFLICT (run_id) DO UPDATE SET
       origin=EXCLUDED.origin, principal=EXCLUDED.principal,
       policy_scope=EXCLUDED.policy_scope, status=EXCLUDED.status,
       definition_ref=EXCLUDED.definition_ref, definition_version=EXCLUDED.definition_version,
       runtime_profile=EXCLUDED.runtime_profile, source_rel=EXCLUDED.source_rel,
       source_action=EXCLUDED.source_action, source_event_id=EXCLUDED.source_event_id,
       revision=EXCLUDED.revision, cursor=EXCLUDED.cursor,
       aggregate=EXCLUDED.aggregate, updated_seq=EXCLUDED.updated_seq`,
    [
      run.runId,
      run.birth.kind === 'legacy-t18-reconstructed' ? 'legacy-t18' : 'native',
      run.principal,
      run.policyScope,
      run.status,
      run.birth.definition.ref,
      run.birth.definition.version,
      run.birth.runtime.profileName,
      run.source.rel,
      run.source.action,
      run.source.eventId,
      run.revision,
      run.cursor,
      JSON.stringify(run),
      updatedSeq,
    ],
  );
}

async function replaceProjection(db: DbExecutor, loaded: LoadedSnapshot): Promise<void> {
  await db.query('TRUNCATE agent_run_projection');
  for (const run of Object.values(loaded.snapshot.runs)) {
    await upsertProjection(db, run, loaded.updatedSeqByRun.get(run.runId) ?? loaded.latestSeq);
  }
  await db.query(
    `INSERT INTO agent_run_projection_state (singleton,last_seq) VALUES (TRUE,$1)
     ON CONFLICT (singleton) DO UPDATE SET last_seq=EXCLUDED.last_seq`,
    [loaded.latestSeq],
  );
}

/** Catch up the canonical projection after a legacy writer appended immutable T18 events. */
export async function synchronizeAgentRunProjection(db: ConnectableDb): Promise<void> {
  await ensureAgentRunTables(db);
  await withTransaction(db, async (client) => {
    // Share the legacy Capability writer lock while rebuilding the mixed projection.
    await client.query('SELECT pg_advisory_xact_lock(740939)');
    await client.query('SELECT pg_advisory_xact_lock(740943)');
    // Capability and native writers deliberately keep separate compatibility locks. Sequence
    // allocation can therefore commit out of order, so a max(seq) checkpoint is not a safe
    // proof that every lower event was observed. Reconcile from the one append-only truth on
    // reads until both writers share the generic command port in the next migration step.
    await replaceProjection(client, await loadMixedSnapshot(client));
  });
}

export async function rebuildAgentRunProjection(db: ConnectableDb): Promise<void> {
  await ensureAgentRunTables(db);
  await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740939)');
    await client.query('SELECT pg_advisory_xact_lock(740943)');
    await replaceProjection(client, await loadMixedSnapshot(client));
  });
}

function persistedDetail(event: AgentRunEvent, resultRef?: string): unknown {
  if (event.kind !== 'agent-run-succeeded') return event;
  if (resultRef === undefined) throw new Error('succeeded agent run requires result payload ref');
  const detail = Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== 'result'),
  ) as Omit<PersistedResultEvent, 'resultRef'>;
  return { ...detail, resultRef } satisfies PersistedResultEvent;
}

export async function appendAgentRunCommand(
  db: ConnectableDb,
  command: AgentRunCommand,
  actor: 'human' | 'agent' = 'agent',
): Promise<{ aggregate: AgentRun; event?: AgentRunEvent; seq?: number; resultRef?: string }> {
  await ensureAgentRunTables(db);
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740943)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [command.runId]);
    const loaded = await loadMixedSnapshot(client);
    const knownEvent = loaded.snapshot.commandEventIds[command.commandId];
    if (knownEvent !== undefined) {
      if (knownEvent !== command.eventId)
        throw new Error(`commandId ${command.commandId} collision`);
      const aggregate = loaded.snapshot.runs[command.runId];
      if (aggregate === undefined) throw new Error('deduplicated command has no agent run');
      await replaceProjection(client, loaded);
      return { aggregate };
    }
    if (command.kind === 'create') {
      const prior = Object.values(loaded.snapshot.runs).find(
        (run) => run.source.eventId === command.source.eventId,
      );
      if (prior !== undefined) {
        throw new Error(
          `source event ${command.source.eventId} already created run ${prior.runId}`,
        );
      }
    }
    const applied = applyAgentRunCommand(loaded.snapshot, command);
    const event = applied.events[0];
    if (event === undefined) {
      const aggregate = applied.snapshot.runs[command.runId];
      if (aggregate === undefined) throw new Error('agent run command produced no aggregate');
      return { aggregate };
    }
    let resultRef: string | undefined;
    if (event.kind === 'agent-run-succeeded') {
      resultRef = (
        await storeAgentRunPayload(client, event.result, 'application/vnd.ui4a.agent-result+json')
      ).hash;
    }
    const aggregate = applied.snapshot.runs[command.runId]!;
    const appended = await appendEvent(client, {
      domain: 'capability',
      kind: event.kind,
      rel: `agent-run:${command.runId}`,
      actor,
      principal: aggregate.principal,
      channel: 'agent-run',
      detail: persistedDetail(event, resultRef),
    });
    const before = { ...loaded, snapshot: applied.snapshot, latestSeq: appended.seq };
    before.updatedSeqByRun.set(command.runId, appended.seq);
    for (const run of Object.values(before.snapshot.runs)) {
      await upsertProjection(client, run, before.updatedSeqByRun.get(run.runId) ?? appended.seq);
    }
    await client.query(
      `INSERT INTO agent_run_projection_state (singleton,last_seq) VALUES (TRUE,$1)
       ON CONFLICT (singleton) DO UPDATE SET last_seq=EXCLUDED.last_seq`,
      [appended.seq],
    );
    return {
      aggregate,
      event,
      seq: appended.seq,
      ...(resultRef === undefined ? {} : { resultRef }),
    };
  });
}

export async function appendAgentRunRawEvent(
  db: ConnectableDb,
  input: {
    runId: string;
    principal: string;
    policyScope: string;
    ordinal: number;
    cursor?: string;
    redactedPayload: unknown;
  },
): Promise<{ payloadRef: string; bytes: number; seq: number }> {
  await synchronizeAgentRunProjection(db);
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740943)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.runId]);
    const authorized = await client.query(
      `SELECT 1 FROM agent_run_projection
       WHERE run_id=$1 AND principal=$2 AND policy_scope=$3`,
      [input.runId, input.principal, input.policyScope],
    );
    if (authorized.rowCount === 0) throw new Error('agent run is not authorized or does not exist');
    const stats = await client.query<{
      count: string | number;
      bytes: string | number;
      ordinal: string | number | null;
    }>(
      `SELECT count(*) AS count,coalesce(sum((detail->>'byteLength')::bigint),0) AS bytes,
              max((detail->>'ordinal')::integer) AS ordinal
       FROM events WHERE domain='capability' AND kind='agent-run-raw-chunk-recorded' AND rel=$1`,
      [`agent-run:${input.runId}`],
    );
    if (input.ordinal !== Number(stats.rows[0]?.ordinal ?? 0) + 1) {
      throw new Error('raw event ordinal is not consecutive');
    }
    if (Number(stats.rows[0]?.count ?? 0) >= 2_000) throw new Error('raw event budget exhausted');
    const payloadStats = sha256(input.redactedPayload);
    if (payloadStats.bytes > 64 * 1024) throw new Error('raw event chunk budget exceeded');
    if (Number(stats.rows[0]?.bytes ?? 0) + payloadStats.bytes > 4 * 1024 * 1024) {
      throw new Error('raw event byte budget exhausted');
    }
    const stored = await storeAgentRunPayload(
      client,
      input.redactedPayload,
      'application/vnd.ui4a.agent-raw-event+json',
    );
    const appended = await appendEvent(client, {
      domain: 'capability',
      kind: 'agent-run-raw-chunk-recorded',
      rel: `agent-run:${input.runId}`,
      actor: 'agent',
      principal: input.principal,
      channel: 'agent-run',
      detail: {
        runId: input.runId,
        ordinal: input.ordinal,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        payloadRef: stored.hash,
        byteLength: stored.bytes,
        redacted: true,
      },
    });
    return { payloadRef: stored.hash, bytes: stored.bytes, seq: appended.seq };
  });
}

async function getProjectionRun(
  db: DbExecutor,
  sql: string,
  values: readonly unknown[],
): Promise<AgentRun | undefined> {
  const result = await db.query<{ aggregate: AgentRun }>(sql, values);
  return result.rows[0]?.aggregate;
}

export async function getAgentRun(
  db: ConnectableDb,
  runId: string,
  principal: string,
  policyScope: string,
): Promise<AgentRun | undefined> {
  await synchronizeAgentRunProjection(db);
  return getProjectionRun(
    db,
    `SELECT aggregate FROM agent_run_projection
     WHERE run_id=$1 AND principal=$2 AND policy_scope=$3`,
    [runId, principal, policyScope],
  );
}

export async function getAgentRunInternal(
  db: ConnectableDb,
  runId: string,
): Promise<AgentRun | undefined> {
  await synchronizeAgentRunProjection(db);
  return getProjectionRun(db, 'SELECT aggregate FROM agent_run_projection WHERE run_id=$1', [
    runId,
  ]);
}

export async function listAgentRuns(
  db: ConnectableDb,
  input: { principal: string; policyScope: string; limit?: number },
): Promise<AgentRun[]> {
  await synchronizeAgentRunProjection(db);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const result = await db.query<{ aggregate: AgentRun }>(
    `SELECT aggregate FROM agent_run_projection
     WHERE principal=$1 AND policy_scope=$2 ORDER BY updated_seq DESC LIMIT $3`,
    [input.principal, input.policyScope, limit],
  );
  return result.rows.map((row) => row.aggregate);
}

export async function findAgentRunsBySource(
  db: ConnectableDb,
  sourceRel: string,
  principal: string,
  policyScope: string,
): Promise<AgentRun[]> {
  await synchronizeAgentRunProjection(db);
  const result = await db.query<{ aggregate: AgentRun }>(
    `SELECT aggregate FROM agent_run_projection
     WHERE source_rel=$1 AND principal=$2 AND policy_scope=$3 ORDER BY updated_seq DESC`,
    [sourceRel, principal, policyScope],
  );
  return result.rows.map((row) => row.aggregate);
}

export async function listAgentRunRawReceipts(
  db: DbExecutor,
  runId: string,
): Promise<Record<string, unknown>[]> {
  const result = await db.query<{ detail: Record<string, unknown> }>(
    `SELECT detail FROM events WHERE domain='capability'
     AND ((kind='agent-run-raw-chunk-recorded' AND rel=$1)
       OR (kind='capability-raw-chunk-recorded' AND rel=$2)) ORDER BY seq ASC`,
    [`agent-run:${runId}`, `capability-run:${runId}`],
  );
  return result.rows.map((row) => row.detail);
}

export async function getAgentRunResultRef(
  db: DbExecutor,
  runId: string,
): Promise<string | undefined> {
  const result = await db.query<{ result_ref: string | null }>(
    `SELECT detail->>'resultRef' AS result_ref FROM events
     WHERE domain='capability' AND kind='agent-run-succeeded' AND rel=$1
     ORDER BY seq DESC LIMIT 1`,
    [`agent-run:${runId}`],
  );
  return result.rows[0]?.result_ref ?? undefined;
}
