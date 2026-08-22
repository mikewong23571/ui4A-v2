import { fileURLToPath } from 'node:url';

import { NativeConnection, Worker } from '@temporalio/worker';

import * as activities from './activities';

const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const taskQueue = process.env.DELEGATION_TEST_TASK_QUEUE;

if (taskQueue === undefined || taskQueue === '') {
  throw new Error('DELEGATION_TEST_TASK_QUEUE is required');
}

const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace: 'default',
  taskQueue,
  workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
  activities,
});

console.log(`[ui4a-test] worker started (taskQueue=${taskQueue}, temporal=${address})`);

let shuttingDown = false;
const requestShutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  worker.shutdown();
};
process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);

await worker.run();
await connection.close();
