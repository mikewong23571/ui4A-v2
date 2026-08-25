/**
 * Agent Run 事件折叠:幂等重放(eventId/commandId 冲突索引)+ 状态机推进。
 * 完整与增量切片语义一致(foldAgentRunEvents 即 reduce)。
 */
import type {
  AgentRun,
  AgentRunContractRef,
  AgentRunEvent,
  AgentRunSnapshot,
  AgentRunStatus,
} from './run-types';

const TERMINAL = new Set<AgentRunStatus>(['succeeded', 'failed', 'cancelled', 'stale']);

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((child) => cloneJson(child)) as T;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
  ) as T;
}

function sameContract(left: AgentRunContractRef, right: AgentRunContractRef): boolean {
  return left.ref === right.ref && left.hash === right.hash;
}

function requireStatus(run: AgentRun, statuses: AgentRunStatus[], kind: string): void {
  if (!statuses.includes(run.status)) {
    throw new Error(`${kind} is invalid while agent run is ${run.status}`);
  }
}

/** Create an empty Agent Run projection. */
export function createAgentRunSnapshot(): AgentRunSnapshot {
  return { runs: {}, processedEventIds: {}, commandEventIds: {} };
}

export function foldOne(snapshot: AgentRunSnapshot, event: AgentRunEvent): AgentRunSnapshot {
  const knownCommand = snapshot.processedEventIds[event.eventId];
  if (knownCommand !== undefined) {
    if (knownCommand !== event.commandId) throw new Error(`eventId ${event.eventId} collision`);
    return snapshot;
  }
  const knownEvent = snapshot.commandEventIds[event.commandId];
  if (knownEvent !== undefined) {
    if (knownEvent !== event.eventId) throw new Error(`commandId ${event.commandId} collision`);
    return snapshot;
  }

  const existing = snapshot.runs[event.runId];
  let run: AgentRun;
  if (event.kind === 'agent-run-created') {
    if (existing !== undefined) throw new Error(`agent run ${event.runId} already exists`);
    if (event.revision !== 1) throw new Error('created agent run revision must be 1');
    if (!sameContract(event.task.contract, event.birth.taskContract)) {
      throw new Error('task envelope does not match the birth task contract');
    }
    run = {
      runId: event.runId,
      revision: 1,
      status: 'queued',
      principal: event.principal,
      policyScope: event.policyScope,
      source: cloneJson(event.source),
      birth: cloneJson(event.birth),
      task: cloneJson(event.task),
      cursor: null,
      observedSequence: 0,
      restartCount: 0,
      questions: [],
      resourceGrantRequests: [],
    };
  } else {
    if (existing === undefined) throw new Error(`agent run ${event.runId} does not exist`);
    if (event.revision !== existing.revision + 1) {
      throw new Error(`agent run revision ${event.revision} is not consecutive`);
    }
    if (TERMINAL.has(existing.status)) throw new Error('agent run is terminal');
    switch (event.kind) {
      case 'agent-run-preparing':
        requireStatus(existing, ['queued'], event.kind);
        run = { ...existing, revision: event.revision, status: 'preparing' };
        break;
      case 'agent-run-started':
        requireStatus(existing, ['preparing'], event.kind);
        run = {
          ...existing,
          revision: event.revision,
          status: 'running',
          ...(event.handle === undefined ? {} : { handle: cloneJson(event.handle) }),
        };
        break;
      case 'agent-run-cursor-advanced':
        requireStatus(existing, ['running'], event.kind);
        if (event.priorCursor !== existing.cursor) throw new Error('agent run cursor conflict');
        if (event.observedSequence !== existing.observedSequence + 1) {
          throw new Error('observed event sequence is not consecutive');
        }
        run = {
          ...existing,
          revision: event.revision,
          cursor: event.cursor,
          observedSequence: event.observedSequence,
        };
        break;
      case 'agent-run-restarted':
        requireStatus(existing, ['running'], event.kind);
        if (event.priorCursor !== existing.cursor) throw new Error('agent run cursor conflict');
        run = {
          ...existing,
          revision: event.revision,
          restartCount: existing.restartCount + 1,
          ...(event.handle === undefined ? {} : { handle: cloneJson(event.handle) }),
        };
        break;
      case 'agent-run-question-asked': {
        requireStatus(existing, ['running'], event.kind);
        if (
          existing.questions.some((question) => question.questionId === event.question.questionId)
        ) {
          throw new Error(`question ${event.question.questionId} already exists`);
        }
        run = {
          ...existing,
          revision: event.revision,
          status: 'needs-input',
          questions: [
            ...existing.questions,
            { ...cloneJson(event.question), askedAtRevision: event.revision },
          ],
        };
        break;
      }
      case 'agent-run-question-answered': {
        requireStatus(existing, ['needs-input'], event.kind);
        const pending = existing.questions.find(
          (question) => question.questionId === event.questionId && question.answer === undefined,
        );
        if (pending === undefined) throw new Error(`question ${event.questionId} is not pending`);
        run = {
          ...existing,
          revision: event.revision,
          status: 'running',
          questions: existing.questions.map((question) =>
            question.questionId === event.questionId
              ? {
                  ...question,
                  answer: {
                    value: cloneJson(event.answer),
                    answeredBy: event.answeredBy,
                    answeredAtRevision: event.revision,
                  },
                }
              : question,
          ),
        };
        break;
      }
      case 'agent-run-resource-grant-requested':
        requireStatus(existing, ['running'], event.kind);
        if (
          existing.resourceGrantRequests.some(
            (request) => request.requestId === event.request.requestId,
          )
        ) {
          throw new Error(`resource request ${event.request.requestId} already exists`);
        }
        run = {
          ...existing,
          revision: event.revision,
          status: 'waiting-approval',
          resourceGrantRequests: [
            ...existing.resourceGrantRequests,
            { ...cloneJson(event.request), requestedAtRevision: event.revision },
          ],
        };
        break;
      case 'agent-run-resource-grant-decided': {
        requireStatus(existing, ['waiting-approval'], event.kind);
        const pending = existing.resourceGrantRequests.find(
          (request) => request.requestId === event.requestId && request.decision === undefined,
        );
        if (pending === undefined)
          throw new Error(`resource request ${event.requestId} is not pending`);
        run = {
          ...existing,
          revision: event.revision,
          status: 'running',
          resourceGrantRequests: existing.resourceGrantRequests.map((request) =>
            request.requestId === event.requestId
              ? {
                  ...request,
                  decision: { ...cloneJson(event.decision), decidedAtRevision: event.revision },
                }
              : request,
          ),
        };
        break;
      }
      case 'agent-run-succeeded':
        requireStatus(existing, ['running'], event.kind);
        if (!sameContract(event.result.contract, existing.birth.resultContract)) {
          throw new Error('result envelope does not match the birth result contract');
        }
        run = {
          ...existing,
          revision: event.revision,
          status: 'succeeded',
          result: cloneJson(event.result),
        };
        break;
      case 'agent-run-failed':
        requireStatus(
          existing,
          ['queued', 'preparing', 'running', 'needs-input', 'waiting-approval'],
          event.kind,
        );
        run = {
          ...existing,
          revision: event.revision,
          status: 'failed',
          failure: { code: event.code, reason: event.reason },
        };
        break;
      case 'agent-run-cancelled':
        requireStatus(
          existing,
          ['queued', 'preparing', 'running', 'needs-input', 'waiting-approval'],
          event.kind,
        );
        run = {
          ...existing,
          revision: event.revision,
          status: 'cancelled',
          ...(event.reason === undefined ? {} : { terminalReason: event.reason }),
        };
        break;
      case 'agent-run-staled':
        requireStatus(
          existing,
          ['preparing', 'running', 'needs-input', 'waiting-approval'],
          event.kind,
        );
        run = {
          ...existing,
          revision: event.revision,
          status: 'stale',
          terminalReason: event.reason,
        };
        break;
    }
  }

  return {
    runs: { ...snapshot.runs, [event.runId]: run },
    processedEventIds: { ...snapshot.processedEventIds, [event.eventId]: event.commandId },
    commandEventIds: { ...snapshot.commandEventIds, [event.commandId]: event.eventId },
  };
}

/** Fold complete or incremental event slices with identical semantics. */
export function foldAgentRunEvents(
  events: readonly AgentRunEvent[],
  initial: AgentRunSnapshot = createAgentRunSnapshot(),
): AgentRunSnapshot {
  return events.reduce(foldOne, initial);
}
