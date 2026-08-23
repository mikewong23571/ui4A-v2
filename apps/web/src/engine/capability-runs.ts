import {
  contentVersion,
  type CapabilityRun,
  type ExecRequest,
  type SirenEntity,
} from '@ui4a/engine';
import type { CapabilityDefinition, CodingExecutorProfile, CodingTask } from '@ui4a/shared';

import {
  appendCapabilityRunCommand,
  findCapabilityRunsBySource,
  getCapabilityRun,
  listCapabilityNormalizedEvents,
  listCapabilityRawReceipts,
  listCapabilityRuns,
  type ConnectableDb,
} from '../db/capability-runs';
import type { DbExecutor } from '../db/events';
import { cancelCodingCapability, dispatchCodingCapability } from '../temporal/capability';

export const CAPABILITY_RUNS_REL = 'capability-runs';
const CAPABILITY_RUN_PREFIX = 'capability-run:';

function profileFromEnvironment(name: string): CodingExecutorProfile {
  const raw = process.env.UI4A_CODING_EXECUTOR_PROFILES;
  if (raw === undefined) throw new Error('UI4A_CODING_EXECUTOR_PROFILES is not configured');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('coding executor profiles must be an array');
  const profile = (parsed as CodingExecutorProfile[]).find((candidate) => candidate.name === name);
  if (profile === undefined) throw new Error(`coding executor profile ${name} is missing`);
  return profile;
}

