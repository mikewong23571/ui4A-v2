import {
  canonicalAgentJson,
  hashCanonicalAgentJson,
  parseAgentDefinitionSource,
  parseAgentDefinitionRef,
} from '@ui4a/engine';
import type {
  AgentDefinitionRef,
  AgentDefinitionSource,
  ContentHash,
  FlattenedAgentDefinitionArtifact,
  JsonValue,
  PromptTemplate,
} from '@ui4a/shared';
import type { PoolClient } from 'pg';

import { appendEvent, ensureEventsTable, type DbExecutor, type EventAppend } from './events';

export const AGENT_DEFINITION_DDL = `
CREATE TABLE IF NOT EXISTS agent_definition_payloads (
  payload_hash              TEXT PRIMARY KEY,
  media_type                TEXT NOT NULL DEFAULT 'application/json',
  canonicalization_version  INTEGER NOT NULL DEFAULT 1,
  byte_length               INTEGER NOT NULL,
  payload                   JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_definition_versions (
  principal           TEXT NOT NULL,
  policy_scope        TEXT NOT NULL,
  definition_name     TEXT NOT NULL,
  definition_version  INTEGER NOT NULL,
  definition_ref      TEXT NOT NULL,
  status              TEXT NOT NULL,
  source_hash         TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  flattened_hash      TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  template_hash       TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  evaluation_hash     TEXT NOT NULL REFERENCES agent_definition_payloads(payload_hash),
  parent_ref          TEXT,
  registered_actor    TEXT NOT NULL,
  registered_seq      BIGINT NOT NULL,
  activated_seq       BIGINT,
  deprecated_seq      BIGINT,
  updated_seq         BIGINT NOT NULL,
  PRIMARY KEY (principal, policy_scope, definition_name, definition_version),
  UNIQUE (principal, policy_scope, definition_ref)
);

CREATE TABLE IF NOT EXISTS agent_definition_active (
  principal           TEXT NOT NULL,
  policy_scope        TEXT NOT NULL,
  definition_name     TEXT NOT NULL,
  active_version      INTEGER NOT NULL,
  activated_seq       BIGINT NOT NULL,
  PRIMARY KEY (principal, policy_scope, definition_name),
  FOREIGN KEY (principal, policy_scope, definition_name, active_version)
    REFERENCES agent_definition_versions
      (principal, policy_scope, definition_name, definition_version)
);

CREATE INDEX IF NOT EXISTS agent_definition_versions_scope
  ON agent_definition_versions (principal, policy_scope, definition_name, definition_version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_definition_event_id_unique
  ON events ((detail->>'eventId'))
  WHERE domain='agent-definition' AND detail ? 'eventId';
CREATE UNIQUE INDEX IF NOT EXISTS agent_definition_command_id_unique
  ON events ((detail->>'commandId'))
  WHERE domain='agent-definition' AND detail ? 'commandId';

CREATE OR REPLACE FUNCTION agent_definition_payloads_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_definition_payloads append-only: % is forbidden for %',
    TG_OP, OLD.payload_hash;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_definition_payloads_append_only_trigger ON agent_definition_payloads;
CREATE TRIGGER agent_definition_payloads_append_only_trigger
  BEFORE UPDATE OR DELETE ON agent_definition_payloads
  FOR EACH ROW EXECUTE FUNCTION agent_definition_payloads_append_only();
`;

interface ConnectableDb extends DbExecutor {
  connect?: () => Promise<PoolClient>;
}

export interface AgentDefinitionContentRefs {
  source: ContentHash;
  flattened: ContentHash;
  template: ContentHash;
  evaluation: ContentHash;
}

export interface AgentDefinitionVersionRecord {
  schemaVersion: 1;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
  principal: string;
  policyScope: string;
  status: 'registered' | 'active' | 'deprecated';
  content: AgentDefinitionContentRefs;
  flattenedHash: ContentHash;
  parentRef?: AgentDefinitionRef;
  registeredActor: string;
  registeredSeq: number;
  activatedSeq?: number;
  deprecatedSeq?: number;
  updatedSeq: number;
}

export interface AgentDefinitionVersionView {
  version: AgentDefinitionVersionRecord;
  source: AgentDefinitionSource;
  flattened: FlattenedDefinitionPayload;
  template: PromptTemplate;
  evaluation: JsonValue;
}

export interface AgentDefinitionRegistrySnapshot {
  definitions: ReadonlyMap<
    AgentDefinitionRef,
    { status: 'draft' | 'active' | 'deprecated'; source: AgentDefinitionSource }
  >;
  activeByName: ReadonlyMap<string, AgentDefinitionRef>;
}

