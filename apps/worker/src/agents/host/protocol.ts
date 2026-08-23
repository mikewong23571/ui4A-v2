import type {
  AgentExecutionNeedsInput,
  AgentExecutionWaitingApproval,
  AgentQuestionAnswerSignal,
  AgentResourceDecisionSignal,
  AgentResumeResolution,
} from './contracts';

export type AgentQuestionAnswerInbox = Readonly<Record<string, AgentQuestionAnswerSignal>>;
export type AgentResourceDecisionInbox = Readonly<Record<string, AgentResourceDecisionSignal>>;

/** Select the durable answer that corresponds to the currently suspended question. */
export function matchQuestionAnswer(
  suspension: AgentExecutionNeedsInput,
  answers: AgentQuestionAnswerInbox,
): AgentResumeResolution | undefined {
  const answer = answers[suspension.question.questionId];
  return answer === undefined ? undefined : { kind: 'question-answer', ...answer };
}

/** Select the durable decision that corresponds to the currently suspended resource request. */
export function matchResourceDecision(
  suspension: AgentExecutionWaitingApproval,
  decisions: AgentResourceDecisionInbox,
): AgentResumeResolution | undefined {
  const decision = decisions[suspension.request.requestId];
  return decision === undefined ? undefined : { kind: 'resource-decision', ...decision };
}

function suspensionIdentity(
  suspension: AgentExecutionNeedsInput | AgentExecutionWaitingApproval,
): string {
  return suspension.status === 'needs-input'
    ? `question:${suspension.question.questionId}`
    : `resource:${suspension.request.requestId}`;
}

/** Stable command key for persisting the pending question or resource request. */
export function suspensionIdempotencyKey(
  runId: string,
  suspension: AgentExecutionNeedsInput | AgentExecutionWaitingApproval,
): string {
  return `agent-run-suspend:${runId}:${suspensionIdentity(suspension)}`;
}

/** Stable command key for persisting the human answer or grant decision. */
export function resolutionIdempotencyKey(
  runId: string,
  suspension: AgentExecutionNeedsInput | AgentExecutionWaitingApproval,
): string {
  return `agent-run-resolve:${runId}:${suspensionIdentity(suspension)}`;
}
