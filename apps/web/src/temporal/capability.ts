import type { CodingTask } from '@ui4a/shared';

import { getWebTemporalRuntime, resetWebTemporalRuntimeForTests } from './production-runtime';

export interface CodingCapabilityDispatchArgs {
  runId: string;
  principal: string;
  policyScope: string;
  profileName: string;
  task: CodingTask;
  baseUrl: string;
}

export function codingWorkflowId(runId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(runId)) throw new Error('coding runId is invalid');
  return `coding-${runId}`;
}

/** Start an idempotently named Coding Capability workflow. */
export async function dispatchCodingCapability(
  args: CodingCapabilityDispatchArgs,
): Promise<{ workflowId: string }> {
  const workflowId = codingWorkflowId(args.runId);
  const { client, taskQueue } = await getWebTemporalRuntime();
  await client.workflow.start('codingCapabilityWorkflow', {
    args: [args],
    taskQueue,
    workflowId,
  });
  return { workflowId };
}

export async function cancelCodingCapability(runId: string): Promise<void> {
  const { client } = await getWebTemporalRuntime();
  await client.workflow.getHandle(codingWorkflowId(runId)).cancel();
}

export function resetTemporalCapabilityClientForTests(): void {
  resetWebTemporalRuntimeForTests();
}
