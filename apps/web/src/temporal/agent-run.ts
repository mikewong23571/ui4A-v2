import { Client, Connection } from '@temporalio/client';

import type { AgentRunBirthReferences, AgentRunSource, AgentTaskEnvelope } from '@ui4a/engine';

export interface AgentRunDispatchArgs {
  runId: string;
  principal: string;
  policyScope: string;
  source: AgentRunSource;
  birth: AgentRunBirthReferences;
  task: AgentTaskEnvelope;
  limits: { maxSuspensions: number };
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

export function agentRunWorkflowId(runId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(runId)) throw new Error('agent runId is invalid');
  return `agent-${runId}`;
}

/** Start the generic, idempotently named Agent Host workflow. */
export async function dispatchAgentRun(
  args: AgentRunDispatchArgs,
): Promise<{ workflowId: string }> {
  const workflowId = agentRunWorkflowId(args.runId);
  const client = await temporalClient();
  await client.workflow.start('agentRunWorkflow', {
    args: [args],
    taskQueue: taskQueue(),
    workflowId,
  });
  return { workflowId };
}

export async function cancelAgentRun(runId: string): Promise<void> {
  const client = await temporalClient();
  await client.workflow.getHandle(agentRunWorkflowId(runId)).cancel();
}

export function resetTemporalAgentRunClientForTests(): void {
  clientPromise = null;
}
