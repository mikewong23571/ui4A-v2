import type {
  AgentDefinitionActivationRegistries,
  AgentEvalEvidence,
  SirenEntity,
} from '@ui4a/engine';
import type { AgentDefinitionRef, JsonValue } from '@ui4a/shared';

import {
  getActiveAgentDefinition,
  getAgentDefinitionVersion,
  prepareAgentDefinitionActivation,
  readAgentDefinitionRegistry,
  type ConnectableDb,
} from '../db/agent-definitions';
import type { DbExecutor } from '../db/events';
import type {
  AgentDefinitionDraftRegistryPort,
  AgentDefinitionDraftRegistrySnapshot,
} from './drafts';

export const AGENT_DEFINITIONS_REL = 'meta/agent-definitions';
const AGENT_DEFINITION_PREFIX = 'meta/agent-definition:';

interface AgentRegistryConfiguration {
  activationRegistries: AgentDefinitionActivationRegistries;
  evalEvidencePayloads: ReadonlyMap<string, JsonValue>;
}

export interface AgentDefinitionCatalogEntry {
  name: string;
  ref: AgentDefinitionRef;
  intent: string;
  runtimeClass: string;
  requiredFeatures: string[];
  inputSchema: unknown;
  outputSchema: unknown;
  flattenedHash: string;
  promptHash: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringSet(value: unknown, where: string): ReadonlySet<string> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${where} must be a string array`);
  }
  return new Set(value as string[]);
}

/** Parse deployment-owned runtime/tool/verifier and Eval registries without Provider defaults. */
export function agentRegistryConfigurationFromEnvironment(): AgentRegistryConfiguration {
  const raw = process.env.UI4A_AGENT_REGISTRY;
  if (raw === undefined) {
    return {
      activationRegistries: {
        runtimeClasses: new Map(),
        tools: new Set(),
        resources: new Set(),
        contextSources: new Set(),
        verifiers: new Set(),
        evalEvidence: new Map(),
      },
      evalEvidencePayloads: new Map(),
    };
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!record(parsed) || !record(parsed.runtimeClasses) || !record(parsed.evalEvidence)) {
    throw new Error('UI4A_AGENT_REGISTRY must define runtimeClasses and evalEvidence objects');
  }
  const runtimeClasses = new Map<string, ReadonlySet<string>>(
    Object.entries(parsed.runtimeClasses).map(([name, features]) => [
      name,
      stringSet(features, `runtimeClasses.${name}`),
    ]),
  );
  const evalEvidence = new Map<string, AgentEvalEvidence>();
  const evalEvidencePayloads = new Map<string, JsonValue>();
  for (const [ref, unknownEntry] of Object.entries(parsed.evalEvidence)) {
    if (
      !record(unknownEntry) ||
      typeof unknownEntry.passed !== 'boolean' ||
      typeof unknownEntry.score !== 'number' ||
      typeof unknownEntry.artifactHash !== 'string' ||
      unknownEntry.payload === undefined
    ) {
      throw new Error(`evalEvidence.${ref} is invalid`);
    }
    evalEvidence.set(ref, {
      passed: unknownEntry.passed,
      score: unknownEntry.score,
      artifactHash: unknownEntry.artifactHash,
    });
    evalEvidencePayloads.set(ref, JSON.parse(JSON.stringify(unknownEntry.payload)) as JsonValue);
  }
  return {
    activationRegistries: {
      runtimeClasses,
      tools: stringSet(parsed.tools, 'tools'),
      resources: stringSet(parsed.resources, 'resources'),
      contextSources: stringSet(parsed.contextSources, 'contextSources'),
      verifiers: stringSet(parsed.verifiers, 'verifiers'),
      evalEvidence,
    },
    evalEvidencePayloads,
  };
}

async function draftSnapshot(
  db: DbExecutor,
  owner: string,
  policyScope: string,
): Promise<AgentDefinitionDraftRegistrySnapshot> {
  const registry = await readAgentDefinitionRegistry(db, owner, policyScope);
  const configuration = agentRegistryConfigurationFromEnvironment();
  return { ...registry, ...configuration };
}

/** Concrete T17 Draft port backed by the append-only Agent Definition registry. */
export const agentDefinitionDraftRegistryPort: AgentDefinitionDraftRegistryPort = {
  readSnapshot: ({ db, owner, policyScope }) => draftSnapshot(db, owner, policyScope),
  prepareAtomicActivation: async (input) => {
    const evalEvidence = JSON.parse(
      JSON.stringify({
        ...input.evalEvidence,
        checks: input.checks,
        diff: input.diff,
        requestedBy: input.requestedBy,
        decidedBy: input.decidedBy,
        draft: {
          id: input.draftId,
          version: input.draftVersion,
          payloadHash: input.payloadHash,
          schemaRef: input.schemaRef,
        },
      }),
    ) as JsonValue;
    const provenance = JSON.parse(
      JSON.stringify({
        draftId: input.draftId,
        draftVersion: input.draftVersion,
        requestedBy: input.requestedBy,
        decidedBy: input.decidedBy,
        diffHash: input.diff.hash,
      }),
    ) as JsonValue;
    return prepareAgentDefinitionActivation(input.client, {
      eventIdPrefix: `event:${input.commandId}:agent-definition`,
      commandId: input.commandId,
      actor: input.decidedBy.actor,
      principal: input.owner,
      policyScope: input.policyScope,
      ...(input.expectedBaseRef === undefined ? {} : { expectedActiveRef: input.expectedBaseRef }),
      source: input.source,
      artifact: input.artifact,
      evalEvidence,
      provenance,
    });
  },
};

/** List active specialization summaries for one authorized owner/scope. */
export async function getAgentDefinitionCatalog(
  db: DbExecutor,
  principal: string,
  policyScope: string,
): Promise<AgentDefinitionCatalogEntry[]> {
  const registry = await readAgentDefinitionRegistry(db, principal, policyScope);
  const entries: AgentDefinitionCatalogEntry[] = [];
  for (const [name, ref] of registry.activeByName) {
    const view = await getAgentDefinitionVersion(db, ref, principal, policyScope);
    if (view === undefined) throw new Error(`active Agent Definition ${ref} is missing`);
    entries.push({
      name,
      ref,
      intent: view.flattened.definition.intent,
      runtimeClass: view.flattened.definition.runtimeRequirements.class,
      requiredFeatures: [...view.flattened.definition.runtimeRequirements.features],
      inputSchema: view.flattened.definition.contracts.inputSchema,
      outputSchema: view.flattened.definition.contracts.outputSchema,
      flattenedHash: view.version.flattenedHash,
      promptHash: view.version.content.template,
    });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function definitionEntity(
  view: NonNullable<Awaited<ReturnType<typeof getAgentDefinitionVersion>>>,
): SirenEntity {
  return {
    class: ['meta', 'agent-definition', view.version.status],
    properties: {
      rel: `${AGENT_DEFINITION_PREFIX}${view.version.ref}`,
      ref: view.version.ref,
      name: view.version.name,
      version: view.version.version,
      status: view.version.status,
      intent: view.flattened.definition.intent,
      runtimeClass: view.flattened.definition.runtimeRequirements.class,
      requiredFeatures: view.flattened.definition.runtimeRequirements.features,
      contracts: view.flattened.definition.contracts,
      policies: view.flattened.definition.policies,
      evaluationPolicy: view.flattened.definition.evaluationPolicy,
      prompt: view.template,
      source: view.source,
      flattened: view.flattened,
      evaluation: view.evaluation,
      hashes: view.version.content,
    },
    actions: [],
    links: [
      {
        rel: ['self'],
        href: `/_meta/api/entity?rel=${encodeURIComponent(
          `${AGENT_DEFINITION_PREFIX}${view.version.ref}`,
        )}`,
      },
      {
        rel: ['collection'],
        href: `/_meta/api/entity?rel=${encodeURIComponent(AGENT_DEFINITIONS_REL)}`,
      },
      { rel: ['drafts'], href: '/_meta/api/entity?rel=meta%2Fdrafts' },
      { rel: ['runs'], href: '/api/entity?rel=agent-runs' },
    ],
    'guard-results': [],
  };
}

/** Project Agent Definition Meta collection, active name or exact name@version resources. */
export async function getAgentDefinitionMetaEntity(
  db: DbExecutor,
  rel: string,
  principal: string,
  policyScope: string,
): Promise<SirenEntity | undefined> {
  if (rel === AGENT_DEFINITIONS_REL) {
    const entries = await getAgentDefinitionCatalog(db, principal, policyScope);
    return {
      class: ['collection', AGENT_DEFINITIONS_REL],
      properties: { rel, count: entries.length, policyScope },
      actions: [],
      entities: entries.map((entry) => ({
        class: ['agent-definition-summary'],
        rel: ['item'],
        href: `/_meta/api/entity?rel=${encodeURIComponent(
          `${AGENT_DEFINITION_PREFIX}${entry.ref}`,
        )}`,
        properties: { ...entry },
        actions: [],
        links: [],
      })),
      links: [
        { rel: ['self'], href: '/_meta/api/entity?rel=meta%2Fagent-definitions' },
        { rel: ['drafts'], href: '/_meta/api/entity?rel=meta%2Fdrafts' },
      ],
      'guard-results': [],
    };
  }
  if (!rel.startsWith(AGENT_DEFINITION_PREFIX)) return undefined;
  const value = rel.slice(AGENT_DEFINITION_PREFIX.length);
  const view = value.includes('@')
    ? await getAgentDefinitionVersion(db, value as AgentDefinitionRef, principal, policyScope)
    : await getActiveAgentDefinition(db, value, principal, policyScope);
  return view === undefined ? undefined : definitionEntity(view);
}

export function isAgentDefinitionMetaRel(rel: string): boolean {
  return rel === AGENT_DEFINITIONS_REL || rel.startsWith(AGENT_DEFINITION_PREFIX);
}

export type AgentDefinitionDb = ConnectableDb;
