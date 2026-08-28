import { canonicalAgentJson, hashCanonicalAgentJson, parseAgentDefinitionRef } from '@ui4a/engine';
import type {
  AgentDefinitionRef,
  ContentHash,
  FlattenedAgentDefinitionArtifact,
  JsonValue,
} from '@ui4a/shared';

import type { DbExecutor } from '../events';

import type {
  AgentDefinitionStoredEvent,
  AgentDefinitionVersionRecord,
  ConnectableDb,
  FlattenedDefinitionPayload,
} from './types';

export async function withTransaction<T>(
  db: ConnectableDb,
  run: (client: DbExecutor) => Promise<T>,
): Promise<T> {
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

export function agentDefinitionPayloadSha256(payload: unknown): ContentHash {
  return hashCanonicalAgentJson(payload as JsonValue);
}

export async function storePayload(db: DbExecutor, payload: unknown): Promise<ContentHash> {
  const canonical = canonicalAgentJson(payload as JsonValue);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  const hash = agentDefinitionPayloadSha256(payload);
  await db.query(
    `INSERT INTO agent_definition_payloads
       (payload_hash,media_type,canonicalization_version,byte_length,payload)
     VALUES ($1,'application/json',1,$2,$3::jsonb)
     ON CONFLICT (payload_hash) DO NOTHING`,
    [hash, bytes, canonical],
  );
  const stored = await db.query<{ payload: unknown }>(
    'SELECT payload FROM agent_definition_payloads WHERE payload_hash=$1',
    [hash],
  );
  if (
    stored.rows[0] === undefined ||
    agentDefinitionPayloadSha256(stored.rows[0].payload) !== hash
  ) {
    throw new Error('agent definition payload integrity failure');
  }
  return hash;
}

export function flattenedPayload(
  artifact: FlattenedAgentDefinitionArtifact,
): FlattenedDefinitionPayload {
  return {
    schemaVersion: 1,
    ref: artifact.ref,
    ...(artifact.derivedFrom === undefined ? {} : { derivedFrom: artifact.derivedFrom }),
    definition: artifact.definition,
  };
}

export function recordFromRow(row: {
  principal: string;
  policy_scope: string;
  definition_name: string;
  definition_version: number;
  definition_ref: AgentDefinitionRef;
  status: AgentDefinitionVersionRecord['status'];
  source_hash: ContentHash;
  flattened_hash: ContentHash;
  template_hash: ContentHash;
  evaluation_hash: ContentHash;
  parent_ref: AgentDefinitionRef | null;
  registered_actor: string;
  registered_seq: string | number;
  activated_seq: string | number | null;
  deprecated_seq: string | number | null;
  updated_seq: string | number;
}): AgentDefinitionVersionRecord {
  return {
    schemaVersion: 1,
    ref: row.definition_ref,
    name: row.definition_name,
    version: Number(row.definition_version),
    principal: row.principal,
    policyScope: row.policy_scope,
    status: row.status,
    content: {
      source: row.source_hash,
      flattened: row.flattened_hash,
      template: row.template_hash,
      evaluation: row.evaluation_hash,
    },
    flattenedHash: row.flattened_hash,
    ...(row.parent_ref === null ? {} : { parentRef: row.parent_ref }),
    registeredActor: row.registered_actor,
    registeredSeq: Number(row.registered_seq),
    ...(row.activated_seq === null ? {} : { activatedSeq: Number(row.activated_seq) }),
    ...(row.deprecated_seq === null ? {} : { deprecatedSeq: Number(row.deprecated_seq) }),
    updatedSeq: Number(row.updated_seq),
  };
}

export type VersionRow = Parameters<typeof recordFromRow>[0];

export async function getVersionRecord(
  db: DbExecutor,
  name: string,
  version: number,
  principal: string,
  policyScope: string,
): Promise<AgentDefinitionVersionRecord | undefined> {
  const result = await db.query<VersionRow>(
    `SELECT * FROM agent_definition_versions
     WHERE definition_name=$1 AND definition_version=$2 AND principal=$3 AND policy_scope=$4`,
    [name, version, principal, policyScope],
  );
  return result.rows[0] === undefined ? undefined : recordFromRow(result.rows[0]);
}

export async function findCommand(
  db: DbExecutor,
  commandId: string,
): Promise<AgentDefinitionStoredEvent | undefined> {
  const found = await db.query<AgentDefinitionStoredEvent>(
    `SELECT seq,kind,detail FROM events
     WHERE domain='agent-definition' AND detail->>'commandId'=$1`,
    [commandId],
  );
  return found.rows[0];
}

export function assertIdempotentIdentity(
  event: AgentDefinitionStoredEvent,
  input: { eventId: string; principal: string; policyScope: string; ref: AgentDefinitionRef },
  kind: AgentDefinitionStoredEvent['kind'],
): void {
  const detail = event.detail;
  const eventRef =
    event.kind === 'agent-definition-version-registered'
      ? event.detail.version.ref
      : event.detail.ref;
  if (
    event.kind !== kind ||
    detail.eventId !== input.eventId ||
    detail.principal !== input.principal ||
    detail.policyScope !== input.policyScope ||
    eventRef !== input.ref
  ) {
    throw new Error('agent definition command id was reused with different input');
  }
}

export async function upsertVersion(
  db: DbExecutor,
  version: AgentDefinitionVersionRecord,
): Promise<void> {
  await db.query(
    `INSERT INTO agent_definition_versions
       (principal,policy_scope,definition_name,definition_version,definition_ref,status,
        source_hash,flattened_hash,template_hash,evaluation_hash,parent_ref,registered_actor,
        registered_seq,activated_seq,deprecated_seq,updated_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (principal,policy_scope,definition_name,definition_version) DO UPDATE SET
       status=EXCLUDED.status, activated_seq=EXCLUDED.activated_seq,
       deprecated_seq=EXCLUDED.deprecated_seq, updated_seq=EXCLUDED.updated_seq`,
    [
      version.principal,
      version.policyScope,
      version.name,
      version.version,
      version.ref,
      version.status,
      version.content.source,
      version.content.flattened,
      version.content.template,
      version.content.evaluation,
      version.parentRef ?? null,
      version.registeredActor,
      version.registeredSeq,
      version.activatedSeq ?? null,
      version.deprecatedSeq ?? null,
      version.updatedSeq,
    ],
  );
}

export async function upsertActive(
  db: DbExecutor,
  version: AgentDefinitionVersionRecord,
  seq: number,
): Promise<void> {
  await db.query(
    `INSERT INTO agent_definition_active
       (principal,policy_scope,definition_name,active_version,activated_seq)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (principal,policy_scope,definition_name) DO UPDATE SET
       active_version=EXCLUDED.active_version, activated_seq=EXCLUDED.activated_seq`,
    [version.principal, version.policyScope, version.name, version.version, seq],
  );
}

export function systemSeedIdentity(version: AgentDefinitionVersionRecord): string {
  return JSON.stringify({
    ref: version.ref,
    name: version.name,
    version: version.version,
    policyScope: version.policyScope,
    content: version.content,
    flattenedHash: version.flattenedHash,
    parentRef: version.parentRef ?? null,
  });
}

export function oneSystemSeed(
  rows: readonly AgentDefinitionVersionRecord[],
  where: string,
): AgentDefinitionVersionRecord | undefined {
  const first = rows[0];
  if (first === undefined) return undefined;
  const expected = systemSeedIdentity(first);
  if (
    rows.some(
      (version) =>
        version.status !== 'active' ||
        version.registeredActor !== 'system:bootstrap' ||
        systemSeedIdentity(version) !== expected,
    )
  ) {
    throw new Error(`system seed Agent Definition conflict for ${where}`);
  }
  return first;
}

export async function activeSystemSeedRows(
  db: DbExecutor,
  policyScope: string,
  ref?: AgentDefinitionRef,
): Promise<AgentDefinitionVersionRecord[]> {
  const parsed = ref === undefined ? undefined : parseAgentDefinitionRef(ref);
  const result = await db.query<VersionRow>(
    `SELECT v.* FROM agent_definition_active a
       JOIN agent_definition_versions v
         ON v.principal=a.principal AND v.policy_scope=a.policy_scope
        AND v.definition_name=a.definition_name AND v.definition_version=a.active_version
     WHERE v.policy_scope=$1 AND v.status='active'
       AND v.registered_actor='system:bootstrap'
       ${
         parsed === undefined
           ? ''
           : 'AND v.definition_name=$2 AND v.definition_version=$3 AND v.definition_ref=$4'
       }
     ORDER BY v.definition_name,v.definition_version,v.principal`,
    parsed === undefined ? [policyScope] : [policyScope, parsed.name, parsed.version, ref],
  );
  return result.rows.map(recordFromRow);
}

/** Resolve one repository-owned active seed by exact ref/scope, independent of request owner. */