interface FlattenedDefinitionPayload {
  schemaVersion: 1;
  ref: AgentDefinitionRef;
  derivedFrom?: FlattenedAgentDefinitionArtifact['derivedFrom'];
  definition: FlattenedAgentDefinitionArtifact['definition'];
}

interface RegistrationEventDetail {
  eventId: string;
  commandId: string;
  actor: string;
  principal: string;
  policyScope: string;
  version: Omit<AgentDefinitionVersionRecord, 'registeredSeq' | 'updatedSeq'>;
}

interface ActivationEventDetail {
  eventId: string;
  commandId: string;
  actor: string;
  principal: string;
  policyScope: string;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
  expectedActiveVersion: number | null;
}

interface DeprecationEventDetail {
  eventId: string;
  commandId: string;
  actor: string;
  principal: string;
  policyScope: string;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
}

type AgentDefinitionStoredEvent =
  | { seq: number; kind: 'agent-definition-version-registered'; detail: RegistrationEventDetail }
  | { seq: number; kind: 'agent-definition-version-activated'; detail: ActivationEventDetail }
  | { seq: number; kind: 'agent-definition-version-deprecated'; detail: DeprecationEventDetail };

async function withTransaction<T>(
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

export async function ensureAgentDefinitionTables(db: DbExecutor): Promise<void> {
  await ensureEventsTable(db);
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740940)');
    await db.query(AGENT_DEFINITION_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** SHA-256 over the same recursively sorted JSON representation used by the pure definition kernel. */
export function agentDefinitionPayloadSha256(payload: unknown): ContentHash {
  return hashCanonicalAgentJson(payload as JsonValue);
}

async function storePayload(db: DbExecutor, payload: unknown): Promise<ContentHash> {
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

function flattenedPayload(artifact: FlattenedAgentDefinitionArtifact): FlattenedDefinitionPayload {
  return {
    schemaVersion: 1,
    ref: artifact.ref,
    ...(artifact.derivedFrom === undefined ? {} : { derivedFrom: artifact.derivedFrom }),
    definition: artifact.definition,
  };
}

function recordFromRow(row: {
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

type VersionRow = Parameters<typeof recordFromRow>[0];

async function getVersionRecord(
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

async function findCommand(
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

function assertIdempotentIdentity(
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

export async function registerAgentDefinitionVersion(
  db: ConnectableDb,
  input: {
    eventId: string;
    commandId: string;
    actor: string;
    principal: string;
    policyScope: string;
    expectedLatestVersion: number;
    source: AgentDefinitionSource;
    artifact: FlattenedAgentDefinitionArtifact;
    evalEvidence: JsonValue;
  },
): Promise<{
  version: AgentDefinitionVersionRecord;
  event?: RegistrationEventDetail;
  seq?: number;
}> {
  const source = parseAgentDefinitionSource(input.source);
  const parsedRef = parseAgentDefinitionRef(source.ref);
  if (input.artifact.ref !== source.ref || input.artifact.definition.ref !== source.ref) {
    throw new Error('agent definition source and flattened artifact ref mismatch');
  }
  if (
    agentDefinitionPayloadSha256(flattenedPayload(input.artifact)) !== input.artifact.flattenedHash
  ) {
    throw new Error('agent definition flattened artifact hash mismatch');
  }
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740941)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([input.principal, input.policyScope, source.name]),
    ]);
    const deduplicated = await findCommand(client, input.commandId);
    if (deduplicated !== undefined) {
      assertIdempotentIdentity(
        deduplicated,
        { ...input, ref: source.ref },
        'agent-definition-version-registered',
      );
      const version = await getVersionRecord(
        client,
        parsedRef.name,
        parsedRef.version,
        input.principal,
        input.policyScope,
      );
      if (version === undefined) throw new Error('deduplicated command has no projected version');
      return { version };
    }
    const latest = await client.query<{ version: string | number | null }>(
      `SELECT max(definition_version) AS version FROM agent_definition_versions
       WHERE definition_name=$1 AND principal=$2 AND policy_scope=$3`,
      [parsedRef.name, input.principal, input.policyScope],
    );
    const latestVersion = Number(latest.rows[0]?.version ?? 0);
    const exists = await getVersionRecord(
      client,
      parsedRef.name,
      parsedRef.version,
      input.principal,
      input.policyScope,
    );
    if (exists !== undefined) throw new Error('agent definition version already exists');
    if (latestVersion !== input.expectedLatestVersion) {
      throw new Error(
        `agent definition latest version conflict: expected ${input.expectedLatestVersion}, actual ${latestVersion}`,
      );
    }
    if (parsedRef.version !== latestVersion + 1) {
      throw new Error(
        `agent definition version must be next consecutive version ${latestVersion + 1}`,
      );
    }
    const flattened = flattenedPayload(input.artifact);
    const content: AgentDefinitionContentRefs = {
      source: await storePayload(client, source),
      flattened: await storePayload(client, flattened),
      template: await storePayload(client, input.artifact.definition.prompt),
      evaluation: await storePayload(client, input.evalEvidence),
    };
    if (content.flattened !== input.artifact.flattenedHash) {
      throw new Error('agent definition flattened payload integrity failure');
    }
    const versionWithoutSeq: Omit<AgentDefinitionVersionRecord, 'registeredSeq' | 'updatedSeq'> = {
      schemaVersion: 1,
      ref: source.ref,
      name: source.name,
      version: source.version,
      principal: input.principal,
      policyScope: input.policyScope,
      status: 'registered',
      content,
      flattenedHash: input.artifact.flattenedHash,
      ...('extends' in source ? { parentRef: source.extends } : {}),
      registeredActor: input.actor,
    };
    const event: RegistrationEventDetail = {
      eventId: input.eventId,
      commandId: input.commandId,
      actor: input.actor,
      principal: input.principal,
      policyScope: input.policyScope,
      version: versionWithoutSeq,
    };
    const appended = await appendEvent(client, {
      domain: 'agent-definition',
      kind: 'agent-definition-version-registered',
      actor: input.actor === 'human' ? 'human' : 'agent',
      principal: input.principal,
      channel: 'meta',
      rel: `agent-definition:${source.ref}`,
      detail: event,
    });
    const version: AgentDefinitionVersionRecord = {
      ...versionWithoutSeq,
      registeredSeq: appended.seq,
      updatedSeq: appended.seq,
    };
    await upsertVersion(client, version);
    return { version, event, seq: appended.seq };
  });
}

/**
 * Install one trusted, repository-owned Agent Definition during application boot.
 *
 * This is deliberately separate from Draft approval: its events identify a system seed and use
 * the storage-level `agent` actor rather than fabricating a human decision. Existing versions must
 * match byte-for-byte and already be active, making repeated boots idempotent but never corrective.
 */
export async function installSeedAgentDefinition(
  db: ConnectableDb,
  input: {
    principal: string;
    policyScope: string;
    source: AgentDefinitionSource;
    artifact: FlattenedAgentDefinitionArtifact;
    evalEvidence: JsonValue;
  },
): Promise<AgentDefinitionVersionRecord> {
  const source = parseAgentDefinitionSource(input.source);
  const parsed = parseAgentDefinitionRef(source.ref);
  if (input.artifact.ref !== source.ref || input.artifact.definition.ref !== source.ref) {
    throw new Error('seed Agent Definition source and flattened artifact ref mismatch');
  }
  const flattened = flattenedPayload(input.artifact);
  if (agentDefinitionPayloadSha256(flattened) !== input.artifact.flattenedHash) {
    throw new Error('seed Agent Definition flattened artifact hash mismatch');
  }
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740941)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([input.principal, input.policyScope, source.name]),
    ]);
    const existing = await getVersionRecord(
      client,
      parsed.name,
      parsed.version,
      input.principal,
      input.policyScope,
    );
    if (existing !== undefined) {
      const expected = {
        source: agentDefinitionPayloadSha256(source),
        flattened: agentDefinitionPayloadSha256(flattened),
        template: agentDefinitionPayloadSha256(input.artifact.definition.prompt),
        evaluation: agentDefinitionPayloadSha256(input.evalEvidence),
      };
      if (
        existing.status !== 'active' ||
        existing.registeredActor !== 'system:bootstrap' ||
        JSON.stringify(existing.content) !== JSON.stringify(expected)
      ) {
        throw new Error(`seed Agent Definition ${source.ref} conflicts with installed version`);
      }
      return existing;
    }
    const latest = await client.query<{ version: string | number | null }>(
      `SELECT max(definition_version) AS version FROM agent_definition_versions
       WHERE definition_name=$1 AND principal=$2 AND policy_scope=$3`,
      [source.name, input.principal, input.policyScope],
    );
    const latestVersion = Number(latest.rows[0]?.version ?? 0);
    if (parsed.version !== latestVersion + 1) {
      throw new Error(`seed Agent Definition version must be ${latestVersion + 1}`);
    }
    if ('extends' in source) {
      const parent = await getVersionRecord(
        client,
        parseAgentDefinitionRef(source.extends).name,
        parseAgentDefinitionRef(source.extends).version,
        input.principal,
        input.policyScope,
      );
      if (parent?.status !== 'active') {
        throw new Error(`seed Agent Definition parent ${source.extends} is not active`);
      }
    }
    const content: AgentDefinitionContentRefs = {
      source: await storePayload(client, source),
      flattened: await storePayload(client, flattened),
      template: await storePayload(client, input.artifact.definition.prompt),
      evaluation: await storePayload(client, input.evalEvidence),
    };
    const unsequenced: Omit<AgentDefinitionVersionRecord, 'registeredSeq' | 'updatedSeq'> = {
      schemaVersion: 1,
      ref: source.ref,
      name: source.name,
      version: source.version,
      principal: input.principal,
      policyScope: input.policyScope,
      status: 'registered',
      content,
      flattenedHash: input.artifact.flattenedHash,
      ...('extends' in source ? { parentRef: source.extends } : {}),
      registeredActor: 'system:bootstrap',
    };
    const id = `${input.principal}:${input.policyScope}:${source.ref}`;
    const registered: RegistrationEventDetail = {
      eventId: `event:system-seed:${id}:registered`,
      commandId: `system-seed:${id}:registered`,
      actor: 'system:bootstrap',
      principal: input.principal,
      policyScope: input.policyScope,
      version: unsequenced,
    };
    const registeredEvent = await appendEvent(client, {
      domain: 'agent-definition',
      kind: 'agent-definition-version-registered',
      actor: 'agent',
      principal: input.principal,
      channel: 'meta',
      rel: `agent-definition:${source.ref}`,
      detail: registered,
    });
    const activated: ActivationEventDetail & { provenance: JsonValue } = {
      eventId: `event:system-seed:${id}:activated`,
      commandId: `system-seed:${id}:activated`,
      actor: 'system:bootstrap',
      principal: input.principal,
      policyScope: input.policyScope,
      ref: source.ref,
      name: source.name,
      version: source.version,
      expectedActiveVersion: null,
      provenance: { kind: 'system-seed', source: 'repository-builtin' },
    };
    const activatedEvent = await appendEvent(client, {
      domain: 'agent-definition',
      kind: 'agent-definition-version-activated',
      actor: 'agent',
      principal: input.principal,
      channel: 'meta',
      rel: `agent-definition:${source.ref}`,
      detail: activated,
    });
    const version: AgentDefinitionVersionRecord = {
      ...unsequenced,
      status: 'active',
      registeredSeq: registeredEvent.seq,
      activatedSeq: activatedEvent.seq,
      updatedSeq: activatedEvent.seq,
    };
    await upsertVersion(client, version);
    await upsertActive(client, version, activatedEvent.seq);
    return version;
  });
}

