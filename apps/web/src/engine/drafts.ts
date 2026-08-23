import { createHash } from 'node:crypto';

import {
  contentVersion,
  fold,
  mechanicalFlowDiff,
  resolveSubmissionPolicy,
  validateDefinition,
  validateFlowDraft,
  type DefinitionCandidateAppliedDetail,
  type ExecRequest,
  type JudgeLayer,
  type SirenAction,
  type SirenEntity,
} from '@ui4a/engine';
import {
  DRAFT_LIMITS,
  seedGuardRegistry,
  type DraftAggregate,
  type DraftValidation,
} from '@ui4a/shared';

import {
  acceptDraftWithCoreEvent,
  appendDraftCommand,
  ensureDraftTables,
  getDraft,
  getDraftByOwner,
  listDrafts,
  payloadSha256,
  type ConnectableDb,
} from '../db/drafts';
import { appendEvent, readLog, type DbExecutor } from '../db/events';
import type { EngineRuntime } from './service';
import { codingExecutorProfileRegistryFromEnvironment } from './coding-executor-config';

const DRAFT_REL_PREFIX = 'draft:';
const DRAFT_ACTIVATION_PREFIX = 'meta/activation:draft-';
const FLOW_SCHEMA_REF = 'ui4a://flow-definition/v1';

export type DraftMetaOutcome =
  | { kind: 'accepted'; entity: SirenEntity }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

