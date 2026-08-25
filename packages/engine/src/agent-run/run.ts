/**
 * Agent Run 命令裁决:command → event 转换与幂等应用(command 重试幂等)。
 *
 * 模块切分(T23 Phase D,纯搬运):run-types(信封/聚合/命令/事件类型)/
 * run-fold(事件折叠)/ 本文件(命令裁决)。公开面与拆分前一致。
 */
import { foldOne } from './run-fold';
import type {
  AgentRun,
  AgentRunCommand,
  AgentRunCommandResult,
  AgentRunEvent,
  AgentRunSnapshot,
} from './run-types';

export * from './run-types';
export { createAgentRunSnapshot, foldAgentRunEvents } from './run-fold';

function assertRevision(run: AgentRun, expectedRevision: number): void {
  if (run.revision !== expectedRevision) {
    throw new Error(
      `agent run revision conflict: expected ${expectedRevision}, current ${run.revision}`,
    );
  }
}

function commandToEvent(command: AgentRunCommand): AgentRunEvent {
  const revision = command.kind === 'create' ? 1 : command.expectedRevision + 1;
  const base = {
    eventId: command.eventId,
    commandId: command.commandId,
    runId: command.runId,
    revision,
  };
  switch (command.kind) {
    case 'create':
      return {
        ...base,
        kind: 'agent-run-created',
        principal: command.principal,
        policyScope: command.policyScope,
        source: command.source,
        birth: command.birth,
        task: command.task,
      };
    case 'prepare':
      return { ...base, kind: 'agent-run-preparing' };
    case 'start':
      return {
        ...base,
        kind: 'agent-run-started',
        ...(command.handle === undefined ? {} : { handle: command.handle }),
      };
    case 'advance-cursor':
      return {
        ...base,
        kind: 'agent-run-cursor-advanced',
        priorCursor: command.expectedCursor,
        cursor: command.cursor,
        observedSequence: command.observedSequence,
      };
    case 'restart':
      return {
        ...base,
        kind: 'agent-run-restarted',
        priorCursor: command.expectedCursor,
        reason: command.reason,
        ...(command.handle === undefined ? {} : { handle: command.handle }),
      };
    case 'ask-question':
      return { ...base, kind: 'agent-run-question-asked', question: command.question };
    case 'answer-question':
      return {
        ...base,
        kind: 'agent-run-question-answered',
        questionId: command.questionId,
        answeredBy: command.answeredBy,
        answer: command.answer,
      };
    case 'request-resource-grant':
      return { ...base, kind: 'agent-run-resource-grant-requested', request: command.request };
    case 'decide-resource-grant':
      return {
        ...base,
        kind: 'agent-run-resource-grant-decided',
        requestId: command.requestId,
        decision: command.decision,
      };
    case 'succeed':
      return { ...base, kind: 'agent-run-succeeded', result: command.result };
    case 'fail':
      return { ...base, kind: 'agent-run-failed', code: command.code, reason: command.reason };
    case 'cancel':
      return {
        ...base,
        kind: 'agent-run-cancelled',
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      };
    case 'mark-stale':
      return { ...base, kind: 'agent-run-staled', reason: command.reason };
  }
}

/** Judge one command and fold its event; command retries are idempotent. */
export function applyAgentRunCommand(
  snapshot: AgentRunSnapshot,
  command: AgentRunCommand,
): AgentRunCommandResult {
  const knownEvent = snapshot.commandEventIds[command.commandId];
  if (knownEvent !== undefined) {
    if (knownEvent !== command.eventId) throw new Error(`commandId ${command.commandId} collision`);
    return { snapshot, events: [] };
  }
  if (snapshot.processedEventIds[command.eventId] !== undefined) {
    throw new Error(`eventId ${command.eventId} collision`);
  }
  if (command.kind === 'create') {
    if (snapshot.runs[command.runId] !== undefined) throw new Error('agent run already exists');
  } else {
    const run = snapshot.runs[command.runId];
    if (run === undefined) throw new Error('agent run does not exist');
    assertRevision(run, command.expectedRevision);
  }
  const event = commandToEvent(command);
  return { snapshot: foldOne(snapshot, event), events: [event] };
}
