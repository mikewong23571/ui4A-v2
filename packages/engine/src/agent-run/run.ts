/** JSON value accepted by specialization-independent Agent Run envelopes. */
export type AgentRunJson =
  null | boolean | number | string | AgentRunJson[] | { [key: string]: AgentRunJson };

/** Immutable reference to one versioned wire contract. */
export interface AgentRunContractRef {
  ref: string;
  hash: string;
}

/** Definition identity fixed when a Run is born. */
export interface AgentRunDefinitionBirthRef {
  ref: string;
  version: number;
  sourceHash: string;
  parentHashes: string[];
  flattenedHash: string;
}

/** Prompt identity fixed when a Run is born. */
export interface AgentRunPromptBirthRef {
  templateHash: string;
  compiledHash: string;
}

/** Deployment-selected runtime identity fixed when a Run is born. */
export interface AgentRunRuntimeBirthRef {
  profileName: string;
  profileVersion: string;
  adapterVersion: string;
}

/** Complete replay identity for one native Run. */
export interface AgentRunBirthReferences {
  schemaVersion: 1;
  kind: 'event-native';
  definition: AgentRunDefinitionBirthRef;
  prompt: AgentRunPromptBirthRef;
  runtime: AgentRunRuntimeBirthRef;
  taskContract: AgentRunContractRef;
  resultContract: AgentRunContractRef;
}

/** Specialization-owned task data inside a stable Host envelope. */
export interface AgentTaskEnvelope {
  schemaVersion: 1;
  contract: AgentRunContractRef;
  payload: AgentRunJson;
  contextRefs?: string[];
}

/** Content-addressed artifact emitted by a Run. */
export interface AgentRunArtifactRef {
  ref: string;
  hash: string;
  mediaType: string;
  sizeBytes?: number;
}

/** Independently observable evidence associated with a result. */
export interface AgentRunEvidenceRef {
  ref: string;
  kind: string;
  hash?: string;
  detail?: AgentRunJson;
}

/** Proposed application effect; execution remains outside the Run kernel. */
export interface AgentRunProposedEffect {
  rel: string;
  action: string;
  params?: Record<string, AgentRunJson>;
}

/** Specialization-owned result data inside a stable Host envelope. */
export interface AgentResultEnvelope {
  schemaVersion: 1;
  contract: AgentRunContractRef;
  resultId: string;
  payload: AgentRunJson;
  artifacts: AgentRunArtifactRef[];
  evidence: AgentRunEvidenceRef[];
  proposedEffects: AgentRunProposedEffect[];
}

/** Business event that created the Run and receives its terminal callback. */
export interface AgentRunSource {
  rel: string;
  action: string;
  eventId: string;
  onDoneAction?: string;
  onErrorAction?: string;
}

/** Opaque durable execution handle interpreted only by the selected runtime adapter. */
export interface AgentRunExecutionHandle {
  sessionRef?: string;
  detail?: AgentRunJson;
}

/** One clarification request and its durable answer, if supplied. */
export interface AgentRunQuestion {
  questionId: string;
  prompt: string;
  responseContract?: AgentRunContractRef;
  askedAtRevision: number;
  answer?: {
    value: AgentRunJson;
    answeredBy: string;
    answeredAtRevision: number;
  };
}

/** Resource boundary requested by a running specialization. */
export interface AgentRunResourceRequest {
  requestId: string;
  resource: {
    kind: string;
    ref?: string;
    operations: string[];
  };
  reason: string;
}

/** Durable resource decision. Actual authorization is enforced by application policy. */
export interface AgentRunResourceDecision {
  outcome: 'granted' | 'denied';
  decidedBy: string;
  grantRef?: string;
  reason?: string;
}

/** One resource request and its durable decision, if supplied. */
export interface AgentRunResourceGrantRequest extends AgentRunResourceRequest {
  requestedAtRevision: number;
  decision?: AgentRunResourceDecision & { decidedAtRevision: number };
}

/** Lifecycle shared by all specializations. */
export type AgentRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'needs-input'
  | 'waiting-approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'stale';

/** Canonical aggregate rebuilt exclusively from Agent Run events. */
export interface AgentRun {
  runId: string;
  revision: number;
  status: AgentRunStatus;
  principal: string;
  policyScope: string;
  source: AgentRunSource;
  birth: AgentRunBirthReferences;
  task: AgentTaskEnvelope;
  handle?: AgentRunExecutionHandle;
  cursor: string | null;
  observedSequence: number;
  restartCount: number;
  questions: AgentRunQuestion[];
  resourceGrantRequests: AgentRunResourceGrantRequest[];
  result?: AgentResultEnvelope;
  failure?: { code: string; reason: string };
  terminalReason?: string;
}

