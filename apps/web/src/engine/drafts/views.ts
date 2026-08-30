import {
  mechanicalAgentDefinitionDiff,
  mechanicalFlowDiff,
  metaExactPresentation,
  metaMemberPresentation,
  metaTopLevelPresentation,
  resolveRegisteredAgentDefinition,
  resolveSubmissionPolicy,
  validateAgentDefinitionDraft,
  type AgentDefinitionActivationCheck,
  type AgentDefinitionActivationRegistries,
  type AgentDefinitionSourceRegistry,
  type JudgeLayer,
  type MechanicalAgentDefinitionDiff,
  type SirenAction,
  type SirenEntity,
} from '@ui4a/engine';
import {
  type AgentDefinitionRef,
  type AgentDefinitionSource,
  type DraftAggregate,
  type FlattenedAgentDefinitionArtifact,
  type JsonValue,
} from '@ui4a/shared';

import { getDraft, listDrafts, type AtomicCoreMutationPlan } from '@ui4a/db/drafts';
import type { DbExecutor } from '@ui4a/db/events';
import type { EngineRuntime } from '../service';

export const DRAFT_REL_PREFIX = 'draft:';
export const DRAFT_ACTIVATION_PREFIX = 'meta/activation:draft-';
export const FLOW_SCHEMA_REF = 'ui4a://flow-definition/v1';
export const AGENT_DEFINITION_SCHEMA_REF = 'ui4a://agent-definition/v1';

export interface AgentDefinitionDraftRegistrySnapshot {
  definitions: AgentDefinitionSourceRegistry;
  activeByName: ReadonlyMap<string, AgentDefinitionRef>;
  activationRegistries: AgentDefinitionActivationRegistries;
  evalEvidencePayloads: ReadonlyMap<string, JsonValue>;
}

export interface AgentDefinitionDraftEvalEvidence {
  [key: string]: JsonValue;
  refs: string[];
  payloads: Record<string, JsonValue>;
}

export interface AgentDefinitionDraftActivationInput {
  client: DbExecutor;
  commandId: string;
  draftId: string;
  draftVersion: number;
  owner: string;
  policyScope: string;
  expectedBaseRef?: AgentDefinitionRef;
  payloadHash: string;
  schemaRef: string;
  source: AgentDefinitionSource;
  artifact: FlattenedAgentDefinitionArtifact;
  evalEvidence: AgentDefinitionDraftEvalEvidence;
  checks: AgentDefinitionActivationCheck[];
  diff: MechanicalAgentDefinitionDiff;
  requestedBy: { actor: 'human' | 'agent'; principal: string };
  decidedBy: { actor: 'human'; principal: string };
}

/** Narrow adapter boundary: persistence owns registry locks/CAS and returns its append-only event. */
export interface AgentDefinitionDraftRegistryPort {
  readSnapshot(input: {
    db: DbExecutor;
    owner: string;
    policyScope: string;
  }): Promise<AgentDefinitionDraftRegistrySnapshot>;
  prepareAtomicActivation(
    input: AgentDefinitionDraftActivationInput,
  ): Promise<AtomicCoreMutationPlan>;
}

export type DraftMetaOutcome =
  | { kind: 'accepted'; entity: SirenEntity }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

export function schema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

export function action(
  name: string,
  title: string,
  fields: Record<string, unknown>,
  risk?: SirenAction['requires-confirmation'],
): SirenAction {
  return {
    name,
    title,
    method: 'POST',
    href: '/_meta/api/exec',
    fields,
    ...(risk === undefined ? {} : { 'requires-confirmation': risk }),
  };
}

export const COMMAND_ID = {
  type: 'string',
  minLength: 1,
  description: 'Idempotency key',
  'x-ui4a-input-owner': 'client',
};

