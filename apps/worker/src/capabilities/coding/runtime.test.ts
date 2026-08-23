import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { beforeEach, describe, expect, it } from 'vitest';

import type { CapabilityRunCommand } from '@ui4a/engine';
import type { CodingExecutorProfile } from '@ui4a/shared';

import {
  appendCapabilityRunCommand,
  ensureCapabilityRunTables,
  getCapabilityRun,
} from '../../../../web/src/db/capability-runs';
import { ensureEventsTable } from '../../../../web/src/db/events';
import { getPool } from '../../../../web/src/db/pool';
import type { CodexExecutionDeps, CodexExecutionInput } from './codex';
import {
  executeCodingRunWithDeps,
  prepareCodingRunWithDeps,
  type CodingRunContext,
  type CodingRuntimeDeps,
} from './runtime';

const runFile = promisify(execFile);
const pool = getPool(process.env.DATABASE_URL!);

const profile: CodingExecutorProfile = {
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
};

async function fixture(): Promise<{ context: CodingRunContext; repository: string; root: string }> {
  const repository = await mkdtemp(join(tmpdir(), 'ui4a-runtime-repo-'));
  const root = await mkdtemp(join(tmpdir(), 'ui4a-runtime-workspaces-'));
  await runFile('git', ['init', '-q', repository]);
  await runFile('git', ['-C', repository, 'config', 'user.email', 'fixture@ui4a.dev']);
  await runFile('git', ['-C', repository, 'config', 'user.name', 'UI4A Fixture']);
  await writeFile(join(repository, 'README.md'), 'main\n');
  await runFile('git', ['-C', repository, 'add', '.']);
  await runFile('git', ['-C', repository, 'commit', '-qm', 'seed']);
  const base = (await runFile('git', ['-C', repository, 'rev-parse', 'HEAD'])).stdout.trim();
  return {
    repository,
    root,
    context: {
      runId: 'runtime-1',
      principal: 'user:mike',
      policyScope: 'development',
      profileName: 'default',
      task: {
        schemaVersion: 1,
        repositoryRef: 'repo-fixture',
        baseRevision: base,
        goal: 'add sum',
        constraints: [],
        acceptanceCriteria: ['node --test passes'],
        allowedPaths: ['src', 'test'],
        budget: {
          timeoutSeconds: 300,
          maxTurns: 20,
          maxRawEvents: 2_000,
          maxRawBytes: 4 * 1024 * 1024,
          maxRawChunkBytes: 64 * 1024,
        },
        redaction: { secretNames: [], redactHostPaths: true },
      },
    },
  };
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await pool.query('TRUNCATE capability_run_projection, capability_payloads, events');
});

describe('segmented coding capability runtime', () => {
  it('prepares, executes, collects and succeeds without changing main checkout', async () => {
    const data = await fixture();
    const create: CapabilityRunCommand = {
      kind: 'create',
      eventId: 'event:create:runtime-1',
      commandId: 'create:runtime-1',
      runId: data.context.runId,
      principal: data.context.principal,
      policyScope: data.context.policyScope,
      source: { rel: 'software-change:main', action: 'start-implementation', eventId: 'core:1' },
      profileName: 'default',
      task: data.context.task,
    };
    await appendCapabilityRunCommand(pool, create);
    const deps: CodingRuntimeDeps = {
      db: pool,
      repositoryRegistry: JSON.stringify({
        'repo-fixture': {
          path: data.repository,
          scopes: ['development'],
          allowedPaths: ['src', 'test'],
        },
      }),
      workspaceRoot: data.root,
      profiles: [profile],
      heartbeat: () => undefined,
      probe: async () => ({ available: true }),
      execute: async (input: CodexExecutionInput, callbacks: CodexExecutionDeps) => {
        await callbacks.onRaw({ type: 'thread.started', thread_id: 'thread-1' }, '1');
        await callbacks.onNormalized({
          schemaVersion: 1,
          eventId: 'n1',
          runId: input.runId,
          sequence: 1,
          kind: 'run-started',
          nativeSessionId: 'thread-1',
        });
        await mkdir(join(input.workspace.path, 'src'), { recursive: true });
        await writeFile(
          join(input.workspace.path, 'src', 'sum.js'),
          'export const sum=(a,b)=>a+b;\n',
        );
        await callbacks.onRaw({ type: 'command', command: 'node --test' }, '2');
        await callbacks.onNormalized({
          schemaVersion: 1,
          eventId: 'n2',
          runId: input.runId,
          sequence: 2,
          kind: 'command-started',
          commandId: 'cmd-1',
          summary: 'node --test',
        });
        await callbacks.onNormalized({
          schemaVersion: 1,
          eventId: 'n3',
          runId: input.runId,
          sequence: 3,
          kind: 'command-completed',
          commandId: 'cmd-1',
          exitCode: 0,
        });
        return {
          nativeSessionId: 'thread-1',
          claim: {
            status: 'completed' as const,
            summary: 'done',
            tests: ['node --test: 1 passed, 0 failed'],
            changedFiles: ['src/sum.js'],
          },
        };
      },
    };
    const prepared = await prepareCodingRunWithDeps(data.context, deps);
    const outcome = await executeCodingRunWithDeps(data.context, prepared, deps);
    if (outcome.status !== 'succeeded') throw new Error(outcome.reason);
    expect(outcome).toMatchObject({ status: 'succeeded' });
    expect((await getCapabilityRun(pool, 'runtime-1', 'user:mike', 'development'))?.status).toBe(
      'succeeded',
    );
    expect(await readFile(join(data.repository, 'README.md'), 'utf8')).toBe('main\n');
    expect((await runFile('git', ['-C', data.repository, 'status', '--porcelain'])).stdout).toBe(
      '',
    );
  });
});
