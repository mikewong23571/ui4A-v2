import type {
  AgentRun,
  AgentRunCommand,
  AgentRunJson,
  ExecRequest,
  SirenEntity,
} from '@ui4a/engine';

import {
  appendAgentRunCommand,
  findAgentRunsBySource,
  getAgentRun,
  getAgentRunResultRef,
  listAgentRunRawReceipts,
  listAgentRuns,
  type ConnectableDb,
} from '../db/agent-runs';

export const AGENT_RUNS_REL = 'agent-runs';
const AGENT_RUN_PREFIX = 'agent-run:';

const CANCELLABLE = new Set(['queued', 'preparing', 'running', 'needs-input', 'waiting-approval']);

function action(
  name: string,
  title: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) {
  return {
    name,
    title,
    method: 'POST' as const,
    href: '/api/exec',
    fields: { type: 'object', properties, required, additionalProperties: false },
  };
}

function pendingQuestion(run: AgentRun) {
  return run.questions.find((question) => question.answer === undefined);
}

function pendingGrant(run: AgentRun) {
  return run.resourceGrantRequests.find((request) => request.decision === undefined);
}

function actionsFor(run: AgentRun) {
  if (run.birth.kind === 'legacy-t18-reconstructed') return [];
  const actions = [];
  const question = pendingQuestion(run);
  if (run.status === 'needs-input' && question !== undefined) {
    actions.push(
      action(
        'answer-question',
        '回答问题',
        {
          questionId: { type: 'string', enum: [question.questionId] },
          answer: {},
        },
        ['questionId', 'answer'],
      ),
    );
  }
  const grant = pendingGrant(run);
  if (run.status === 'waiting-approval' && grant !== undefined) {
    const requestId = { type: 'string', enum: [grant.requestId] };
    actions.push(
      action('approve-resource-grant', '批准资源授权', { requestId }, ['requestId']),
      action('deny-resource-grant', '拒绝资源授权', { requestId, reason: { type: 'string' } }, [
        'requestId',
      ]),
    );
  }
  if (CANCELLABLE.has(run.status)) actions.push(action('cancel', '取消执行'));
  return actions;
}

function runSummary(run: AgentRun): SirenEntity {
  return {
    class: ['agent-run-summary', run.status],
    properties: {
      rel: `${AGENT_RUN_PREFIX}${run.runId}`,
      id: run.runId,
      status: run.status,
      definitionRef: run.birth.definition.ref,
      definitionVersion: run.birth.definition.version,
      source: run.source,
      revision: run.revision,
    },
    actions: [],
    links: [
      { rel: ['self'], href: `/api/entity?rel=${AGENT_RUN_PREFIX}${run.runId}` },
      { rel: ['source'], href: `/api/entity?rel=${encodeURIComponent(run.source.rel)}` },
      {
        rel: ['agent-definition'],
        href: `/_meta/api/entity?rel=${encodeURIComponent(
          `meta/agent-definition:${run.birth.definition.ref}`,
        )}`,
      },
    ],
    'guard-results': [],
  };
}

function runEntity(
  run: AgentRun,
  details: { raw: Record<string, unknown>[]; resultRef?: string },
): SirenEntity {
  return {
    class: ['agent-run', run.status, run.birth.kind],
    properties: {
      rel: `${AGENT_RUN_PREFIX}${run.runId}`,
      id: run.runId,
      status: run.status,
      revision: run.revision,
      source: run.source,
      birth: run.birth,
      task: run.task,
      cursor: run.cursor,
      observedSequence: run.observedSequence,
      restartCount: run.restartCount,
      questions: run.questions,
      resourceGrantRequests: run.resourceGrantRequests,
      result: run.result,
      resultRef: details.resultRef,
      failure: run.failure,
      terminalReason: run.terminalReason,
      raw: details.raw,
    },
    actions: actionsFor(run),
    links: [
      { rel: ['self'], href: `/api/entity?rel=${AGENT_RUN_PREFIX}${run.runId}` },
      { rel: ['collection'], href: `/api/entity?rel=${AGENT_RUNS_REL}` },
      { rel: ['source'], href: `/api/entity?rel=${encodeURIComponent(run.source.rel)}` },
      {
        rel: ['agent-definition'],
        href: `/_meta/api/entity?rel=${encodeURIComponent(
          `meta/agent-definition:${run.birth.definition.ref}`,
        )}`,
      },
      ...(run.birth.kind === 'legacy-t18-reconstructed'
        ? [
            {
              rel: ['legacy-capability-run'],
              href: `/api/entity?rel=capability-run:${run.runId}`,
            },
          ]
        : []),
      ...(run.result?.artifacts ?? []).map((artifact) => ({
        rel: ['artifact'],
        href: `/api/entity?rel=${encodeURIComponent(artifact.ref)}`,
      })),
    ],
    'guard-results': [],
  };
}

