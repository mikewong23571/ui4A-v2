import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../temporal/agent-run', () => ({
  dispatchAgentRun: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `agent-${runId}`,
  })),
  cancelAgentRun: vi.fn(async () => undefined),
}));
vi.mock('../../../../temporal/capability', () => ({
  dispatchCodingCapability: vi.fn(async () => ({ workflowId: 'coding-test' })),
  cancelCodingCapability: vi.fn(async () => undefined),
}));

import type { CapabilityRunCommand } from '@ui4a/engine';

import {
  appendCapabilityRunCommand,
  ensureCapabilityRunTables,
} from '../../../../db/capability-runs';
import { ensureEventsTable } from '../../../../db/events';
import { getPool } from '../../../../db/pool';
import { getEngine, resetEngineForTests } from '../../../../engine/service';
import { POST } from './route';

const pool = getPool(process.env.DATABASE_URL!);

beforeEach(async () => {
  vi.stubEnv('UI4A_CAPABILITY_CALLBACK_TOKEN', 'test-callback-token');
  vi.stubEnv(
    'UI4A_CODING_EXECUTOR_PROFILES',
    JSON.stringify([
      {
        name: 'default',
        executorClass: 'coding-agent',
        providerId: 'codex',
        transport: 'sdk',
        workspaceBackend: 'isolated-worktree',
        sandbox: 'workspace-write',
        timeoutSeconds: 300,
        maxTurns: 20,
        envAllowlist: ['PATH'],
        networkPolicy: 'none',
      },
    ]),
  );
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await pool.query('TRUNCATE capability_run_projection, capability_payloads, events');
  resetEngineForTests();
});

function request(token = 'test-callback-token') {
  return new Request('http://localhost:3100/api/internal/capability-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ui4a-capability-token': token },
    body: JSON.stringify({ runId: 'run-callback' }),
  });
}

describe('internal capability callback', () => {
  it('rejects external identity and transitions only through declared internal action', async () => {
    expect((await POST(request('bad'))).status).toBe(401);
    const engine = await getEngine(pool);
    const snapshot = await engine.readSnapshot();
    const base = snapshot.definitions?.['software-change']?.version;
    expect(base).toBe(1);
    const task = {
      schemaVersion: 1 as const,
      repositoryRef: 'repo-fixture',
      baseRevision: 'a'.repeat(40),
      goal: 'x',
      constraints: [],
      acceptanceCriteria: ['test'],
      allowedPaths: ['src'],
      budget: {
        timeoutSeconds: 300,
        maxTurns: 20,
        maxRawEvents: 2_000,
        maxRawBytes: 4 * 1024 * 1024,
        maxRawChunkBytes: 64 * 1024,
      },
      redaction: { secretNames: [], redactHostPaths: true },
    };
    const commands: CapabilityRunCommand[] = [
      {
        kind: 'create',
        eventId: 'e1',
        commandId: 'c1',
        runId: 'run-callback',
        principal: 'local-user',
        policyScope: 'development',
        profileName: 'default',
        task,
        source: {
          rel: 'software-change:main',
          action: 'start-implementation',
          eventId: 'core:1',
          onDoneAction: 'implementation-succeeded',
          onErrorAction: 'implementation-failed',
        },
      },
      {
        kind: 'prepare',
        eventId: 'e2',
        commandId: 'c2',
        runId: 'run-callback',
        expectedRevision: 1,
      },
      {
        kind: 'start',
        eventId: 'e3',
        commandId: 'c3',
        runId: 'run-callback',
        expectedRevision: 2,
        workspace: {
          schemaVersion: 1,
          workspaceId: 'w1',
          repositoryRef: 'repo-fixture',
          baseRevision: task.baseRevision,
          branch: 'ui4a/run-callback',
          leaseId: 'l1',
          allowedPaths: ['src'],
          mainCheckoutFingerprint: `sha256:${'3'.repeat(64)}`,
        },
        handle: {
          schemaVersion: 1,
          runId: 'run-callback',
          profileName: 'default',
          workspaceId: 'w1',
          nativeSessionId: 'thread-1',
        },
      },
      {
        kind: 'succeed',
        eventId: 'e4',
        commandId: 'c4',
        runId: 'run-callback',
        expectedRevision: 3,
        result: {
          schemaVersion: 1,
          resultId: 'result:run-callback',
          baseRevision: task.baseRevision,
          headRevision: task.baseRevision,
          patch: { hash: `sha256:${'1'.repeat(64)}`, sizeBytes: 1, mediaType: 'text/x-diff' },
          trajectory: {
            hash: `sha256:${'2'.repeat(64)}`,
            sizeBytes: 1,
            mediaType: 'application/x-ndjson',
          },
          commits: [],
          changedFiles: ['src/a.ts'],
          testRuns: [{ command: 'test', exitCode: 0, passed: true }],
          summary: 'done',
        },
      },
    ];
    for (const command of commands) await appendCapabilityRunCommand(pool, command);
    await engine.exec({
      rel: 'software-change:main',
      action: 'start-implementation',
      actor: 'human',
      principal: 'local-user',
      params: {
        repositoryRef: 'repo-fixture',
        baseRevision: task.baseRevision,
        goal: 'x',
        constraints: [],
        acceptanceCriteria: ['test'],
        allowedPaths: ['src'],
      },
    });
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect((await first.json()) as { entity: { properties: { node: string } } }).toMatchObject({
      entity: { properties: { node: 'review-ready' } },
    });
    const retry = await POST(request());
    expect(await retry.json()).toMatchObject({ deduplicated: true });
  });
});
