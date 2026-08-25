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
