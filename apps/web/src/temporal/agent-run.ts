import type { AgentRunBirthReferences, AgentRunSource, AgentTaskEnvelope } from '@ui4a/engine';

import { getWebTemporalRuntime, resetWebTemporalRuntimeForTests } from './production-runtime';

export interface AgentRunDispatchArgs {
  runId: string;
  principal: string;
  policyScope: string;
  source: AgentRunSource;
  birth: AgentRunBirthReferences;
  task: AgentTaskEnvelope;
  limits: { maxSuspensions: number };
}

export function agentRunWorkflowId(runId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(runId)) throw new Error('agent runId is invalid');
  return `agent-${runId}`;
}

/** Start the generic, idempotently named Agent Host workflow. */
export async function dispatchAgentRun(
  args: AgentRunDispatchArgs,
): Promise<{ workflowId: string }> {
  const workflowId = agentRunWorkflowId(args.runId);
  const { client, taskQueue } = await getWebTemporalRuntime();
  await client.workflow.start('agentRunWorkflow', {
    args: [args],
    taskQueue,
    workflowId,
  });
  return { workflowId };
}

export async function cancelAgentRun(runId: string): Promise<void> {
  const { client } = await getWebTemporalRuntime();
  await client.workflow.getHandle(agentRunWorkflowId(runId)).cancel();
}

export function resetTemporalAgentRunClientForTests(): void {
  resetWebTemporalRuntimeForTests();
}
