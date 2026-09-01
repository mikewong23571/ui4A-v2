import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, Connection } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NativeFunctionWorkflowInputV1 } from '@ui4a/shared';
import { hashCanonicalAgentJson } from '@ui4a/engine';

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

describe.skipIf(!temporalUp)('Native Function Temporal durability', () => {
  const taskQueue = `ui4a-native-function-${process.pid}`;
  let connection: Connection;
  let client: Client;
  let worker: ChildProcess | undefined;
  let receiptPath: string;

  function spawnWorker(): ChildProcess {
    return spawn(
      'pnpm',
      ['exec', 'tsx', 'src/capabilities/function/temporal-test-worker.fixture.ts'],
      {
        cwd: new URL('../../..', import.meta.url),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TEMPORAL_ADDRESS: address,
          NATIVE_FUNCTION_TEST_TASK_QUEUE: taskQueue,
          NATIVE_FUNCTION_TEST_RECEIPT: receiptPath,
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
      // Fixture may already be gone.
    }
  }

  async function receipts(): Promise<string[]> {
    try {
      return (await readFile(receiptPath, 'utf8')).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  function input(executionId: string, scenario: string): NativeFunctionWorkflowInputV1 {
    const payload = { scenario };
    const inputSchema = { type: 'object' };
    const outputSchema = { type: 'object' };
    return {
      executionId,
      profile: {
        schemaVersion: 1,
        ref: 'fixture',
        version: '1',
        executorClass: 'native-function',
        handlerRef: 'fixture/handler@1',
        adapterVersion: 'fixture@1',
        availability: { status: 'available' },
        limits: {
          startToCloseTimeoutMs: 1_000,
          maximumAttempts: 3,
          inputBytes: 4096,
          outputBytes: 4096,
        },
        network: 'denied',
      },
      invocation: {
        schemaVersion: 1,
        source: {
          eventId: 'core:42',
          rel: 'cve:CVE-2026-0001',
          action: 'enrich-impact',
          principal: 'user:test',
          policyScope: 'security',
        },
        birth: {
          capability: { name: 'fixture', hash: hashCanonicalAgentJson({ name: 'fixture' }) },
          profile: {
            ref: 'fixture',
            version: '1',
            handlerRef: 'fixture/handler@1',
            adapterVersion: 'fixture@1',
          },
          inputContract: { hash: hashCanonicalAgentJson(inputSchema), schema: inputSchema },
          outputContract: { hash: hashCanonicalAgentJson(outputSchema), schema: outputSchema },
        },
        callback: { onDoneAction: 'done', onErrorAction: 'failed' },
        input: {
          payload,
          sources: {},
          hash: hashCanonicalAgentJson(payload),
          byteLength: new TextEncoder().encode(JSON.stringify(payload)).byteLength,
        },
      },
    };
  }

  beforeAll(async () => {
    receiptPath = join(await mkdtemp(join(tmpdir(), 'ui4a-native-function-')), 'receipts.txt');
    connection = await Connection.connect({ address });
    client = new Client({ connection });
    worker = spawnWorker();
    await waitForOutput(worker, /worker started/u);
  });

  afterAll(async () => {
    if (worker !== undefined) kill(worker, 'SIGTERM');
    await connection?.close();
  });

  it('retries after Worker SIGKILL and finalizes exactly once', async () => {
    const executionId = 'nf-16-aaaaaaaaaaaa';
    const handle = await client.workflow.start('nativeFunctionWorkflow', {
      taskQueue,
      workflowId: `function-${executionId}`,
      args: [input(executionId, 'retry-after-kill')],
    });
    await waitForOutput(worker!, /attempt=1/u);
    kill(worker!, 'SIGKILL');
    worker = spawnWorker();
    await waitForOutput(worker, /worker started/u);
    expect(((await handle.result()) as { status: string }).status).toBe('succeeded');
    expect(
      (await receipts()).filter((value) => value === `finalize:${executionId}:succeeded`),
    ).toHaveLength(1);
  }, 30_000);

  it('finalizes cancellation and keeps the Workflow CANCELLED', async () => {
    const executionId = 'nf-17-bbbbbbbbbbbb';
    const handle = await client.workflow.start('nativeFunctionWorkflow', {
      taskQueue,
      workflowId: `function-${executionId}`,
      args: [input(executionId, 'cancel-me')],
    });
    await waitForOutput(worker!, new RegExp(`id=${executionId}`, 'u'));
    await handle.cancel();
    await expect(handle.result()).rejects.toThrow();
    expect((await handle.describe()).status.name).toBe('CANCELLED');
    expect(await receipts()).toContain(`finalize:${executionId}:cancelled`);
  }, 30_000);
});
