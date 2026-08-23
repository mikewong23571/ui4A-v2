import type {
  AgentResultEnvelope,
  AgentRunBirthReferences,
  AgentRunExecutionHandle,
  AgentRunJson,
  AgentRunQuestion,
  AgentRunResourceDecision,
  AgentRunResourceRequest,
  AgentRunSource,
  AgentTaskEnvelope,
} from '@ui4a/engine';

/** Server-selected, immutable inputs captured when a native Agent Run is born. */
export interface AgentRunWorkflowArgs {
  runId: string;
  principal: string;
  policyScope: string;
  source: AgentRunSource;
  birth: AgentRunBirthReferences;
  task: AgentTaskEnvelope;
  limits: {
    /** Mechanical loop bound; a runtime cannot suspend a Workflow forever. */
    maxSuspensions: number;
  };
}

/** Opaque specialization-owned state created before provider execution begins. */
export interface AgentPreparedResult {
  state: AgentRunJson;
  handle?: AgentRunExecutionHandle;
}

/** Checkpoint persisted by Temporal heartbeat and scoped to exactly one Run. */
export interface AgentExecutionHeartbeat {
  schemaVersion: 1;
  runId: string;
  cursor: string | null;
  state: AgentRunJson;
}

export interface AgentExecutionCompleted {
  status: 'completed';
  state: AgentRunJson;
  handle?: AgentRunExecutionHandle;
}

export interface AgentExecutionNeedsInput {
  status: 'needs-input';
  question: Omit<AgentRunQuestion, 'askedAtRevision' | 'answer'>;
  checkpoint: AgentExecutionHeartbeat;
}

export interface AgentExecutionWaitingApproval {
  status: 'waiting-approval';
  request: AgentRunResourceRequest;
  checkpoint: AgentExecutionHeartbeat;
}

export type AgentExecutionResult =
  | AgentExecutionCompleted
  | AgentExecutionNeedsInput
  | AgentExecutionWaitingApproval
  | { status: 'failed'; code: string; reason: string }
  | { status: 'cancelled'; reason: string };

export interface AgentQuestionAnswerSignal {
  questionId: string;
  answer: AgentRunJson;
  answeredBy: string;
}

export interface AgentResourceDecisionSignal {
  requestId: string;
  decision: AgentRunResourceDecision;
}

export type AgentResumeResolution =
  | ({ kind: 'question-answer' } & AgentQuestionAnswerSignal)
  | ({ kind: 'resource-decision' } & AgentResourceDecisionSignal);

export interface AgentExecuteActivityArgs {
  context: AgentRunWorkflowArgs;
  prepared: AgentPreparedResult;
  resolution?: AgentResumeResolution;
}

/** Specialization adapter output before verifier evidence is enforced. */
export interface AgentCollectedResult {
  candidate: AgentResultEnvelope;
}

export type AgentVerificationResult =
  | { status: 'succeeded'; result: AgentResultEnvelope }
  | { status: 'failed'; code: string; reason: string };

export type AgentRunWorkflowResult =
  | { status: 'succeeded'; result: AgentResultEnvelope }
  | { status: 'failed'; code: string; reason: string }
  | { status: 'cancelled'; reason: string };

export interface AgentSuspensionRecord {
  context: AgentRunWorkflowArgs;
  suspension: AgentExecutionNeedsInput | AgentExecutionWaitingApproval;
  idempotencyKey: string;
}

export interface AgentResolutionRecord {
  context: AgentRunWorkflowArgs;
  suspension: AgentExecutionNeedsInput | AgentExecutionWaitingApproval;
  resolution: AgentResumeResolution;
  idempotencyKey: string;
}

export interface AgentFinalizeInput {
  context: AgentRunWorkflowArgs;
  outcome: AgentRunWorkflowResult;
  idempotencyKey: string;
}

/** Task-queue activity surface. Implementations live at composition boundaries, not in Workflow code. */
export interface AgentRunActivities {
  prepareAgentRun(args: AgentRunWorkflowArgs): Promise<AgentPreparedResult>;
  executeAgentRun(args: AgentExecuteActivityArgs): Promise<AgentExecutionResult>;
  collectAgentRun(args: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  }): Promise<AgentCollectedResult>;
  verifyAgentRun(args: {
    context: AgentRunWorkflowArgs;
    collected: AgentCollectedResult;
  }): Promise<AgentVerificationResult>;
  recordAgentRunSuspension(args: AgentSuspensionRecord): Promise<{ deduplicated: boolean }>;
  recordAgentRunResolution(args: AgentResolutionRecord): Promise<{ deduplicated: boolean }>;
  finalizeAgentRun(args: AgentFinalizeInput): Promise<void>;
}

export interface AgentRuntimeProgress {
  cursor: string | null;
  state: AgentRunJson;
}

export interface AgentRuntimeExecutionInput extends AgentExecuteActivityArgs {
  signal: AbortSignal;
  restartBoundary: boolean;
  reportProgress(progress: AgentRuntimeProgress): void;
}

export interface AgentRuntimeResumeInput extends AgentRuntimeExecutionInput {
  checkpoint: AgentExecutionHeartbeat;
}

/** Provider-neutral runtime port selected by the deployment-side Runtime registry. */
export interface AgentRuntimePort {
  execute(input: AgentRuntimeExecutionInput): Promise<AgentExecutionResult>;
  resume?(input: AgentRuntimeResumeInput): Promise<AgentExecutionResult>;
}

/** Durable Run command port. Implementations must deduplicate the attempt-derived command. */
export interface AgentRestartCommandPort {
  recordRestart(args: {
    context: AgentRunWorkflowArgs;
    attempt: number;
    priorCursor: string | null;
    reason: 'activity-retry-native-resume' | 'activity-retry-restart-boundary';
  }): Promise<void>;
}

export interface AgentFinalizePorts {
  recordTerminal(args: AgentFinalizeInput): Promise<{ deduplicated: boolean }>;
  callbackSource(args: AgentFinalizeInput): Promise<{ deduplicated: boolean }>;
}