/** Independently replayable projection with event and command collision indexes. */
export interface AgentRunSnapshot {
  runs: Record<string, AgentRun>;
  processedEventIds: Record<string, string>;
  commandEventIds: Record<string, string>;
}

interface CommandBase {
  commandId: string;
  eventId: string;
  runId: string;
}

interface RevisionCommandBase extends CommandBase {
  expectedRevision: number;
}

/** Commands accepted by the pure Agent Run judge. */
export type AgentRunCommand =
  | (CommandBase & {
      kind: 'create';
      principal: string;
      policyScope: string;
      source: AgentRunSource;
      birth: AgentRunBirthReferences;
      task: AgentTaskEnvelope;
    })
  | (RevisionCommandBase & { kind: 'prepare' })
  | (RevisionCommandBase & { kind: 'start'; handle?: AgentRunExecutionHandle })
  | (RevisionCommandBase & {
      kind: 'advance-cursor';
      expectedCursor: string | null;
      cursor: string;
      observedSequence: number;
    })
  | (RevisionCommandBase & {
      kind: 'restart';
      expectedCursor: string | null;
      reason: string;
      handle?: AgentRunExecutionHandle;
    })
  | (RevisionCommandBase & {
      kind: 'ask-question';
      question: Omit<AgentRunQuestion, 'askedAtRevision' | 'answer'>;
    })
  | (RevisionCommandBase & {
      kind: 'answer-question';
      questionId: string;
      answeredBy: string;
      answer: AgentRunJson;
    })
  | (RevisionCommandBase & {
      kind: 'request-resource-grant';
      request: AgentRunResourceRequest;
    })
  | (RevisionCommandBase & {
      kind: 'decide-resource-grant';
      requestId: string;
      decision: AgentRunResourceDecision;
    })
  | (RevisionCommandBase & { kind: 'succeed'; result: AgentResultEnvelope })
  | (RevisionCommandBase & { kind: 'fail'; code: string; reason: string })
  | (RevisionCommandBase & { kind: 'cancel'; reason?: string })
  | (RevisionCommandBase & { kind: 'mark-stale'; reason: string });

interface EventBase {
  eventId: string;
  commandId: string;
  runId: string;
  revision: number;
}

/** Native event family persisted for new Agent Runs. */
export type AgentRunEvent =
  | (EventBase & {
      kind: 'agent-run-created';
      principal: string;
      policyScope: string;
      source: AgentRunSource;
      birth: AgentRunBirthReferences;
      task: AgentTaskEnvelope;
    })
  | (EventBase & { kind: 'agent-run-preparing' })
  | (EventBase & { kind: 'agent-run-started'; handle?: AgentRunExecutionHandle })
  | (EventBase & {
      kind: 'agent-run-cursor-advanced';
      priorCursor: string | null;
      cursor: string;
      observedSequence: number;
    })
  | (EventBase & {
      kind: 'agent-run-restarted';
      priorCursor: string | null;
      reason: string;
      handle?: AgentRunExecutionHandle;
    })
  | (EventBase & {
      kind: 'agent-run-question-asked';
      question: Omit<AgentRunQuestion, 'askedAtRevision' | 'answer'>;
    })
  | (EventBase & {
      kind: 'agent-run-question-answered';
      questionId: string;
      answeredBy: string;
      answer: AgentRunJson;
    })
  | (EventBase & {
      kind: 'agent-run-resource-grant-requested';
      request: AgentRunResourceRequest;
    })
  | (EventBase & {
      kind: 'agent-run-resource-grant-decided';
      requestId: string;
      decision: AgentRunResourceDecision;
    })
  | (EventBase & { kind: 'agent-run-succeeded'; result: AgentResultEnvelope })
  | (EventBase & { kind: 'agent-run-failed'; code: string; reason: string })
  | (EventBase & { kind: 'agent-run-cancelled'; reason?: string })
  | (EventBase & { kind: 'agent-run-staled'; reason: string });

/** Result of judging and folding one command. */
export interface AgentRunCommandResult {
  snapshot: AgentRunSnapshot;
  events: AgentRunEvent[];
}

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

function assertRevision(run: AgentRun, expectedRevision: number): void {
  if (run.revision !== expectedRevision) {
    throw new Error(
      `agent run revision conflict: expected ${expectedRevision}, current ${run.revision}`,
    );
  }
}

/** Create an empty Agent Run projection. */
export function createAgentRunSnapshot(): AgentRunSnapshot {
  return { runs: {}, processedEventIds: {}, commandEventIds: {} };
}

function foldOne(snapshot: AgentRunSnapshot, event: AgentRunEvent): AgentRunSnapshot {
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
