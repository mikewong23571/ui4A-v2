import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Connection } from '@temporalio/client';

import type { CodingCapabilityWorkflowArgs } from '../../workflows';

const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const [host = 'localhost', portText = '7233'] = address.split(':');
const temporalUp = await new Promise<boolean>((resolve) => {
  const socket = net.connect({ host, port: Number(portText) });
  socket.setTimeout(800, () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
});

if (!temporalUp) {
  console.warn(`[ui4a] Temporal unavailable at ${address}; coding kill/cancel test skipped`);
}

describe.skipIf(!temporalUp)('coding capability Temporal kill/resume and cancellation', () => {
  const taskQueue = `ui4a-coding-temporal-${process.pid}`;
  const runPrefix = `coding-temporal-${Date.now()}`;
  let connection: Connection;
  let client: Client;
  let worker: ChildProcess | undefined;
  let receiptPath: string;

  function spawnWorker(): ChildProcess {
    return spawn(
      'pnpm',
      ['exec', 'tsx', 'src/capabilities/coding/temporal-test-worker.fixture.ts'],
      {
        cwd: new URL('../../..', import.meta.url),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TEMPORAL_ADDRESS: address,
          CODING_TEST_TASK_QUEUE: taskQueue,
          CODING_TEST_RECEIPT: receiptPath,
        },
      },
    );
  }

  function waitForOutput(child: ChildProcess, pattern: RegExp, timeoutMs = 20_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(`worker output timeout: ${output}`)),
        timeoutMs,
      );
      const inspect = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
        if (!pattern.test(output)) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout?.on('data', inspect);
      child.stderr?.on('data', inspect);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`worker exited early (${code}): ${output}`));
      });
    });
  }

  function kill(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  }

  function args(runId: string, goal: string): CodingCapabilityWorkflowArgs {
    return {
      runId,
      principal: 'user:temporal-test',
      policyScope: 'development',
      profileName: 'fixture',
      baseUrl: 'http://unused.invalid',
      task: {
        schemaVersion: 1,
        repositoryRef: 'fixture',
        baseRevision: 'base',
        goal,
        constraints: [],
        acceptanceCriteria: ['fixture-test passes'],
        allowedPaths: ['src'],
        budget: {
          timeoutSeconds: 60,
          maxTurns: 2,
          maxRawEvents: 10,
          maxRawBytes: 1024,
          maxRawChunkBytes: 512,
        },
        redaction: { secretNames: [], redactHostPaths: true },
      },
    };
  }

  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui4a-coding-temporal-'));
    receiptPath = join(directory, 'finalized.txt');
    connection = await Connection.connect({ address });
    client = new Client({ connection });
    worker = spawnWorker();
    await waitForOutput(worker, /worker started/u);
  });

  afterAll(async () => {
    if (worker !== undefined) kill(worker, 'SIGTERM');
    await connection?.close();
  });

  it('keeps workflow running across SIGKILL and finalizes exactly once after retry', async () => {
    const runId = `${runPrefix}-resume`;
    const handle = await client.workflow.start('codingCapabilityWorkflow', {
      taskQueue,
      workflowId: runId,
      args: [args(runId, 'resume-after-kill')],
    });
    await waitForOutput(worker!, new RegExp(`run=${runId} attempt=1`, 'u'));
    kill(worker!, 'SIGKILL');
    expect((await handle.describe()).status.name).toBe('RUNNING');

    worker = spawnWorker();
    await waitForOutput(worker, /worker started/u);
    const result = (await handle.result()) as { status: string };
    expect(result.status).toBe('succeeded');
    expect((await readFile(receiptPath, 'utf8')).trim().split('\n')).toEqual([runId]);
  }, 60_000);

  it('propagates workflow cancellation without finalizing a success result', async () => {
    const runId = `${runPrefix}-cancel`;
    const handle = await client.workflow.start('codingCapabilityWorkflow', {
      taskQueue,
      workflowId: runId,
      args: [args(runId, 'cancel-me')],
    });
    await waitForOutput(worker!, new RegExp(`run=${runId}`, 'u'));
    await handle.cancel();
    await expect(handle.result()).rejects.toThrow();
    expect((await handle.describe()).status.name).toBe('CANCELLED');
    expect(await readFile(receiptPath, 'utf8')).not.toContain(runId);
  });

  it('finalizes the declared failure path when prepare fails terminally', async () => {
    const runId = `${runPrefix}-prepare-fail`;
    const handle = await client.workflow.start('codingCapabilityWorkflow', {
      taskQueue,
      workflowId: runId,
      args: [args(runId, 'prepare-fail')],
    });
    const result = (await handle.result()) as { status: string; code: string };
    expect(result).toMatchObject({ status: 'failed', code: 'prepare-failed' });
    expect((await readFile(receiptPath, 'utf8')).trim().split('\n')).toContain(runId);
  });
});
