import { parseAgentDefinitionRef, parseAgentDefinitionSource } from '@ui4a/engine';
import type {
  AgentDefinitionRef,
  AgentDefinitionSource,
  FlattenedAgentDefinitionArtifact,
  JsonValue,
} from '@ui4a/shared';

import { appendEvent, type DbExecutor, type EventAppend } from '../events';

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
  DeprecationEventDetail,
} from './types';

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