/**
 * Prepare an Agent Definition registry mutation inside an existing transaction. The caller owns
 * event append order and must invoke `applyProjection` with the returned event seqs before commit.
 * This keeps Draft acceptance, both registry events, and the rebuildable projections atomic.
 */
export async function prepareAgentDefinitionActivation(
  client: DbExecutor,
  input: {
    eventIdPrefix: string;
    commandId: string;
    actor: string;
    principal: string;
    policyScope: string;
    expectedActiveRef?: AgentDefinitionRef;
    source: AgentDefinitionSource;
    artifact: FlattenedAgentDefinitionArtifact;
    evalEvidence: JsonValue;
    provenance?: JsonValue;
  },
): Promise<{
  events: EventAppend[];
  applyProjection(input: { client: DbExecutor; seqs: number[] }): Promise<void>;
}> {
  if (input.actor !== 'human') throw new Error('agent definition activation requires human actor');
  const source = parseAgentDefinitionSource(input.source);
  const parsed = parseAgentDefinitionRef(source.ref);
  if (input.artifact.ref !== source.ref || input.artifact.definition.ref !== source.ref) {
    throw new Error('agent definition source and flattened artifact ref mismatch');
  }
  if (
    agentDefinitionPayloadSha256(flattenedPayload(input.artifact)) !== input.artifact.flattenedHash
  ) {
    throw new Error('agent definition flattened artifact hash mismatch');
  }
  await client.query('SELECT pg_advisory_xact_lock(740941)');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    JSON.stringify([input.principal, input.policyScope, parsed.name]),
  ]);
  if (await findCommand(client, input.commandId)) {
    throw new Error('agent definition activation command is already recorded');
  }
  const active = await client.query<{ active_version: string | number }>(
    `SELECT active_version FROM agent_definition_active
     WHERE definition_name=$1 AND principal=$2 AND policy_scope=$3`,
    [parsed.name, input.principal, input.policyScope],
  );
  const actualActiveVersion =
    active.rows[0] === undefined ? undefined : Number(active.rows[0].active_version);
  const expectedActiveVersion =
    input.expectedActiveRef === undefined
      ? undefined
      : parseAgentDefinitionRef(input.expectedActiveRef).version;
  if (
    input.expectedActiveRef !== undefined &&
    parseAgentDefinitionRef(input.expectedActiveRef).name !== parsed.name
  ) {
    throw new Error('agent definition expected active ref names a different specialization');
  }
  if (actualActiveVersion !== expectedActiveVersion) {
    throw new Error(
      `agent definition active version conflict: expected ${input.expectedActiveRef ?? '(none)'}, actual ${
        actualActiveVersion === undefined ? '(none)' : `${parsed.name}@${actualActiveVersion}`
      }`,
    );
  }
  const latest = await client.query<{ version: string | number | null }>(
    `SELECT max(definition_version) AS version FROM agent_definition_versions
     WHERE definition_name=$1 AND principal=$2 AND policy_scope=$3`,
    [parsed.name, input.principal, input.policyScope],
  );
  const latestVersion = Number(latest.rows[0]?.version ?? 0);
  if (parsed.version !== latestVersion + 1) {
    throw new Error(
      `agent definition version must be next consecutive version ${latestVersion + 1}`,
    );
  }
  const flattened = flattenedPayload(input.artifact);
  const content: AgentDefinitionContentRefs = {
    source: await storePayload(client, source),
    flattened: await storePayload(client, flattened),
    template: await storePayload(client, input.artifact.definition.prompt),
    evaluation: await storePayload(client, input.evalEvidence),
  };
  if (content.flattened !== input.artifact.flattenedHash) {
    throw new Error('agent definition flattened payload integrity failure');
  }
  const unsequenced: Omit<AgentDefinitionVersionRecord, 'registeredSeq' | 'updatedSeq'> = {
    schemaVersion: 1,
    ref: source.ref,
    name: source.name,
    version: source.version,
    principal: input.principal,
    policyScope: input.policyScope,
    status: 'registered',
    content,
    flattenedHash: input.artifact.flattenedHash,
    ...('extends' in source ? { parentRef: source.extends } : {}),
    registeredActor: input.actor,
  };
  const registered: RegistrationEventDetail = {
    eventId: `${input.eventIdPrefix}:registered`,
    commandId: `${input.commandId}:registered`,
    actor: input.actor,
    principal: input.principal,
    policyScope: input.policyScope,
    version: unsequenced,
  };
  const activated: ActivationEventDetail & { provenance?: JsonValue } = {
    eventId: `${input.eventIdPrefix}:activated`,
    commandId: input.commandId,
    actor: input.actor,
    principal: input.principal,
    policyScope: input.policyScope,
    ref: source.ref,
    name: source.name,
    version: source.version,
    expectedActiveVersion: expectedActiveVersion ?? null,
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
  };
  return {
    events: [
      {
        domain: 'agent-definition',
        kind: 'agent-definition-version-registered',
        actor: 'human',
        principal: input.principal,
        channel: 'meta',
        rel: `agent-definition:${source.ref}`,
        detail: registered,
      },
      {
        domain: 'agent-definition',
        kind: 'agent-definition-version-activated',
        actor: 'human',
        principal: input.principal,
        channel: 'meta',
        rel: `agent-definition:${source.ref}`,
        detail: activated,
      },
    ],
    async applyProjection({
      client: projectionClient,
      seqs,
    }: {
      client: DbExecutor;
      seqs: number[];
    }): Promise<void> {
      if (seqs.length !== 2 || seqs[0] === undefined || seqs[1] === undefined) {
        throw new Error('agent definition activation projection requires two event seqs');
      }
      if (seqs[1] <= seqs[0]) {
        throw new Error('agent definition activation event seqs are out of order');
      }
      const version: AgentDefinitionVersionRecord = {
        ...unsequenced,
        status: 'active',
        registeredSeq: seqs[0],
        activatedSeq: seqs[1],
        updatedSeq: seqs[1],
      };
      await upsertVersion(projectionClient, version);
      await upsertActive(projectionClient, version, seqs[1]);
    },
  };
}

