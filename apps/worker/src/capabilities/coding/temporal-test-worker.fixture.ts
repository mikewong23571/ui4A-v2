import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { activityInfo, cancellationSignal, heartbeat } from '@temporalio/activity';
import { NativeConnection, Worker } from '@temporalio/worker';

import type { CodingCapabilityWorkflowArgs } from '../../workflows';

const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const taskQueue = process.env.CODING_TEST_TASK_QUEUE;
const receiptPath = process.env.CODING_TEST_RECEIPT;
if (taskQueue === undefined || receiptPath === undefined) {
  throw new Error('CODING_TEST_TASK_QUEUE and CODING_TEST_RECEIPT are required');
}

const activities = {
  async prepareCodingRun(args: CodingCapabilityWorkflowArgs) {
    if (args.task.goal === 'prepare-fail') throw new Error('fixture preflight failed');
    return {
      workspace: {
        schemaVersion: 1 as const,
        workspaceId: `workspace:${args.runId}`,
        repositoryRef: args.task.repositoryRef,
        baseRevision: args.task.baseRevision,
        branch: `ui4a/run-${args.runId}`,
        leaseId: `lease:${args.runId}`,
        allowedPaths: args.task.allowedPaths,
        mainCheckoutFingerprint: 'sha256:fixture-main',
      },
    };
  },
  async executeCodingRun(input: { context: CodingCapabilityWorkflowArgs }) {
    const attempt = activityInfo().attempt;
    console.log(`[ui4a-coding-test] execute run=${input.context.runId} attempt=${attempt}`);
    heartbeat({ runId: input.context.runId, attempt });
    if (input.context.task.goal === 'cancel-me') {
      const signal = cancellationSignal();
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    if (attempt === 1) await new Promise<never>(() => undefined);
    return {
      status: 'succeeded' as const,
      result: {
        schemaVersion: 1 as const,
        resultId: `result:${input.context.runId}`,
        baseRevision: input.context.task.baseRevision,
        headRevision: input.context.task.baseRevision,
        patch: { hash: 'sha256:patch', sizeBytes: 0, mediaType: 'text/x-diff' },
        trajectory: {
          hash: 'sha256:trajectory',
          sizeBytes: 0,
          mediaType: 'application/x-ndjson',
        },
        commits: [],
        changedFiles: [],
        testRuns: [{ command: 'fixture-test', exitCode: 0, passed: true }],
        summary: 'resumed after worker loss',
      },
    };
  },
  async finalizeCodingRun(input: { context: CodingCapabilityWorkflowArgs }) {
    await appendFile(receiptPath, `${input.context.runId}\n`, 'utf8');
  },
};

const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace: 'default',
  taskQueue,
  workflowsPath: fileURLToPath(new URL('../../workflows.ts', import.meta.url)),
  activities,
});
console.log(`[ui4a-coding-test] worker started taskQueue=${taskQueue}`);
process.on('SIGTERM', () => worker.shutdown());
await worker.run();
await connection.close();
