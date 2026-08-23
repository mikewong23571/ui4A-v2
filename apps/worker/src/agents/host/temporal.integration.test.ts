import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, Connection } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AgentRunWorkflowArgs } from './contracts';

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
  console.warn(`[ui4a] Temporal unavailable at ${address}; generic Agent Host tests skipped`);
}

describe.skipIf(!temporalUp)('generic Agent Host Temporal recovery and suspension protocol', () => {
  const taskQueue = `ui4a-agent-host-${process.pid}`;
  const runPrefix = `agent-host-${Date.now()}`;
  let connection: Connection;
  let client: Client;
  let worker: ChildProcess | undefined;
  let receiptPath: string;

  function spawnWorker(): ChildProcess {
    return spawn('pnpm', ['exec', 'tsx', 'src/agents/host/temporal-test-worker.fixture.ts'], {
      cwd: new URL('../../..', import.meta.url),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TEMPORAL_ADDRESS: address,
        AGENT_HOST_TEST_TASK_QUEUE: taskQueue,
        AGENT_HOST_TEST_RECEIPT: receiptPath,
      },
    });
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

  async function receipts(): Promise<string[]> {
    try {
      return (await readFile(receiptPath, 'utf8')).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async function waitForReceipt(expected: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await receipts()).includes(expected)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`receipt timeout: ${expected}; got ${(await receipts()).join(', ')}`);
  }

  function kill(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The detached fixture may already have exited.
    }
  }

  function args(runId: string, scenario: string): AgentRunWorkflowArgs {
    return {
      runId,
      principal: 'user:temporal-test',
      policyScope: 'development',
      source: {
        rel: `request:${runId}`,
        action: 'start',
        eventId: `event:${runId}`,
        onDoneAction: 'agent-succeeded',
        onErrorAction: 'agent-failed',
      },
      birth: {
        schemaVersion: 1,
        kind: 'event-native',
        definition: {
          ref: 'base-agent',
          version: 1,
          sourceHash: 'sha256:source',
          parentHashes: [],
          flattenedHash: 'sha256:definition',
        },
        prompt: { templateHash: 'sha256:template', compiledHash: 'sha256:prompt' },
        runtime: {
          profileName: 'fixture',
          profileVersion: '1',
          adapterVersion: 'fixture-v1',
        },
        taskContract: { ref: 'fixture-task@1', hash: 'sha256:task' },
        resultContract: { ref: 'fixture-result@1', hash: 'sha256:result' },
      },
      task: {
        schemaVersion: 1,
        contract: { ref: 'fixture-task@1', hash: 'sha256:task' },
        payload: { scenario },
      },
      limits: { maxSuspensions: 4 },
    };
  }

  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui4a-agent-host-temporal-'));
    receiptPath = join(directory, 'receipts.txt');
    connection = await Connection.connect({ address });
    client = new Client({ connection });
    worker = spawnWorker();
    await waitForOutput(worker, /worker started/u);
  });

  afterAll(async () => {
    if (worker !== undefined) kill(worker, 'SIGTERM');
    await connection?.close();
  });

  it('resumes from heartbeat after SIGKILL and finalizes exactly once', async () => {
    const runId = `${runPrefix}-resume`;
    const handle = await client.workflow.start('agentRunWorkflow', {
      taskQueue,
      workflowId: `agent-${runId}`,
      args: [args(runId, 'resume-after-kill')],
    });
    await waitForOutput(worker!, new RegExp(`execute run=${runId} attempt=1`, 'u'));
    kill(worker!, 'SIGKILL');
    expect((await handle.describe()).status.name).toBe('RUNNING');

    worker = spawnWorker();
    await waitForOutput(worker, /worker started/u);
    const result = (await handle.result()) as { status: string };
    expect(result.status).toBe('succeeded');
    expect(
      (await receipts()).filter((entry) => entry === `finalize:${runId}:succeeded`),
    ).toHaveLength(1);
    expect(await receipts()).toContain(`restart:${runId}:2:activity-retry-native-resume`);
  }, 60_000);

  it('records a terminal callback and remains CANCELLED when the user cancels', async () => {
    const runId = `${runPrefix}-cancel`;
    const handle = await client.workflow.start('agentRunWorkflow', {
      taskQueue,
      workflowId: `agent-${runId}`,
      args: [args(runId, 'cancel-me')],
    });
    await waitForOutput(worker!, new RegExp(`execute run=${runId}`, 'u'));
    await handle.cancel();
    await expect(handle.result()).rejects.toThrow();
    expect((await handle.describe()).status.name).toBe('CANCELLED');
    await waitForReceipt(`finalize:${runId}:cancelled`);
  });

  it('finalizes a terminal prepare failure so the source cannot remain running', async () => {
    const runId = `${runPrefix}-prepare-fail`;
    const handle = await client.workflow.start('agentRunWorkflow', {
      taskQueue,
      workflowId: `agent-${runId}`,
      args: [args(runId, 'prepare-fail')],
    });
    const result = (await handle.result()) as { status: string; code: string };
    expect(result).toMatchObject({ status: 'failed', code: 'prepare-failed' });
    expect(await receipts()).toContain(`finalize:${runId}:failed`);
  });

  it('persists a question answer before resuming execution', async () => {
    const runId = `${runPrefix}-question`;
    const handle = await client.workflow.start('agentRunWorkflow', {
      taskQueue,
      workflowId: `agent-${runId}`,
      args: [args(runId, 'needs-input')],
    });
    await waitForReceipt(`suspend:${runId}:question:audience`);
    await handle.signal('answerAgentQuestion', {
      questionId: 'question:audience',
      answer: 'experienced engineers',
      answeredBy: 'user:temporal-test',
    });
    expect(((await handle.result()) as { status: string }).status).toBe('succeeded');
    expect(await receipts()).toContain(`resolve:${runId}:question:audience`);
  }, 30_000);

  it('persists a resource decision independently from terminal result acceptance', async () => {
    const runId = `${runPrefix}-grant`;
    const handle = await client.workflow.start('agentRunWorkflow', {
      taskQueue,
      workflowId: `agent-${runId}`,
      args: [args(runId, 'waiting-approval')],
    });
    await waitForReceipt(`suspend:${runId}:resource:network-read`);
    await handle.signal('decideAgentResourceGrant', {
      requestId: 'resource:network-read',
      decision: {
        outcome: 'granted',
        decidedBy: 'user:temporal-test',
        grantRef: 'grant:one',
      },
    });
    expect(((await handle.result()) as { status: string }).status).toBe('succeeded');
    expect(await receipts()).toContain(`resolve:${runId}:resource:network-read`);
  }, 30_000);
});