export async function activateAgentDefinitionVersion(
  db: ConnectableDb,
  input: {
    eventId: string;
    commandId: string;
    actor: string;
    principal: string;
    policyScope: string;
    ref: AgentDefinitionRef;
    expectedActiveVersion: number | null;
  },
): Promise<{ version: AgentDefinitionVersionRecord; event?: ActivationEventDetail; seq?: number }> {
  if (input.actor !== 'human') throw new Error('agent definition activation requires human actor');
  const parsed = parseAgentDefinitionRef(input.ref);
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740941)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([input.principal, input.policyScope, parsed.name]),
    ]);
    const deduplicated = await findCommand(client, input.commandId);
    if (deduplicated !== undefined) {
      assertIdempotentIdentity(deduplicated, input, 'agent-definition-version-activated');
      const version = await getVersionRecord(
        client,
        parsed.name,
        parsed.version,
        input.principal,
        input.policyScope,
      );
      if (version === undefined) throw new Error('deduplicated activation has no version');
      return { version };
    }
    const version = await getVersionRecord(
      client,
      parsed.name,
      parsed.version,
      input.principal,
      input.policyScope,
    );
    if (version === undefined) throw new Error('agent definition version does not exist');
    if (version.status === 'deprecated')
      throw new Error('deprecated agent definition cannot activate');
    const active = await client.query<{ active_version: string | number }>(
      `SELECT active_version FROM agent_definition_active
       WHERE definition_name=$1 AND principal=$2 AND policy_scope=$3`,
      [parsed.name, input.principal, input.policyScope],
    );
    const activeVersion =
      active.rows[0] === undefined ? null : Number(active.rows[0].active_version);
    if (activeVersion !== input.expectedActiveVersion) {
      throw new Error(
        `agent definition active version conflict: expected ${String(input.expectedActiveVersion)}, actual ${String(activeVersion)}`,
      );
    }
    const event: ActivationEventDetail = {
      eventId: input.eventId,
      commandId: input.commandId,
      actor: input.actor,
      principal: input.principal,
      policyScope: input.policyScope,
      ref: input.ref,
      name: parsed.name,
      version: parsed.version,
      expectedActiveVersion: input.expectedActiveVersion,
    };
    const appended = await appendEvent(client, {
      domain: 'agent-definition',
      kind: 'agent-definition-version-activated',
      actor: 'human',
      principal: input.principal,
      channel: 'meta',
      rel: `agent-definition:${input.ref}`,
      detail: event,
    });
    const activated: AgentDefinitionVersionRecord = {
      ...version,
      status: 'active',
      activatedSeq: appended.seq,
      updatedSeq: appended.seq,
    };
    await upsertVersion(client, activated);
    await upsertActive(client, activated, appended.seq);
    return { version: activated, event, seq: appended.seq };
  });
}

