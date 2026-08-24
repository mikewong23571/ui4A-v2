import { sleep } from '@temporalio/workflow';

export async function durableProbeWorkflow(input: {
  runId: string;
}): Promise<{ runId: string; status: 'succeeded' }> {
  await sleep(250);
  return { runId: input.runId, status: 'succeeded' };
}
