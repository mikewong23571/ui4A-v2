import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { collectGitWorkspace, parseRepositoryRegistry, prepareGitWorkspace } from './workspace';

const run = promisify(execFile);

async function fixture(): Promise<{ repository: string; root: string; base: string }> {
  const repository = await mkdtemp(join(tmpdir(), 'ui4a-coding-repo-'));
  const root = await mkdtemp(join(tmpdir(), 'ui4a-coding-workspaces-'));
  await run('git', ['init', '-q', repository]);
  await run('git', ['-C', repository, 'config', 'user.email', 'fixture@ui4a.dev']);
  await run('git', ['-C', repository, 'config', 'user.name', 'UI4A Fixture']);
  await writeFile(join(repository, 'README.md'), 'fixture\n', 'utf8');
  await run('git', ['-C', repository, 'add', 'README.md']);
  await run('git', ['-C', repository, 'commit', '-qm', 'seed']);
  const { stdout } = await run('git', ['-C', repository, 'rev-parse', 'HEAD']);
  return { repository, root, base: stdout.trim() };
}

describe('UI4A-owned Git workspace', () => {
  it('rejects malformed registry/path/base/run input before creating a worktree', async () => {
    expect(() => parseRepositoryRegistry('{"repo":"/"}')).toThrow('entry');
    expect(() => parseRepositoryRegistry('{"repo":{"path":"/","scopes":["development"]}}')).toThrow(
      'broad',
    );
    const data = await fixture();
    const registry = parseRepositoryRegistry(
      JSON.stringify({ repo: { path: data.repository, scopes: ['development'] } }),
    );
    await expect(
      prepareGitWorkspace(
        {
          runId: '../escape',
          repositoryRef: 'repo',
          baseRevision: data.base,
          policyScope: 'development',
        },
        { registry, workspaceRoot: data.root },
      ),
    ).rejects.toThrow('runId');
    await expect(
      prepareGitWorkspace(
        { runId: 'r1', repositoryRef: 'repo', baseRevision: 'HEAD', policyScope: 'development' },
        { registry, workspaceRoot: data.root },
      ),
    ).rejects.toThrow('full commit');
  });

  it('creates isolated branches, preserves main checkout and validates changed paths', async () => {
    const data = await fixture();
    const registry = parseRepositoryRegistry(
      JSON.stringify({
        repo: { path: data.repository, scopes: ['development'], allowedPaths: ['src', 'test'] },
      }),
    );
    const first = await prepareGitWorkspace(
      { runId: 'r1', repositoryRef: 'repo', baseRevision: data.base, policyScope: 'development' },
      { registry, workspaceRoot: data.root },
    );
    const second = await prepareGitWorkspace(
      { runId: 'r2', repositoryRef: 'repo', baseRevision: data.base, policyScope: 'development' },
      { registry, workspaceRoot: data.root },
    );
    expect(first.path).not.toBe(second.path);
    expect(first.branch).not.toBe(second.branch);

    await run('mkdir', ['-p', join(first.path, 'src')]);
    await writeFile(
      join(first.path, 'src', 'sum.ts'),
      'export const sum = (a:number,b:number)=>a+b;\n',
    );
    const collected = await collectGitWorkspace(first, ['src', 'test']);
    expect(collected.changedFiles).toEqual(['src/sum.ts']);
    expect(collected.patchHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await readFile(join(data.repository, 'README.md'), 'utf8')).toBe('fixture\n');
    expect((await run('git', ['-C', data.repository, 'status', '--porcelain'])).stdout).toBe('');

    await writeFile(join(first.path, 'outside.txt'), 'escape\n');
    await expect(collectGitWorkspace(first, ['src', 'test'])).rejects.toThrow('allowed paths');
  });

  it('is idempotent for the same run lease', async () => {
    const data = await fixture();
    const registry = parseRepositoryRegistry(
      JSON.stringify({ repo: { path: data.repository, scopes: ['development'] } }),
    );
    const input = {
      runId: 'retry-run',
      repositoryRef: 'repo',
      baseRevision: data.base,
      policyScope: 'development',
    };
    const first = await prepareGitWorkspace(input, { registry, workspaceRoot: data.root });
    const retry = await prepareGitWorkspace(input, { registry, workspaceRoot: data.root });
    expect(retry).toEqual(first);
  });
});