export function draftActions(aggregate: DraftAggregate): SirenAction[] {
  if (['accepted', 'rejected', 'abandoned', 'expired'].includes(aggregate.status)) return [];
  if (aggregate.status === 'pending-approval') return [];
  const revise = action(
    'revise',
    'Revise Draft',
    schema(
      {
        commandId: COMMAND_ID,
        baseVersion: {
          type: 'integer',
          minimum: 1,
          'x-ui4a-input-owner': 'client',
        },
        targetBaseVersion: { type: 'string' },
        payload: {},
      },
      ['commandId', 'baseVersion', 'payload'],
    ),
  );
  const validate = action(
    'validate',
    'Validate Draft',
    schema({ commandId: COMMAND_ID }, ['commandId']),
  );
  const abandon = action(
    'abandon',
    'Abandon Draft',
    schema({ commandId: COMMAND_ID, reason: { type: 'string' } }, ['commandId']),
  );
  if (aggregate.status === 'ready') {
    return [
      revise,
      validate,
      action('diff', 'Read Mechanical Diff', schema({})),
      action('submit', 'Submit for Approval', schema({ commandId: COMMAND_ID }, ['commandId'])),
      abandon,
    ];
  }
  return [revise, validate, action('diff', 'Read Mechanical Diff', schema({})), abandon];
}

export function activationActions(): SirenAction[] {
  return [
    action('approve', 'Approve', schema({ commandId: COMMAND_ID }, ['commandId']), 'high'),
    action(
      'reject',
      'Reject',
      schema({ commandId: COMMAND_ID, reason: { type: 'string', minLength: 1 } }, [
        'commandId',
        'reason',
      ]),
      'high',
    ),
  ];
}

export function draftSummary(aggregate: DraftAggregate): SirenEntity {
  return {
    class: ['meta', 'draft', aggregate.kind, aggregate.status],
    rel: ['item'],
    href: `/_meta/api/entity?rel=${encodeURIComponent(`${DRAFT_REL_PREFIX}${aggregate.id}`)}`,
    properties: {
      rel: `${DRAFT_REL_PREFIX}${aggregate.id}`,
      id: aggregate.id,
      kind: aggregate.kind,
      target: aggregate.target,
      status: aggregate.status,
      version: aggregate.activeVersion,
      baseVersion: aggregate.baseVersion,
      owner: aggregate.owner,
      policyScope: aggregate.policyScope,
      expiresAt: aggregate.expiresAt,
      presentation: metaMemberPresentation('draft'),
    },
    actions: [],
    links: [],
  };
}

