import { parseAgentDefinitionRef, parseAgentDefinitionSource } from '@ui4a/engine';
import type {
  AgentDefinitionRef,
  AgentDefinitionSource,
  ContentHash,
  JsonValue,
  PromptTemplate,
} from '@ui4a/shared';

import type { DbExecutor } from '../events';

import {
  activeSystemSeedRows,
  getVersionRecord,
  oneSystemSeed,
  recordFromRow,
  upsertActive,
  upsertVersion,
  withTransaction,
  agentDefinitionPayloadSha256,
  type VersionRow,
} from './store';
import type {
  AgentDefinitionRegistrySnapshot,
  AgentDefinitionVersionRecord,
  AgentDefinitionVersionView,
  ConnectableDb,
  FlattenedDefinitionPayload,
  AgentDefinitionStoredEvent,
} from './types';

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

export async function hydrateVersion(
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
