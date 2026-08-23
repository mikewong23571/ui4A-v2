import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import type { CodingExecutorProfile, CodingNormalizedEvent, CodingTask } from '@ui4a/shared';

import { executeCodexTask, probeCodexExecutor } from './codex';

const runFile = promisify(execFile);
const enabled = process.env.RUN_T18_CODEX === '1';

it.skipIf(!enabled)(
  'real Codex edits and tests a disposable repository through the reference adapter',
  { timeout: 120_000 },
  async () => {
    const descriptor = await probeCodexExecutor('real');
    expect(descriptor.available, descriptor.reason).toBe(true);
    const repository = await mkdtemp(join(tmpdir(), 'ui4a-real-codex-'));
    await runFile('git', ['init', '-q', repository]);
    await runFile('git', ['-C', repository, 'config', 'user.email', 'fixture@ui4a.dev']);
    await runFile('git', ['-C', repository, 'config', 'user.name', 'UI4A Fixture']);
    await writeFile(
      join(repository, 'package.json'),
      JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2),
    );
    await writeFile(join(repository, 'README.md'), 'Implement src/sum.js and test/sum.test.js.\n');
    await runFile('git', ['-C', repository, 'add', '.']);
    await runFile('git', ['-C', repository, 'commit', '-qm', 'seed']);
    const baseRevision = (
      await runFile('git', ['-C', repository, 'rev-parse', 'HEAD'])
    ).stdout.trim();
    const task: CodingTask = {
      schemaVersion: 1,
      repositoryRef: 'real-fixture',
      baseRevision,
      goal: 'Implement a sum(a, b) function in src/sum.js and tests in test/sum.test.js.',
      constraints: ['Use no dependencies', 'Do not commit or modify README.md'],
      acceptanceCriteria: ['npm test passes'],
      allowedPaths: ['src', 'test'],
      budget: {
        timeoutSeconds: 90,
        maxTurns: 20,
        maxRawEvents: 2_000,
        maxRawBytes: 4 * 1024 * 1024,
        maxRawChunkBytes: 64 * 1024,
      },
      redaction: { secretNames: [], redactHostPaths: true },
    };
    const profile: CodingExecutorProfile = {
      name: 'real',
      executorClass: 'coding-agent',
      providerId: 'codex',
      transport: 'sdk',
      workspaceBackend: 'isolated-worktree',
      sandbox: 'workspace-write',
      timeoutSeconds: 90,
      maxTurns: 20,
      envAllowlist: ['PATH', 'HOME', 'CODEX_HOME'],
      networkPolicy: 'none',
    };
    const normalized: CodingNormalizedEvent[] = [];
    const output = await executeCodexTask(
      { runId: 'real-run', task, profile, workspace: { id: 'real-workspace', path: repository } },
      { onRaw: async () => undefined, onNormalized: async (event) => void normalized.push(event) },
    );
    expect(output.claim.status).toBe('completed');
    expect(normalized.some((event) => event.kind === 'files-changed')).toBe(true);
    const tests = await runFile('npm', ['test'], { cwd: repository, timeout: 30_000 });
    expect(tests.stdout + tests.stderr).toContain('pass');
    expect((await runFile('git', ['-C', repository, 'status', '--porcelain'])).stdout).toContain(
      'src/',
    );
  },
);
