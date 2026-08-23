import { Client, Connection } from '@temporalio/client';

import type { CodingTask } from '@ui4a/shared';

export interface CodingCapabilityDispatchArgs {
  runId: string;
  principal: string;
  policyScope: string;
  profileName: string;
  task: CodingTask;
  baseUrl: string;
}

function taskQueue(): string {
  return process.env.UI4A_TASK_QUEUE ?? 'ui4a';
}

function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
}

let clientPromise: Promise<Client> | null = null;

function temporalClient(): Promise<Client> {
  if (clientPromise === null) {
    clientPromise = Connection.connect({ address: temporalAddress() }).then(
      (connection) => new Client({ connection }),
    );
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }
  return clientPromise;
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
  const client = await temporalClient();
  await client.workflow.start('codingCapabilityWorkflow', {
    args: [args],
    taskQueue: taskQueue(),
    workflowId,
  });
  return { workflowId };
}

export async function cancelCodingCapability(runId: string): Promise<void> {
  const client = await temporalClient();
  await client.workflow.getHandle(codingWorkflowId(runId)).cancel();
}

export function resetTemporalCapabilityClientForTests(): void {
  clientPromise = null;
}