export async function deprecateAgentDefinitionVersion(
  db: ConnectableDb,
  input: {
    eventId: string;
    commandId: string;
    actor: string;
    principal: string;
    policyScope: string;
    ref: AgentDefinitionRef;
  },
): Promise<{
  version: AgentDefinitionVersionRecord;
  event?: DeprecationEventDetail;
  seq?: number;
}> {
  if (input.actor !== 'human') throw new Error('agent definition deprecation requires human actor');
  const parsed = parseAgentDefinitionRef(input.ref);
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740941)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([input.principal, input.policyScope, parsed.name]),
    ]);
    const deduplicated = await findCommand(client, input.commandId);
    if (deduplicated !== undefined) {
      assertIdempotentIdentity(deduplicated, input, 'agent-definition-version-deprecated');
      const version = await getVersionRecord(
        client,
        parsed.name,
        parsed.version,
        input.principal,
        input.policyScope,
      );
      if (version === undefined) throw new Error('deduplicated deprecation has no version');
      return { version };
    }
    const version = await getVersionRecord(
      client,
      parsed.name,
      parsed.version,
      input.principal,
      input.policyScope,
    );
    if (version === undefined) throw new Error('agent definition version does not exist');
    const active = await client.query<{ active_version: string | number }>(
      `SELECT active_version FROM agent_definition_active
       WHERE definition_name=$1 AND principal=$2 AND policy_scope=$3`,
      [parsed.name, input.principal, input.policyScope],
    );
    if (Number(active.rows[0]?.active_version) === parsed.version) {
      throw new Error('active agent definition must be superseded before deprecation');
    }
    const event: DeprecationEventDetail = {
      eventId: input.eventId,
      commandId: input.commandId,
      actor: input.actor,
      principal: input.principal,
      policyScope: input.policyScope,
      ref: input.ref,
      name: parsed.name,
      version: parsed.version,
    };
    const appended = await appendEvent(client, {
      domain: 'agent-definition',
      kind: 'agent-definition-version-deprecated',
      actor: 'human',
      principal: input.principal,
      channel: 'meta',
      rel: `agent-definition:${input.ref}`,
      detail: event,
    });
    const deprecated: AgentDefinitionVersionRecord = {
      ...version,
      status: 'deprecated',
      deprecatedSeq: appended.seq,
      updatedSeq: appended.seq,
    };
    await upsertVersion(client, deprecated);
    return { version: deprecated, event, seq: appended.seq };
  });
}