/** Project the canonical list/exact Agent Run Siren resources for both event generations. */
export async function getAgentRunEntity(
  db: ConnectableDb,
  rel: string,
  principal: string,
  policyScope: string,
): Promise<SirenEntity | undefined> {
  if (rel === AGENT_RUNS_REL) {
    const runs = await listAgentRuns(db, { principal, policyScope });
    return {
      class: ['collection', AGENT_RUNS_REL],
      properties: { rel, count: runs.length, limit: 20 },
      actions: [],
      entities: runs.map((run) => ({
        ...runSummary(run),
        rel: ['item'],
        href: `/api/entity?rel=${AGENT_RUN_PREFIX}${run.runId}`,
      })),
      links: [{ rel: ['self'], href: `/api/entity?rel=${AGENT_RUNS_REL}` }],
      'guard-results': [],
    };
  }
  if (!rel.startsWith(AGENT_RUN_PREFIX)) return undefined;
  const run = await getAgentRun(db, rel.slice(AGENT_RUN_PREFIX.length), principal, policyScope);
  if (run === undefined) return undefined;
  const [raw, resultRef] = await Promise.all([
    listAgentRunRawReceipts(db, run.runId),
    getAgentRunResultRef(db, run.runId),
  ]);
  return runEntity(run, { raw, ...(resultRef === undefined ? {} : { resultRef }) });
}

export async function enrichEntityWithAgentRuns(
  db: ConnectableDb,
  entity: SirenEntity,
  principal: string,
  policyScope: string,
): Promise<SirenEntity> {
  const rel = entity.properties.rel;
  if (typeof rel !== 'string') return entity;
  const runs = await findAgentRunsBySource(db, rel, principal, policyScope);
  if (runs.length === 0) return entity;
  return {
    ...entity,
    links: [
      ...entity.links,
      ...runs.map((run) => ({
        rel: ['agent-run'],
        href: `/api/entity?rel=${AGENT_RUN_PREFIX}${run.runId}`,
      })),
    ],
  };
}

function stringParam(params: Record<string, unknown>, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function commandForAction(
  run: AgentRun,
  request: ExecRequest,
): AgentRunCommand | { error: string } {
  const params = request.params ?? {};
  const commandBase = {
    runId: run.runId,
    expectedRevision: run.revision,
    eventId: `event:${request.action}:${run.runId}:${run.revision + 1}`,
    commandId: `command:${request.action}:${run.runId}:${run.revision + 1}`,
  };
  if (request.action === 'cancel') {
    if (!CANCELLABLE.has(run.status))
      return { error: `agent run cannot cancel from ${run.status}` };
    return { ...commandBase, kind: 'cancel', reason: 'cancelled by human action' };
  }
  if (request.action === 'answer-question') {
    const questionId = stringParam(params, 'questionId');
    if (questionId === undefined || params.answer === undefined) {
      return { error: 'questionId and answer are required' };
    }
    const pending = pendingQuestion(run);
    if (run.status !== 'needs-input' || pending?.questionId !== questionId) {
      return { error: 'question is not pending' };
    }
    return {
      ...commandBase,
      kind: 'answer-question',
      questionId,
      answeredBy: request.principal!,
      answer: params.answer as AgentRunJson,
    };
  }
  if (request.action === 'approve-resource-grant' || request.action === 'deny-resource-grant') {
    const requestId = stringParam(params, 'requestId');
    if (requestId === undefined) return { error: 'requestId is required' };
    const pending = pendingGrant(run);
    if (run.status !== 'waiting-approval' || pending?.requestId !== requestId) {
      return { error: 'resource grant request is not pending' };
    }
    const granted = request.action === 'approve-resource-grant';
    return {
      ...commandBase,
      kind: 'decide-resource-grant',
      requestId,
      decision: {
        outcome: granted ? 'granted' : 'denied',
        decidedBy: request.principal!,
        ...(granted ? { grantRef: `grant:${run.runId}:${requestId}` } : {}),
        ...(stringParam(params, 'reason') === undefined
          ? {}
          : { reason: stringParam(params, 'reason') }),
      },
    };
  }
  return { error: 'agent run action is not declared' };
}

/** Execute human interaction with a native Agent Run. Runtime signalling is composed separately. */
export async function executeAgentRunAction(
  db: ConnectableDb,
  request: ExecRequest,
  policyScope: string,
): Promise<{ kind: 'accepted'; entity: SirenEntity } | { kind: 'rejected'; reason: string }> {
  if (!request.rel.startsWith(AGENT_RUN_PREFIX)) {
    return { kind: 'rejected', reason: 'agent run action is not declared' };
  }
  if ((request.actor ?? 'human') !== 'human') {
    return { kind: 'rejected', reason: 'agent run interaction requires human actor' };
  }
  if (request.principal === undefined) return { kind: 'rejected', reason: 'principal is required' };
  const run = await getAgentRun(
    db,
    request.rel.slice(AGENT_RUN_PREFIX.length),
    request.principal,
    policyScope,
  );
  if (run === undefined) return { kind: 'rejected', reason: 'agent run not found' };
  if (run.birth.kind === 'legacy-t18-reconstructed') {
    return { kind: 'rejected', reason: 'legacy run actions use capability-run compatibility API' };
  }
  const command = commandForAction(run, request);
  if ('error' in command) return { kind: 'rejected', reason: command.error };
  const updated = await appendAgentRunCommand(db, command, 'human');
  const raw = await listAgentRunRawReceipts(db, updated.aggregate.runId);
  const resultRef = await getAgentRunResultRef(db, updated.aggregate.runId);
  return {
    kind: 'accepted',
    entity: runEntity(updated.aggregate, {
      raw,
      ...(resultRef === undefined ? {} : { resultRef }),
    }),
  };
}

export function isAgentRunRel(rel: string): boolean {
  return rel === AGENT_RUNS_REL || rel.startsWith(AGENT_RUN_PREFIX);
}