export async function projectExactDraft(
  db: DbExecutor,
  engine: EngineRuntime,
  aggregate: DraftAggregate,
  payload: unknown,
  agentDefinitions?: AgentDefinitionDraftRegistryPort,
): Promise<SirenEntity> {
  const snapshot = await engine.readSnapshot();
  const current =
    aggregate.target === undefined
      ? undefined
      : snapshot.definitionVersions?.[aggregate.target]?.[
          snapshot.definitions?.[aggregate.target]?.version ?? -1
        ];
  let diff: unknown;
  let checks: AgentDefinitionActivationCheck[] | undefined;
  let evaluation:
    { refs: string[]; payloads: Record<string, JsonValue>; missing: string[] } | undefined;
  if (current !== undefined && aggregate.kind === 'flow-definition') {
    try {
      diff = mechanicalFlowDiff(current, payload);
    } catch {
      diff = undefined;
    }
  }
  if (aggregate.kind === 'agent-definition' && agentDefinitions !== undefined) {
    try {
      const registry = await agentDefinitions.readSnapshot({
        db,
        owner: aggregate.owner,
        policyScope: aggregate.policyScope,
      });
      const validation = validateAgentCandidate(payload, aggregate.target, registry);
      checks = validation.checks;
      const evalRefs = validation.artifact?.definition.evaluationPolicy.evalSuiteRefs ?? [];
      const evalPayloads: Record<string, JsonValue> = {};
      const missing: string[] = [];
      for (const ref of evalRefs) {
        const evidence = registry.evalEvidencePayloads.get(ref);
        if (evidence === undefined) missing.push(ref);
        else evalPayloads[ref] = evidence;
      }
      evaluation = { refs: [...evalRefs], payloads: evalPayloads, missing };
      if (validation.valid && validation.value !== undefined && validation.artifact !== undefined) {
        const beforeRef =
          aggregate.target === undefined ? undefined : registry.activeByName.get(aggregate.target);
        const beforeEntry =
          beforeRef === undefined ? undefined : registry.definitions.get(beforeRef);
        const beforeArtifact =
          beforeRef === undefined
            ? undefined
            : resolveRegisteredAgentDefinition(beforeRef, registry.definitions);
        diff = mechanicalAgentDefinitionDiff({
          ...(beforeEntry === undefined ? {} : { beforeSource: beforeEntry.source }),
          afterSource: validation.value,
          ...(beforeArtifact === undefined ? {} : { beforeEffective: beforeArtifact.definition }),
          afterEffective: validation.artifact.definition,
        });
      }
    } catch {
      diff = undefined;
    }
  }
  const version = aggregate.versions[aggregate.activeVersion]!;
  return {
    class: ['meta', 'draft', aggregate.kind, aggregate.status],
    properties: {
      rel: `${DRAFT_REL_PREFIX}${aggregate.id}`,
      id: aggregate.id,
      owner: aggregate.owner,
      policyScope: aggregate.policyScope,
      kind: aggregate.kind,
      target: aggregate.target,
      baseVersion: aggregate.baseVersion,
      status: aggregate.status,
      version: aggregate.activeVersion,
      maxVersion: aggregate.maxVersion,
      payloadHash: version.payloadHash,
      schemaRef: version.schemaRef,
      payload,
      validation: version.validation,
      provenance: version.provenance,
      activation: aggregate.activation,
      terminalReason: aggregate.terminalReason,
      expiresAt: aggregate.expiresAt,
      ...(diff === undefined ? {} : { diff }),
      ...(checks === undefined ? {} : { checks }),
      ...(evaluation === undefined ? {} : { evaluation }),
      submissionPolicy: resolveSubmissionPolicy({
        actor: 'agent',
        writable: true,
        resource: { mode: 'draft', scopes: [aggregate.policyScope] },
        scope: aggregate.policyScope,
      }),
    },
    actions: draftActions(aggregate),
    links: [
      {
        rel: ['self'],
        href: `/_meta/api/entity?rel=${encodeURIComponent(`draft:${aggregate.id}`)}`,
      },
      ...(aggregate.target === undefined
        ? []
        : [
            {
              rel: ['target'],
              href: `/_meta/api/entity?rel=${encodeURIComponent(
                aggregate.kind === 'agent-definition'
                  ? `meta/agent-definition:${aggregate.target}`
                  : `meta/flow:${aggregate.target}`,
              )}`,
            },
          ]),
      ...(aggregate.activation === undefined
        ? []
        : [
            {
              rel: ['activation'],
              href: `/_meta/api/entity?rel=${encodeURIComponent(aggregate.activation)}`,
            },
          ]),
      ...version.provenance.sources.map((source) => ({
        rel: ['source'],
        href:
          source.startsWith('meta/') || source.startsWith('draft:')
            ? `/_meta/api/entity?rel=${encodeURIComponent(source)}`
            : `/api/entity?rel=${encodeURIComponent(source)}`,
      })),
    ],
    'guard-results': [],
  };
}

