import { fileURLToPath } from 'node:url';

import { Client, Connection } from '../apps/worker/node_modules/@temporalio/client/lib/index.js';
import {
  NativeConnection,
  Worker,
} from '../apps/worker/node_modules/@temporalio/worker/lib/index.js';

const address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:17233';
const namespace = process.env.TEMPORAL_NAMESPACE ?? 'ui4a-probe';
const taskQueue = 't22-topology-probe';
const workflowId = 't22-durable-probe';

async function clientConnection(): Promise<{ connection: Connection; client: Client }> {
  const connection = await Connection.connect({ address });
  return { connection, client: new Client({ connection, namespace }) };
}

async function execute(): Promise<void> {
  const workerConnection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection: workerConnection,
    namespace,
    taskQueue,
    workflowsPath: fileURLToPath(
      new URL('../apps/worker/src/t22-temporal-probe-workflows.ts', import.meta.url),
    ),
  });
  const workerRun = worker.run();
  const { connection, client } = await clientConnection();
  try {
    const handle = await client.workflow.start('durableProbeWorkflow', {
      args: [{ runId: workflowId }],
      taskQueue,
      workflowId,
    });
    const result = await handle.result();
    const history = await handle.fetchHistory();
    process.stdout.write(
      JSON.stringify({
        phase: 'execute',
        workflowId,
        namespace,
        result,
        historyEvents: history.events?.length ?? 0,
      }) + '\n',
    );
  } finally {
    worker.shutdown();
    await workerRun;
    await connection.close();
    await workerConnection.close();
  }
}

async function verify(): Promise<void> {
  const { connection, client } = await clientConnection();
  try {
    const handle = client.workflow.getHandle(workflowId);
    const description = await handle.describe();
    const result = await handle.result();
    const history = await handle.fetchHistory();
    process.stdout.write(
      JSON.stringify({
        phase: 'verify-after-restart',
        workflowId,
        namespace,
        status: description.status.name,
        result,
        historyEvents: history.events?.length ?? 0,
      }) + '\n',
    );
  } finally {
    await connection.close();
  }
}

const mode = process.argv[2];
const run = mode === 'execute' ? execute : mode === 'verify' ? verify : undefined;
if (run === undefined) {
  process.stderr.write('Usage: t22-temporal-probe.ts execute|verify\n');
  process.exitCode = 2;
} else {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write('T22 Temporal probe failed: ' + message + '\n');
    process.exitCode = 1;
  });
}