async function upsertVersion(db: DbExecutor, version: AgentDefinitionVersionRecord): Promise<void> {
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

async function upsertActive(
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

export async function readAgentDefinitionPayload(
  db: DbExecutor,
  hash: ContentHash,
): Promise<unknown | undefined> {
  const result = await db.query<{ payload: unknown }>(
    'SELECT payload FROM agent_definition_payloads WHERE payload_hash=$1',
    [hash],
  );
  const payload = result.rows[0]?.payload;
  if (payload !== undefined && agentDefinitionPayloadSha256(payload) !== hash) {
    throw new Error('agent definition payload integrity failure');
  }
  return payload;
}

async function hydrateVersion(
  db: DbExecutor,
  version: AgentDefinitionVersionRecord,
): Promise<AgentDefinitionVersionView> {
  const [source, flattened, template, evaluation] = await Promise.all([
    readAgentDefinitionPayload(db, version.content.source),
    readAgentDefinitionPayload(db, version.content.flattened),
    readAgentDefinitionPayload(db, version.content.template),
    readAgentDefinitionPayload(db, version.content.evaluation),
  ]);
  if (
    source === undefined ||
    flattened === undefined ||
    template === undefined ||
    evaluation === undefined
  ) {
    throw new Error('agent definition version references a missing payload');
  }
  return {
    version,
    source: source as AgentDefinitionSource,
    flattened: flattened as FlattenedDefinitionPayload,
    template: template as PromptTemplate,
    evaluation: evaluation as JsonValue,
  };
}

export async function getAgentDefinitionVersion(
  db: DbExecutor,
  ref: AgentDefinitionRef,
  principal: string,
  policyScope: string,
): Promise<AgentDefinitionVersionView | undefined> {
  const parsed = parseAgentDefinitionRef(ref);
  const version = await getVersionRecord(db, parsed.name, parsed.version, principal, policyScope);
  return version === undefined ? undefined : hydrateVersion(db, version);
}

function systemSeedIdentity(version: AgentDefinitionVersionRecord): string {
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

function oneSystemSeed(
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

async function activeSystemSeedRows(
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
export async function getSystemSeedAgentDefinitionVersion(
  db: DbExecutor,
  ref: AgentDefinitionRef,
  policyScope: string,
): Promise<AgentDefinitionVersionView | undefined> {
  const version = oneSystemSeed(
    await activeSystemSeedRows(db, policyScope, ref),
    `${policyScope}/${ref}`,
  );
  return version === undefined ? undefined : hydrateVersion(db, version);
}

/** List repository-owned active seeds for one scope, rejecting duplicate-name content drift. */
export async function listSystemSeedAgentDefinitions(
  db: DbExecutor,
  policyScope: string,
): Promise<AgentDefinitionVersionView[]> {
  const grouped = new Map<string, AgentDefinitionVersionRecord[]>();
  for (const version of await activeSystemSeedRows(db, policyScope)) {
    const versions = grouped.get(version.name) ?? [];
    versions.push(version);
    grouped.set(version.name, versions);
  }
  const views: AgentDefinitionVersionView[] = [];
  for (const [name, versions] of [...grouped].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const version = oneSystemSeed(versions, `${policyScope}/${name}`)!;
    views.push(await hydrateVersion(db, version));
  }
  return views;
}

export async function getActiveAgentDefinition(
  db: DbExecutor,
  name: string,
  principal: string,
  policyScope: string,
): Promise<AgentDefinitionVersionView | undefined> {
  const result = await db.query<VersionRow>(
    `SELECT v.* FROM agent_definition_active a
       JOIN agent_definition_versions v
         ON v.principal=a.principal AND v.policy_scope=a.policy_scope
        AND v.definition_name=a.definition_name AND v.definition_version=a.active_version
     WHERE a.definition_name=$1 AND a.principal=$2 AND a.policy_scope=$3`,
    [name, principal, policyScope],
  );
  return result.rows[0] === undefined
    ? undefined
    : hydrateVersion(db, recordFromRow(result.rows[0]));
}

export async function listAgentDefinitionVersions(
  db: DbExecutor,
  input: { name: string; principal: string; policyScope: string; limit?: number },
): Promise<AgentDefinitionVersionRecord[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 100));
  const result = await db.query<VersionRow>(
    `SELECT * FROM agent_definition_versions
     WHERE definition_name=$1 AND principal=$2 AND policy_scope=$3
     ORDER BY definition_version DESC LIMIT $4`,
    [input.name, input.principal, input.policyScope, limit],
  );
  return result.rows.map(recordFromRow);
}

export async function readAgentDefinitionRegistry(
  db: DbExecutor,
  principal: string,
  policyScope: string,
): Promise<AgentDefinitionRegistrySnapshot> {
  const rows = await db.query<VersionRow>(
    `SELECT * FROM agent_definition_versions
     WHERE principal=$1 AND policy_scope=$2 ORDER BY definition_name, definition_version`,
    [principal, policyScope],
  );
  const definitions = new Map<
    AgentDefinitionRef,
    { status: 'draft' | 'active' | 'deprecated'; source: AgentDefinitionSource }
  >();
  for (const row of rows.rows) {
    const version = recordFromRow(row);
    const source = await readAgentDefinitionPayload(db, version.content.source);
    if (source === undefined) throw new Error(`agent definition ${version.ref} source is missing`);
    definitions.set(version.ref, {
      status: version.status === 'registered' ? 'draft' : version.status,
      source: parseAgentDefinitionSource(source),
    });
  }
  const activeRows = await db.query<{ definition_name: string; active_version: string | number }>(
    `SELECT definition_name,active_version FROM agent_definition_active
     WHERE principal=$1 AND policy_scope=$2 ORDER BY definition_name`,
    [principal, policyScope],
  );
  const activeByName = new Map<string, AgentDefinitionRef>(
    activeRows.rows.map((row) => [
      row.definition_name,
      `${row.definition_name}@${Number(row.active_version)}` as AgentDefinitionRef,
    ]),
  );
  return { definitions, activeByName };
}

async function loadEvents(db: DbExecutor): Promise<AgentDefinitionStoredEvent[]> {
  const result = await db.query<AgentDefinitionStoredEvent>(
    `SELECT seq,kind,detail FROM events
     WHERE domain='agent-definition' ORDER BY seq ASC`,
  );
  return result.rows;
}

/** Delete the cache and deterministically replay exact versions plus active pointers from events. */
export async function rebuildAgentDefinitionProjection(db: ConnectableDb): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(740941)');
    const events = await loadEvents(client);
    await client.query('DELETE FROM agent_definition_active');
    await client.query('DELETE FROM agent_definition_versions');
    const versions = new Map<string, AgentDefinitionVersionRecord>();
    const active = new Map<string, { version: AgentDefinitionVersionRecord; seq: number }>();
    for (const event of events) {
      if (event.kind === 'agent-definition-version-registered') {
        const stored: AgentDefinitionVersionRecord = {
          ...event.detail.version,
          registeredSeq: event.seq,
          updatedSeq: event.seq,
        };
        versions.set(versionKey(stored), stored);
        continue;
      }
      const detail = event.detail;
      const key = `${detail.principal}\u0000${detail.policyScope}\u0000${detail.name}\u0000${detail.version}`;
      const existing = versions.get(key);
      if (existing === undefined) throw new Error(`agent definition replay missing ${detail.ref}`);
      if (event.kind === 'agent-definition-version-activated') {
        const activated = {
          ...existing,
          status: 'active' as const,
          activatedSeq: event.seq,
          updatedSeq: event.seq,
        };
        versions.set(key, activated);
        active.set(activeKey(activated), { version: activated, seq: event.seq });
      } else {
        versions.set(key, {
          ...existing,
          status: 'deprecated',
          deprecatedSeq: event.seq,
          updatedSeq: event.seq,
        });
      }
    }
    for (const version of versions.values()) await upsertVersion(client, version);
    for (const pointer of active.values()) await upsertActive(client, pointer.version, pointer.seq);
  });
}

function versionKey(version: AgentDefinitionVersionRecord): string {
  return `${version.principal}\u0000${version.policyScope}\u0000${version.name}\u0000${version.version}`;
}

function activeKey(version: AgentDefinitionVersionRecord): string {
  return `${version.principal}\u0000${version.policyScope}\u0000${version.name}`;
}

export type { ConnectableDb };
