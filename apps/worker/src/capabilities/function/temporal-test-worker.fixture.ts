import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { activityInfo, Context } from '@temporalio/activity';
import { NativeConnection, Worker } from '@temporalio/worker';

import type {
  NativeFunctionActivities,
  NativeFunctionFinalizeInput,
} from '../../activities/native-function';
import type { NativeFunctionOutcomeV1, NativeFunctionWorkflowInputV1 } from '@ui4a/shared';

const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const taskQueue = process.env.NATIVE_FUNCTION_TEST_TASK_QUEUE;
const configuredReceiptPath = process.env.NATIVE_FUNCTION_TEST_RECEIPT;
if (taskQueue === undefined || configuredReceiptPath === undefined) {
  throw new Error('NATIVE_FUNCTION_TEST_TASK_QUEUE and NATIVE_FUNCTION_TEST_RECEIPT are required');
}
const receiptPath = configuredReceiptPath;

async function appendUnique(value: string): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(receiptPath, 'utf8');
  } catch {
    // First receipt creates the file.
  }
  if (existing.split('\n').includes(value)) return;
  await appendFile(receiptPath, `${value}\n`, 'utf8');
}

function scenario(input: NativeFunctionWorkflowInputV1): string {
  const value = input.invocation.input.payload.scenario;
  return typeof value === 'string' ? value : 'success';
}

function awaitCancellation(): Promise<never> {
  return new Promise((_resolve, reject) => {
    Context.current().cancellationSignal.addEventListener(
      'abort',
      () => reject(Context.current().cancellationSignal.reason),
      { once: true },
    );
  });
}

const activities: NativeFunctionActivities = {
  async executeNativeFunctionActivity(input): Promise<NativeFunctionOutcomeV1> {
    const attempt = activityInfo().attempt;
    console.log(`[ui4a-native-function-test] execute id=${input.executionId} attempt=${attempt}`);
    if (scenario(input) === 'retry-after-kill' && attempt === 1) return awaitCancellation();
    if (scenario(input) === 'cancel-me') return awaitCancellation();
    return {
      schemaVersion: 1,
      status: 'succeeded',
      output: { status: 'enriched' },
      outputHash: `sha256:${'a'.repeat(64)}`,
      outputByteLength: 21,
      evidenceRefs: [],
      attempt,
    };
  },
  async finalizeNativeFunctionActivity(input: NativeFunctionFinalizeInput): Promise<void> {
    await appendUnique(`finalize:${input.context.executionId}:${input.outcome.status}`);
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
console.log(`[ui4a-native-function-test] worker started taskQueue=${taskQueue}`);
process.on('SIGTERM', () => worker.shutdown());
await worker.run();
await connection.close();
