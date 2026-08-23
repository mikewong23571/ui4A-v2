import type { AgentFinalizeInput, AgentFinalizePorts } from './contracts';

/** Stable idempotency key shared by terminal persistence and the source callback. */
export function agentRunFinalizeIdempotencyKey(runId: string): string {
  return `agent-run-finalize:${runId}`;
}

/**
 * Persist the terminal Run outcome, then re-enter its source action.
 *
 * Both ports receive the same stable key. The callback is attempted even when terminal persistence
 * reports a retry, because a prior activity attempt may have crashed between those two operations.
 */
export async function finalizeAgentRunOutcome(
  input: Omit<AgentFinalizeInput, 'idempotencyKey'>,
  ports: AgentFinalizePorts,
): Promise<void> {
  const args: AgentFinalizeInput = {
    ...input,
    idempotencyKey: agentRunFinalizeIdempotencyKey(input.context.runId),
  };
  await ports.recordTerminal(args);
  await ports.callbackSource(args);
}