export function preflightCapabilityExecutor(
  capability: CapabilityDefinition,
): CodingExecutorProfile | undefined {
  const requirement = capability.executor;
  if (requirement === undefined) return undefined;
  const profile = profileFromEnvironment(requirement.profile);
  if (profile.executorClass !== requirement.class)
    throw new Error('executor profile class mismatch');
  if (profile.providerId !== 'codex')
    throw new Error(`coding executor provider ${profile.providerId} is unavailable`);
  return profile;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a string array`);
  }
  return [...value] as string[];
}

function taskFromParams(
  params: Record<string, unknown>,
  profile: CodingExecutorProfile,
): CodingTask {
  for (const key of ['provider', 'binary', 'model', 'sandbox', 'yolo', 'profile', 'cwd']) {
    if (params[key] !== undefined) throw new Error(`request override ${key} is forbidden`);
  }
  if (
    typeof params.repositoryRef !== 'string' ||
    typeof params.baseRevision !== 'string' ||
    typeof params.goal !== 'string' ||
    params.goal === ''
  ) {
    throw new Error('repositoryRef/baseRevision/goal are required');
  }
  return {
    schemaVersion: 1,
    repositoryRef: params.repositoryRef,
    baseRevision: params.baseRevision,
    goal: params.goal,
    constraints: stringArray(params.constraints, 'constraints'),
    acceptanceCriteria: stringArray(params.acceptanceCriteria, 'acceptanceCriteria'),
    allowedPaths: stringArray(params.allowedPaths, 'allowedPaths'),
    budget: {
      timeoutSeconds: profile.timeoutSeconds,
      maxTurns: profile.maxTurns ?? 24,
      maxRawEvents: 2_000,
      maxRawBytes: 4 * 1024 * 1024,
      maxRawChunkBytes: 64 * 1024,
    },
    redaction: {
      secretNames: ['API_KEY', 'TOKEN', 'PASSWORD', 'AUTHORIZATION', 'COOKIE'],
      redactHostPaths: true,
    },
  };
}

export async function createAndDispatchCapabilityRun(
  db: ConnectableDb,
  input: {
    sourceSeq: number;
    sourceRel: string;
    sourceAction: string;
    principal: string;
    policyScope: string;
    params: Record<string, unknown>;
    capability: CapabilityDefinition;
    onDoneAction?: string;
    onErrorAction?: string;
    baseUrl: string;
  },
): Promise<CapabilityRun> {
  const requirement = input.capability.executor;
  if (requirement === undefined || requirement.class !== 'coding-agent') {
    throw new Error(`capability ${input.capability.name} has no coding executor requirement`);
  }
  const profile = preflightCapabilityExecutor(input.capability)!;
  const task = taskFromParams(input.params, profile);
  const runId = `r${input.sourceSeq.toString(36)}-${contentVersion({
    source: input.sourceRel,
    capability: input.capability.name,
  })}`;
  const created = await appendCapabilityRunCommand(db, {
    kind: 'create',
    runId,
    commandId: `create:${runId}`,
    eventId: `event:create:${runId}`,
    principal: input.principal,
    policyScope: input.policyScope,
    profileName: profile.name,
    task,
    source: {
      rel: input.sourceRel,
      action: input.sourceAction,
      eventId: `core:${input.sourceSeq}`,
      ...(input.onDoneAction === undefined ? {} : { onDoneAction: input.onDoneAction }),
      ...(input.onErrorAction === undefined ? {} : { onErrorAction: input.onErrorAction }),
    },
  });
  try {
    await dispatchCodingCapability({
      runId,
      principal: input.principal,
      policyScope: input.policyScope,
      profileName: profile.name,
      task,
      baseUrl: input.baseUrl,
    });
    return created.aggregate;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return (
      await appendCapabilityRunCommand(db, {
        kind: 'fail',
        runId,
        expectedRevision: created.aggregate.revision,
        commandId: `dispatch-failed:${runId}`,
        eventId: `event:dispatch-failed:${runId}`,
        code: 'dispatch-failed',
        reason,
      })
    ).aggregate;
  }
}

function runEntity(
  run: CapabilityRun,
  details?: { normalized: unknown[]; raw: unknown[] },
): SirenEntity {
  const cancellable = ['queued', 'preparing', 'running', 'waiting-approval'].includes(run.status);
  return {
    class: ['capability-run', run.status],
    properties: {
      rel: `capability-run:${run.runId}`,
      id: run.runId,
      status: run.status,
      capability: 'coding.execute',
      profile: run.profileName,
      source: run.source,
      repositoryRef: run.task.repositoryRef,
      baseRevision: run.task.baseRevision,
      goal: run.task.goal,
      budget: run.task.budget,
      workspace: run.workspace,
      cursor: run.cursor,
      restartCount: run.restartCount,
      result: run.result,
      failure: run.failure,
      ...(details === undefined ? {} : details),
    },
    actions: cancellable
      ? [
          {
            name: 'cancel',
            title: '取消执行',
            method: 'POST',
            href: '/api/exec',
            fields: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        ]
      : [],
    links: [
      { rel: ['self'], href: `/api/entity?rel=capability-run:${run.runId}` },
      { rel: ['collection'], href: `/api/entity?rel=${CAPABILITY_RUNS_REL}` },
      { rel: ['source'], href: `/api/entity?rel=${encodeURIComponent(run.source.rel)}` },
    ],
    'guard-results': [],
  };
}

export async function getCapabilityRunEntity(
  db: DbExecutor,
  rel: string,
  principal: string,
  policyScope: string,
): Promise<SirenEntity | undefined> {
  if (rel === CAPABILITY_RUNS_REL) {
    const runs = await listCapabilityRuns(db, { principal, policyScope });
    return {
      class: ['collection', CAPABILITY_RUNS_REL],
      properties: { rel, count: runs.length, limit: 20 },
      actions: [],
      links: [{ rel: ['self'], href: `/api/entity?rel=${CAPABILITY_RUNS_REL}` }],
      entities: runs.map((run) => ({
        ...runEntity(run),
        rel: ['item'],
        href: `/api/entity?rel=capability-run:${run.runId}`,
      })),
      'guard-results': [],
    };
  }
  if (!rel.startsWith(CAPABILITY_RUN_PREFIX)) return undefined;
  const run = await getCapabilityRun(
    db,
    rel.slice(CAPABILITY_RUN_PREFIX.length),
    principal,
    policyScope,
  );
  if (run === undefined) return undefined;
  const [normalized, raw] = await Promise.all([
    listCapabilityNormalizedEvents(db, run.runId),
    listCapabilityRawReceipts(db, run.runId),
  ]);
  return runEntity(run, { normalized, raw });
}

export async function enrichEntityWithCapabilityRuns(
  db: DbExecutor,
  entity: SirenEntity,
  principal: string,
  policyScope: string,
): Promise<SirenEntity> {
  const rel = entity.properties.rel;
  if (typeof rel !== 'string') return entity;
  const runs = await findCapabilityRunsBySource(db, rel, principal, policyScope);
  if (runs.length === 0) return entity;
  return {
    ...entity,
    links: [
      ...entity.links,
      ...runs.map((run) => ({
        rel: ['capability-run'],
        href: `/api/entity?rel=capability-run:${run.runId}`,
      })),
    ],
  };
}

export async function executeCapabilityRunAction(
  db: DbExecutor,
  request: ExecRequest,
  policyScope: string,
): Promise<{ kind: 'accepted'; entity: SirenEntity } | { kind: 'rejected'; reason: string }> {
  if (!request.rel.startsWith(CAPABILITY_RUN_PREFIX) || request.action !== 'cancel') {
    return { kind: 'rejected', reason: 'capability run action is not declared' };
  }
  const principal = request.principal;
  if (principal === undefined) return { kind: 'rejected', reason: 'principal is required' };
  const runId = request.rel.slice(CAPABILITY_RUN_PREFIX.length);
  const run = await getCapabilityRun(db, runId, principal, policyScope);
  if (run === undefined) return { kind: 'rejected', reason: 'capability run not found' };
  await cancelCodingCapability(runId);
  return { kind: 'accepted', entity: runEntity(run) };
}

export function isCapabilityRunRel(rel: string): boolean {
  return rel === CAPABILITY_RUNS_REL || rel.startsWith(CAPABILITY_RUN_PREFIX);
}
