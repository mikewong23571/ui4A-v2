import type { NativeFunctionInvocationV1, NativeFunctionProfileV1 } from '@ui4a/shared';
import { hashCanonicalAgentJson } from '@ui4a/engine';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import type { NativeFunctionStartInput } from '../engine/capability/dispatch';
import { getWebTemporalRuntime, resetWebTemporalRuntimeForTests } from './production-runtime';

export interface NativeFunctionWorkflowArgs {
  executionId: string;
  invocation: NativeFunctionInvocationV1;
  profile: NativeFunctionProfileV1;
}

export function nativeFunctionWorkflowId(executionId: string): string {
  if (!/^nf-[a-z0-9]+-[a-f0-9]{12}$/.test(executionId)) {
    throw new Error('native function executionId is invalid');
  }
  return `function-${executionId}`;
}

/** Start one idempotently named Native Function workflow after its spawn outbox is committed. */
export async function dispatchNativeFunction(input: NativeFunctionStartInput): Promise<void> {
  if (input.workflowId !== nativeFunctionWorkflowId(input.executionId)) {
    throw new Error('native function workflow identity mismatch');
  }
  const { client, taskQueue } = await getWebTemporalRuntime();
  const invocationHash = hashCanonicalAgentJson(input.invocation as never);
  try {
    await client.workflow.start('nativeFunctionWorkflow', {
      args: [
        {
          executionId: input.executionId,
          invocation: input.invocation,
          profile: input.profile,
        } satisfies NativeFunctionWorkflowArgs,
      ],
      taskQueue,
      workflowId: input.workflowId,
      memo: { invocationHash },
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    const existing = await client.workflow.getHandle(input.workflowId).describe();
    if (existing.memo?.invocationHash !== invocationHash) {
      throw new Error('already-started Native Function invocation does not match persisted birth');
    }
  }
}

export function resetTemporalNativeFunctionClientForTests(): void {
  resetWebTemporalRuntimeForTests();
}