function schema(
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

function action(name: string, title: string, fields: Record<string, unknown>): SirenAction {
  return { name, title, method: 'POST', href: '/_meta/api/exec', fields };
}

const COMMAND_ID = { type: 'string', minLength: 1, description: 'Idempotency key' };

function draftActions(aggregate: DraftAggregate): SirenAction[] {
  if (['accepted', 'rejected', 'abandoned', 'expired'].includes(aggregate.status)) return [];
  if (aggregate.status === 'pending-approval') return [];
  const revise = action(
    'revise',
    'Revise Draft',
    schema(
      {
        commandId: COMMAND_ID,
        baseVersion: { type: 'integer', minimum: 1 },
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

function activationActions(): SirenAction[] {
  return [
    action('approve', 'Approve', schema({ commandId: COMMAND_ID }, ['commandId'])),
    action(
      'reject',
      'Reject',
      schema({ commandId: COMMAND_ID, reason: { type: 'string', minLength: 1 } }, [
        'commandId',
        'reason',
      ]),
    ),
  ];
}

function draftSummary(aggregate: DraftAggregate): SirenEntity {
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
    },
    actions: [],
    links: [],
  };
}

async function projectExactDraft(
  db: DbExecutor,
  engine: EngineRuntime,
  aggregate: DraftAggregate,
  payload: unknown,
): Promise<SirenEntity> {
  const snapshot = await engine.readSnapshot();
  const current =
    aggregate.target === undefined
      ? undefined
      : snapshot.definitionVersions?.[aggregate.target]?.[
          snapshot.definitions?.[aggregate.target]?.version ?? -1
        ];
  let diff: unknown;
  if (current !== undefined && aggregate.kind === 'flow-definition') {
    try {
      diff = mechanicalFlowDiff(current, payload);
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
      ...(diff === undefined ? {} : { diff }),
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
              href: `/_meta/api/entity?rel=${encodeURIComponent(`meta/flow:${aggregate.target}`)}`,
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
): Promise<SirenEntity | undefined> {
  await ensureDraftTables(db);
  if (rel === 'meta/drafts') {
    const drafts = await listDrafts(db, { owner: principal, policyScope });
    return {
      class: ['collection', 'meta/drafts'],
      properties: { rel, count: drafts.length, limit: 20, policyScope },
      actions: [
        action(
          'create',
          'Create Draft',
          schema(
            {
              kind: { type: 'string', enum: ['flow-definition'] },
              target: { type: 'string', minLength: 1 },
              policyScope: { type: 'string', minLength: 1 },
              commandId: COMMAND_ID,
              payload: {},
              schemaRef: { type: 'string', default: FLOW_SCHEMA_REF },
            },
            ['kind', 'target', 'policyScope', 'commandId', 'payload'],
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
      },
      actions: pending ? activationActions() : [],
      links: [
        { rel: ['self'], href: `/_meta/api/entity?rel=${encodeURIComponent(rel)}` },
        { rel: ['draft'], href: `/_meta/api/entity?rel=${encodeURIComponent(`draft:${draftId}`)}` },
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
  return projectExactDraft(db, engine, found.aggregate, found.payload);
}

function rejected(layer: JudgeLayer, reason: string, detail?: unknown): DraftMetaOutcome {
  return detail === undefined
    ? { kind: 'rejected', layer, reason }
    : { kind: 'rejected', layer, reason, detail };
}

function stringParam(request: ExecRequest, name: string): string | undefined {
  const value = request.params?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function registries(snapshot: ReturnType<EngineRuntime['getSnapshot']>) {
  return {
    guards: seedGuardRegistry,
    applications: new Set(Object.keys(snapshot.applications ?? {})),
    capabilities: new Set(Object.keys(snapshot.capabilities ?? {})),
    capabilityDefinitions: snapshot.capabilities ?? {},
    executorProfiles: codingExecutorProfileRegistryFromEnvironment(),
  };
}

function persistedValidation(validation: ReturnType<typeof validateFlowDraft>): DraftValidation {
  return {
    valid: validation.valid,
    issues: validation.issues,
    ...(validation.validatedAgainst === undefined
      ? {}
      : { validatedAgainst: validation.validatedAgainst }),
  };
}

async function rejectionEvent(db: DbExecutor, request: ExecRequest, outcome: DraftMetaOutcome) {
  if (outcome.kind !== 'rejected') return;
  await appendEvent(db, {
    kind: 'action-rejected',
    rel: request.rel,
    action: request.action,
    actor: request.actor,
    principal: request.principal,
    channel: request.channel,
    reason: outcome.reason,
    detail: { layer: outcome.layer, judge: outcome.detail, domain: 'draft' },
  });
}

async function projectForOwner(
  db: DbExecutor,
  engine: EngineRuntime,
  draftId: string,
  owner: string,
): Promise<SirenEntity> {
  const found = await getDraftByOwner(db, draftId, owner);
  if (found === undefined) throw new Error('draft disappeared after command');
  return projectExactDraft(db, engine, found.aggregate, found.payload);
}

/** Server adapter for declared Draft/activation Siren actions. */
export async function executeDraftMeta(
  db: ConnectableDb,
  engine: EngineRuntime,
  request: ExecRequest,
  context: { policyScope: string },
): Promise<DraftMetaOutcome> {
  if (request.actor === undefined || request.principal === undefined || request.principal === '') {
    return rejected('guard-failed', 'Draft operations require an explicit resolved actor context');
  }
  if (
    request.params?.mode !== undefined ||
    request.params?.actor !== undefined ||
    request.params?.principal !== undefined ||
    request.params?.noDraft !== undefined
  ) {
    const outcome = rejected(
      'guard-failed',
      'request cannot override SubmissionPolicy or identity',
    );
    await rejectionEvent(db, request, outcome);
    return outcome;
  }
  await ensureDraftTables(db);
  if (request.rel === 'meta/drafts') {
    if (request.action !== 'create')
      return rejected('undeclared', `action ${request.action} is not declared`);
    const kind = stringParam(request, 'kind');
    const target = stringParam(request, 'target');
    const policyScope = stringParam(request, 'policyScope');
    const commandId = stringParam(request, 'commandId');
    const payload = request.params?.payload;
    if (
      kind !== 'flow-definition' ||
      target === undefined ||
      policyScope === undefined ||
      commandId === undefined ||
      payload === undefined
    ) {
      return rejected('schema-invalid', 'kind/target/policyScope/commandId/payload are required');
    }
    if (policyScope !== context.policyScope) {
      return rejected('guard-failed', 'request policy scope does not match credential scope');
    }
    const snapshot = await engine.readSnapshot();
    const entry = snapshot.definitions?.[target];
    if (entry === undefined)
      return rejected('guard-failed', 'target flow is not authorized or does not exist');
    const activeDefinition =
      snapshot.definitionVersions?.[target]?.[entry.version] ?? entry.definition;
    if ((activeDefinition.app ?? 'default') !== context.policyScope) {
      return rejected('guard-failed', 'target flow is outside the credential policy scope');
    }
    const validation = validateFlowDraft(payload, registries(snapshot));
    const id = createHash('sha256')
      .update(`${request.principal}\0${policyScope}\0${commandId}`)
      .digest('hex')
      .slice(0, 20);
    await appendDraftCommand(
      db,
      {
        kind: 'create',
        eventId: `event:${commandId}`,
        commandId,
        draftId: id,
        owner: request.principal,
        policyScope,
        draftKind: 'flow-definition',
        target,
        baseVersion: String(entry.version),
        payloadHash: payloadSha256(payload),
        schemaRef: stringParam(request, 'schemaRef') ?? FLOW_SCHEMA_REF,
        provenance: {
          actor: request.actor,
          principal: request.principal,
          commandId,
          sources: [],
        },
        validation: persistedValidation(validation),
        expiresAt: new Date(Date.now() + DRAFT_LIMITS.retentionDays * 86_400_000).toISOString(),
      },
      payload,
    );
    return { kind: 'accepted', entity: await projectForOwner(db, engine, id, request.principal) };
  }

  const draftId = request.rel.startsWith(DRAFT_REL_PREFIX)
    ? request.rel.slice(DRAFT_REL_PREFIX.length)
    : request.rel.startsWith(DRAFT_ACTIVATION_PREFIX)
      ? request.rel.slice(DRAFT_ACTIVATION_PREFIX.length)
      : undefined;
  if (draftId === undefined) return rejected('undeclared', 'not a Draft resource');
  const found = await getDraftByOwner(db, draftId, request.principal);
  if (found === undefined)
    return rejected('undeclared', 'Draft is not authorized or does not exist');
  const { aggregate, payload } = found;
  if (aggregate.policyScope !== context.policyScope) {
    return rejected('undeclared', 'Draft is not authorized or does not exist');
  }
  const commandId = stringParam(request, 'commandId');

  if (request.rel.startsWith(DRAFT_ACTIVATION_PREFIX)) {
    if (request.action !== 'approve' && request.action !== 'reject') {
      return rejected('undeclared', `action ${request.action} is not declared`);
    }
    if (request.actor !== 'human') {
      const outcome = rejected('guard-failed', 'actor-is-human=false');
      await rejectionEvent(db, request, outcome);
      return outcome;
    }
    if (commandId === undefined) return rejected('schema-invalid', 'commandId is required');
    if (request.action === 'reject') {
      const reason = stringParam(request, 'reason');
      if (reason === undefined) return rejected('schema-invalid', 'reason is required');
      await appendDraftCommand(db, {
        kind: 'reject',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        activeVersion: aggregate.activeVersion,
        reason,
      });
      return {
        kind: 'accepted',
        entity: (await getDraftMetaEntity(
          db,
          engine,
          request.rel,
          request.principal,
          aggregate.policyScope,
        ))!,
      };
    }
    let accepted: Awaited<ReturnType<typeof acceptDraftWithCoreEvent>>;
    try {
      accepted = await engine.runExclusive(() =>
        acceptDraftWithCoreEvent(
          db,
          {
            kind: 'accept',
            eventId: `event:${commandId}`,
            commandId,
            draftId,
            activeVersion: aggregate.activeVersion,
          },
          async ({ client, aggregate: locked, payload: lockedPayload }) => {
            if (locked.kind !== 'flow-definition' || locked.target === undefined)
              throw new Error('unsupported Draft kind');
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
              `flow:${locked.target}`,
            ]);
            const core = fold(await readLog(client), { flows: {} });
            const entry = core.definitions?.[locked.target];
            if (entry === undefined || String(entry.version) !== locked.baseVersion)
              throw new Error('draft stale: target version changed');
            const validation = validateFlowDraft(lockedPayload, registries(core));
            if (!validation.valid || validation.value === undefined)
              throw new Error('draft is no longer valid');
            if ((validation.value.app ?? 'default') !== locked.policyScope) {
              throw new Error('draft target moved outside policy scope');
            }
            const checks = validateDefinition(validation.value, registries(core));
            const active =
              core.definitionVersions?.[locked.target]?.[entry.version] ?? entry.definition;
            const mechanical = mechanicalFlowDiff(active, validation.value);
            const detail: DefinitionCandidateAppliedDetail = {
              schemaVersion: 1,
              commandId,
              name: locked.target,
              baseVersion: entry.version,
              version: entry.version + 1,
              activationId: `draft-${draftId}`,
              draftId,
              draftVersion: locked.activeVersion,
              payloadHash: locked.versions[locked.activeVersion]!.payloadHash,
              policyScope: locked.policyScope,
              artifact: contentVersion(validation.value),
              definition: validation.value,
              checks,
              diff: mechanical.diff,
              requestedBy: {
                actor: locked.versions[locked.activeVersion]!.provenance.actor,
                principal: locked.owner,
              },
              decidedBy: { actor: 'human', principal: request.principal },
            };
            return {
              domain: 'core',
              kind: 'definition-candidate-applied',
              rel: `meta/flow:${locked.target}`,
              action: 'approve-draft',
              actor: 'human',
              principal: request.principal,
              channel: request.channel,
              detail,
            };
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/stale|version changed/.test(message)) {
        await appendDraftCommand(db, {
          kind: 'stale',
          eventId: `event:${commandId}:stale`,
          commandId: `${commandId}:stale`,
          draftId,
          activeVersion: aggregate.activeVersion,
          reason: message,
        });
      }
      throw error;
    }
    await engine.readSnapshot();
    return {
      kind: 'accepted',
      entity: await projectForOwner(db, engine, accepted.aggregate.id, request.principal),
    };
  }

  if (request.action === 'diff') {
    return { kind: 'accepted', entity: await projectExactDraft(db, engine, aggregate, payload) };
  }
  if (commandId === undefined) return rejected('schema-invalid', 'commandId is required');
  if (request.action === 'revise') {
    const baseVersion = request.params?.baseVersion;
    const nextPayload = request.params?.payload;
    if (!Number.isInteger(baseVersion) || nextPayload === undefined)
      return rejected('schema-invalid', 'baseVersion and payload are required');
    const snapshot = await engine.readSnapshot();
    const validation = validateFlowDraft(nextPayload, registries(snapshot));
    await appendDraftCommand(
      db,
      {
        kind: 'revise',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        baseVersion: baseVersion as number,
        ...(stringParam(request, 'targetBaseVersion') === undefined
          ? {}
          : { targetBaseVersion: stringParam(request, 'targetBaseVersion') }),
        payloadHash: payloadSha256(nextPayload),
        schemaRef: aggregate.versions[aggregate.activeVersion]!.schemaRef,
        provenance: { actor: request.actor, principal: request.principal, commandId, sources: [] },
        validation: persistedValidation(validation),
      },
      nextPayload,
    );
  } else if (request.action === 'validate') {
    const snapshot = await engine.readSnapshot();
    const current =
      aggregate.target === undefined ? undefined : snapshot.definitions?.[aggregate.target];
    if (current !== undefined && String(current.version) !== aggregate.baseVersion) {
      await appendDraftCommand(db, {
        kind: 'stale',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        activeVersion: aggregate.activeVersion,
        reason: `base ${aggregate.baseVersion}, current ${current.version}`,
      });
    } else {
      const validation = validateFlowDraft(payload, registries(snapshot));
      await appendDraftCommand(db, {
        kind: 'validate',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        activeVersion: aggregate.activeVersion,
        validation: persistedValidation(validation),
      });
    }
  } else if (request.action === 'submit') {
    if (aggregate.status !== 'ready')
      return rejected('guard-failed', 'only ready Draft can be submitted');
    await appendDraftCommand(db, {
      kind: 'submit',
      eventId: `event:${commandId}`,
      commandId,
      draftId,
      activeVersion: aggregate.activeVersion,
      activation: `${DRAFT_ACTIVATION_PREFIX}${draftId}`,
    });
  } else if (request.action === 'abandon') {
    await appendDraftCommand(db, {
      kind: 'abandon',
      eventId: `event:${commandId}`,
      commandId,
      draftId,
      activeVersion: aggregate.activeVersion,
      ...(stringParam(request, 'reason') === undefined
        ? {}
        : { reason: stringParam(request, 'reason') }),
    });
  } else {
    return rejected('undeclared', `action ${request.action} is not declared`);
  }
  return {
    kind: 'accepted',
    entity: await projectForOwner(db, engine, draftId, request.principal),
  };
}

export function isDraftMetaRel(rel: string): boolean {
  return (
    rel === 'meta/drafts' ||
    rel.startsWith(DRAFT_REL_PREFIX) ||
    rel.startsWith(DRAFT_ACTIVATION_PREFIX)
  );
}
