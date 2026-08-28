import { parseAgentDefinitionRef, parseAgentDefinitionSource } from '@ui4a/engine';
import type {
  AgentDefinitionSource,
  FlattenedAgentDefinitionArtifact,
  JsonValue,
} from '@ui4a/shared';

import { appendEvent } from '../events';

import {
  assertIdempotentIdentity,
  findCommand,
  flattenedPayload,
  getVersionRecord,
  storePayload,
  upsertActive,
  upsertVersion,
  withTransaction,
  agentDefinitionPayloadSha256,
} from './store';
import type {
  AgentDefinitionVersionRecord,
  ConnectableDb,
  ActivationEventDetail,
  AgentDefinitionContentRefs,
  RegistrationEventDetail,
} from './types';

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