export async function getDraftMetaEntity(
  db: DbExecutor,
  engine: EngineRuntime,
  rel: string,
  principal: string,
  policyScope: string,
  agentDefinitions?: AgentDefinitionDraftRegistryPort,
): Promise<SirenEntity | undefined> {
  if (rel === 'meta/drafts') {
    const drafts = await listDrafts(db, { owner: principal, policyScope });
    return {
      class: ['collection', 'meta/drafts'],
      properties: {
        rel,
        count: drafts.length,
        limit: 20,
        policyScope,
        presentation: metaTopLevelPresentation('meta/drafts'),
      },
      actions: [
        action(
          'create',
          'Create Draft',
          schema(
            {
              kind: { type: 'string', enum: ['flow-definition', 'agent-definition'] },
              target: { type: 'string', minLength: 1 },
              commandId: COMMAND_ID,
              payload: {},
              sources: { type: 'array', items: { type: 'string' }, maxItems: 64 },
            },
            ['kind', 'target', 'commandId', 'payload'],
          ),
        ),
      ],
      links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta%2Fdrafts' }],
      entities: drafts.map(draftSummary),
      'guard-results': [],
    };
  }
  const draftId = rel.startsWith(DRAFT_REL_PREFIX)
    ? rel.slice(DRAFT_REL_PREFIX.length)
    : rel.startsWith(DRAFT_ACTIVATION_PREFIX)
      ? rel.slice(DRAFT_ACTIVATION_PREFIX.length)
      : undefined;
  if (draftId === undefined) return undefined;
  const found = await getDraft(db, draftId, principal, policyScope);
  if (found === undefined) return undefined;
  if (rel.startsWith(DRAFT_ACTIVATION_PREFIX)) {
    if (found.aggregate.activation !== rel) return undefined;
    const pending = found.aggregate.status === 'pending-approval';
    return {
      class: ['meta', 'activation', found.aggregate.status],
      properties: {
        rel,
        id: `draft-${draftId}`,
        status: found.aggregate.status,
        draft: `draft:${draftId}`,
        target: found.aggregate.target,
        version: found.aggregate.activeVersion,
        validation: found.aggregate.versions[found.aggregate.activeVersion]!.validation,
        presentation: metaExactPresentation('activation'),
      },
      actions: pending ? activationActions() : [],
      links: [
        { rel: ['self'], href: `/_meta/api/entity?rel=${encodeURIComponent(rel)}` },
        {
          rel: ['draft'],
          href: `/_meta/api/entity?rel=${encodeURIComponent(`draft:${draftId}`)}`,
          title: `Draft ${draftId}`,
        },
      ],
      'guard-results': pending
        ? activationActions().map((candidate) => ({
            action: candidate.name,
            blocked: true,
            reason: 'actor-is-human is evaluated from authenticated request context',
            guards: [{ name: 'actor-is-human', pass: false }],
          }))
        : [],
    };
  }
  return projectExactDraft(db, engine, found.aggregate, found.payload, agentDefinitions);
}

/** Project a grant-union read without turning any granted application into an attention lens. */
export async function getDraftMetaEntityForScopes(
  db: DbExecutor,
  engine: EngineRuntime,
  rel: string,
  principal: string,
  policyScopes: readonly string[],
  agentDefinitions?: AgentDefinitionDraftRegistryPort,
): Promise<SirenEntity | undefined> {
  const entities = await Promise.all(
    [...new Set(policyScopes)].map((policyScope) =>
      getDraftMetaEntity(db, engine, rel, principal, policyScope, agentDefinitions),
    ),
  );
  const visible = entities.filter((entity): entity is SirenEntity => entity !== undefined);
  if (rel !== 'meta/drafts') return visible[0];
  const base = visible[0];
  if (base === undefined) return undefined;
  const members = new Map<string, SirenEntity>();
  for (const entity of visible) {
    for (const member of entity.entities ?? []) {
      const key = member.href ?? String(member.properties.rel ?? members.size);
      if (!members.has(key)) members.set(key, member);
    }
  }
  return {
    ...base,
    properties: {
      rel,
      count: members.size,
      limit: Number(base.properties.limit ?? 20),
      presentation: metaTopLevelPresentation('meta/drafts'),
    },
    entities: [...members.values()],
  };
}

export function validateAgentCandidate(
  payload: unknown,
  target: string | undefined,
  registry: AgentDefinitionDraftRegistrySnapshot,
): ReturnType<typeof validateAgentDefinitionDraft> {
  const validation = validateAgentDefinitionDraft(payload, {
    definitions: registry.definitions,
    activationRegistries: registry.activationRegistries,
  });
  if (validation.value === undefined) return validation;
  const issues = [...validation.issues];
  if (target === undefined || validation.value.name !== target) {
    issues.push({
      code: 'target-name-mismatch',
      path: '/name',
      message: `candidate name ${validation.value.name} does not match target ${target ?? '(missing)'}`,
    });
  }
  const activeRef = target === undefined ? undefined : registry.activeByName.get(target);
  const activeVersion =
    activeRef === undefined ? 0 : Number(activeRef.slice(activeRef.lastIndexOf('@') + 1));
  if (validation.value.version !== activeVersion + 1) {
    issues.push({
      code: 'version-not-next',
      path: '/version',
      message: `candidate version ${validation.value.version} is not next after ${activeVersion}`,
    });
  }
  return { ...validation, valid: validation.valid && issues.length === 0, issues };
}
