import { createHash } from 'node:crypto';

import { canonicalJson } from '@ui4a/engine';

import { rebuildAgentDefinitionProjection } from './agent-definitions';
import { rebuildAgentRunProjection } from './agent-runs';
import { rebuildDraftProjection } from './drafts';
import type { ConnectableDb, DbExecutor } from './events';
import { rebuildPresentationProjection } from './presentation';

export interface Ui4aRecoveryFingerprint {
  schemaVersion: 1;
  eventHighWaterMark: number;
  eventCount: number;
  eventDigest: string;
  payloadDigest: string;
  runEvidenceDigest: string;
  businessSnapshotHash: string;
  authoritativeHash: string;
  projectionsExcluded: true;
}

interface EventEvidenceRow {
  seq: string | number;
  ts: string;
  domain: string;
  actor: string | null;
  principal: string | null;
  channel: string | null;
  kind: string;
  rel: string | null;
  action: string | null;
  params: unknown;
  reason: string | null;
  detail: unknown;
}

interface PayloadEvidenceRow {
  table_name: string;
  payload_hash: string;
  media_type: string;
  metadata_version: string | number;
  byte_length: string | number;
  payload: unknown;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function normalizeEvent(row: EventEvidenceRow): Record<string, unknown> {
  return { ...row, seq: Number(row.seq) };
}

function normalizePayload(row: PayloadEvidenceRow): Record<string, unknown> {
  const serialized = canonicalJson(row.payload);
  const expectedHash = `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
  const expectedBytes = new TextEncoder().encode(serialized).byteLength;
  if (
    row.payload_hash !== expectedHash ||
    Number(row.byte_length) !== expectedBytes ||
    Number(row.metadata_version) !== 1 ||
    row.media_type === ''
  ) {
    throw new Error('RECOVERY_PAYLOAD_INTEGRITY_FAILED');
  }
  return {
    table: row.table_name,
    hash: row.payload_hash,
    mediaType: row.media_type,
    metadataVersion: Number(row.metadata_version),
    bytes: Number(row.byte_length),
    payload: row.payload,
  };
}

async function withConsistentRead<T>(
  db: ConnectableDb,
  read: (client: DbExecutor) => Promise<T>,
): Promise<T> {
  const acquired = db.connect === undefined ? db : await db.connect();
  const client = acquired as DbExecutor;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const result = await read(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if ('release' in acquired && typeof acquired.release === 'function') acquired.release();
  }
}

async function authoritativeEvents(db: DbExecutor): Promise<Record<string, unknown>[]> {
  const result = await db.query<EventEvidenceRow>(
    `SELECT seq,ts::text AS ts,domain,actor,principal,channel,kind,rel,action,
            params,reason,detail
     FROM events ORDER BY seq ASC`,
  );
  return result.rows.map(normalizeEvent);
}

async function immutablePayloads(db: DbExecutor): Promise<Record<string, unknown>[]> {
  const result = await db.query<PayloadEvidenceRow>(
    `SELECT table_name,payload_hash,media_type,metadata_version,byte_length,payload
     FROM (
       SELECT 'draft_payloads' AS table_name,payload_hash,media_type,
              canonicalization_version AS metadata_version,byte_length,payload
       FROM draft_payloads
       UNION ALL
       SELECT 'agent_definition_payloads',payload_hash,media_type,
              canonicalization_version,byte_length,payload
       FROM agent_definition_payloads
       UNION ALL
       SELECT 'agent_run_payloads',payload_hash,media_type,1,byte_length,payload
       FROM agent_run_payloads
     ) AS immutable_payloads
     ORDER BY table_name,payload_hash`,
  );
  return result.rows.map(normalizePayload);
}

function runEvidence(events: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return events.filter(({ domain, kind }) => {
    if (domain !== 'capability' || typeof kind !== 'string') return false;
    return kind.startsWith('agent-run-');
  });
}

/**
 * Capture only digests/counts from UI4A authority. Payload and Secret-bearing values never leave
 * this boundary; projections are deliberately excluded because they are rebuilt from events.
 */
export async function captureUi4aRecoveryFingerprint(
  db: ConnectableDb,
  input: { businessSnapshot: unknown },
): Promise<Ui4aRecoveryFingerprint> {
  const [events, payloads] = await withConsistentRead(db, async (client) => [
    await authoritativeEvents(client),
    await immutablePayloads(client),
  ]);
  const eventCount = events.length;
  const eventHighWaterMark = Number(events.at(-1)?.seq ?? 0);
  if (!Number.isSafeInteger(eventHighWaterMark)) {
    throw new Error('RECOVERY_EVENT_SEQUENCE_UNSAFE');
  }
  const eventDigest = digest(events);
  const payloadDigest = digest(payloads);
  const runEvidenceDigest = digest(runEvidence(events));
  const businessSnapshotHash = digest(input.businessSnapshot);
  const authoritativeHash = digest({
    businessSnapshotHash,
    eventCount,
    eventDigest,
    eventHighWaterMark,
    payloadDigest,
    runEvidenceDigest,
  });
  return {
    schemaVersion: 1,
    eventHighWaterMark,
    eventCount,
    eventDigest,
    payloadDigest,
    runEvidenceDigest,
    businessSnapshotHash,
    authoritativeHash,
    projectionsExcluded: true,
  };
}

/** Hash the stable semantic views exposed by every rebuildable UI4A projection. */
export async function captureUi4aProjectionFingerprint(db: ConnectableDb): Promise<string> {
  return withConsistentRead(db, async (client) => {
    const drafts = await client.query<{ aggregate: unknown }>(
      'SELECT aggregate FROM draft_projection ORDER BY draft_id',
    );
    const definitionVersions = await client.query<Record<string, unknown>>(
      `SELECT principal,policy_scope,definition_name,definition_version,definition_ref,status,
                source_hash,flattened_hash,template_hash,evaluation_hash,parent_ref,registered_actor,
                registered_seq::text,activated_seq::text,deprecated_seq::text
         FROM agent_definition_versions
         ORDER BY principal,policy_scope,definition_name,definition_version`,
    );
    const activeDefinitions = await client.query<Record<string, unknown>>(
      `SELECT principal,policy_scope,definition_name,active_version,activated_seq::text
         FROM agent_definition_active
         ORDER BY principal,policy_scope,definition_name`,
    );
    const agentRuns = await client.query<{ aggregate: unknown }>(
      'SELECT aggregate FROM agent_run_projection ORDER BY run_id',
    );
    const sidecars = await client.query<{ aggregate: unknown }>(
      'SELECT aggregate FROM presentation_user_sidecars ORDER BY sidecar_id',
    );
    return digest({
      drafts: drafts.rows.map(({ aggregate }) => aggregate),
      definitionVersions: definitionVersions.rows,
      activeDefinitions: activeDefinitions.rows,
      agentRuns: agentRuns.rows.map(({ aggregate }) => aggregate),
      sidecars: sidecars.rows.map(({ aggregate }) => aggregate),
    });
  });
}

/** Rebuild all disposable UI4A views from append-only events and immutable payloads. */
export async function rebuildAllUi4aProjections(db: ConnectableDb): Promise<void> {
  await rebuildDraftProjection(db);
  await rebuildAgentDefinitionProjection(db);
  await rebuildAgentRunProjection(db);
  await rebuildPresentationProjection(db);
}
