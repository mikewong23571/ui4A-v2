import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export interface RepositoryRegistryEntry {
  path: string;
  scopes: string[];
  allowedPaths: string[];
}

export type RepositoryRegistry = Record<string, RepositoryRegistryEntry>;

export interface GitWorkspaceHandle {
  id: string;
  repositoryRef: string;
  repositoryPath: string;
  path: string;
  branch: string;
  baseRevision: string;
  mainCheckoutFingerprint: string;
}

export interface CollectedGitWorkspace {
  baseRevision: string;
  headRevision: string;
  changedFiles: string[];
  patch: string;
  patchHash: string;
  mainCheckoutFingerprint: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeAbsolutePath(path: string, label: string): string {
  if (!isAbsolute(path) || path.includes('$') || path.includes('~')) {
    throw new Error(`${label} must be a resolved absolute path`);
  }
  const normalized = resolve(path);
  if (
    normalized === '/' ||
    normalized === homedir() ||
    normalized.split(sep).filter(Boolean).length < 2
  ) {
    throw new Error(`${label} is too broad`);
  }
  return normalized;
}

/** Parse the deployment-owned repository registry. Request data never enters this parser. */
export function parseRepositoryRegistry(input: string): RepositoryRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(
      `repository registry is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!record(parsed)) throw new Error('repository registry must be an object');
  const registry: RepositoryRegistry = {};
  for (const [reference, value] of Object.entries(parsed)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(reference) || !record(value)) {
      throw new Error(`repository registry entry ${reference} is invalid`);
    }
    if (typeof value.path !== 'string' || !Array.isArray(value.scopes)) {
      throw new Error(`repository registry entry ${reference} requires path/scopes`);
    }
    if (value.scopes.some((scope) => typeof scope !== 'string' || scope === '')) {
      throw new Error(`repository registry entry ${reference} scopes are invalid`);
    }
    const allowed = value.allowedPaths ?? [];
    if (!Array.isArray(allowed) || allowed.some((path) => typeof path !== 'string')) {
      throw new Error(`repository registry entry ${reference} allowedPaths are invalid`);
    }
    registry[reference] = {
      path: safeAbsolutePath(value.path, `repository ${reference}`),
      scopes: [...value.scopes] as string[],
      allowedPaths: (allowed as string[]).map(normalizeAllowedPath),
    };
  }
  return registry;
}

function normalizeAllowedPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`allowed path ${path} is invalid`);
  }
  return normalized;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runFile('git', ['-C', cwd, ...args], {
    maxBuffer: 8 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      LANG: 'C.UTF-8',
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    },
  });
  return result.stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function checkoutFingerprint(repositoryPath: string): Promise<string> {
  const [head, statusText] = await Promise.all([
    git(repositoryPath, ['rev-parse', 'HEAD']),
    git(repositoryPath, ['status', '--porcelain=v1']),
  ]);
  return `sha256:${createHash('sha256').update(`${head.trim()}\n${statusText}`).digest('hex')}`;
}

/** Create or recover one UI4A-owned worktree lease at an exact full commit SHA. */
export async function prepareGitWorkspace(
  input: { runId: string; repositoryRef: string; baseRevision: string; policyScope: string },
  options: { registry: RepositoryRegistry; workspaceRoot: string },
): Promise<GitWorkspaceHandle> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(input.runId)) throw new Error('runId is invalid');
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.baseRevision)) {
    throw new Error('baseRevision must be a full commit SHA');
  }
  const entry = options.registry[input.repositoryRef];
  if (entry === undefined || !entry.scopes.includes(input.policyScope)) {
    throw new Error('repositoryRef is not authorized for policy scope');
  }
  const repositoryPath = await realpath(entry.path);
  const workspaceRoot = safeAbsolutePath(options.workspaceRoot, 'workspace root');
  await mkdir(workspaceRoot, { recursive: true });
  await git(repositoryPath, ['cat-file', '-e', `${input.baseRevision}^{commit}`]);
  const path = join(workspaceRoot, input.runId);
  const branch = `ui4a/run-${input.runId}`;
  const mainCheckoutFingerprint = await checkoutFingerprint(repositoryPath);
  if (!(await exists(path))) {
    await git(repositoryPath, ['worktree', 'add', '-b', branch, path, input.baseRevision]);
  } else {
    const [actualBranch, actualBase] = await Promise.all([
      git(path, ['branch', '--show-current']),
      git(path, ['rev-parse', input.baseRevision]),
    ]);
    if (actualBranch.trim() !== branch || actualBase.trim() !== input.baseRevision) {
      throw new Error('existing workspace lease does not match run');
    }
  }
  return {
    id: `workspace:${input.runId}`,
    repositoryRef: input.repositoryRef,
    repositoryPath,
    path,
    branch,
    baseRevision: input.baseRevision,
    mainCheckoutFingerprint,
  };
}

function pathAllowed(path: string, allowedPaths: readonly string[]): boolean {
  if (allowedPaths.length === 0) return true;
  return allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

async function assertNoSymlinkEscape(workspace: string, changedPath: string): Promise<void> {
  const absolute = join(workspace, changedPath);
  try {
    const info = await lstat(absolute);
    const realWorkspace = await realpath(workspace);
    const target = info.isSymbolicLink()
      ? await realpath(absolute)
      : await realpath(dirname(absolute));
    const outside = relative(realWorkspace, target);
    if (outside === '..' || outside.startsWith(`..${sep}`) || isAbsolute(outside)) {
      throw new Error(`changed path ${changedPath} escapes workspace`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Recompute result evidence from Git; Provider-reported files/tests never replace this evidence. */
export async function collectGitWorkspace(
  handle: GitWorkspaceHandle,
  allowedPaths: readonly string[],
): Promise<CollectedGitWorkspace> {
  const [head, trackedFiles, untrackedFiles, trackedPatch, mainFingerprint] = await Promise.all([
    git(handle.path, ['rev-parse', 'HEAD']),
    git(handle.path, ['diff', '--name-only', handle.baseRevision]),
    git(handle.path, ['ls-files', '--others', '--exclude-standard']),
    git(handle.path, ['diff', '--binary', handle.baseRevision]),
    checkoutFingerprint(handle.repositoryPath),
  ]);
  const changedFiles = [...new Set([...trackedFiles.split('\n'), ...untrackedFiles.split('\n')])]
    .map((path) => path.trim().replaceAll('\\', '/'))
    .filter(Boolean)
    .sort();
  for (const changedPath of changedFiles) {
    if (!pathAllowed(changedPath, allowedPaths)) {
      throw new Error(`changed path ${changedPath} is outside allowed paths`);
    }
    await assertNoSymlinkEscape(handle.path, changedPath);
  }
  const untrackedPayloads: string[] = [];
  for (const changedPath of untrackedFiles
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean)) {
    const bytes = await readFile(join(handle.path, changedPath));
    untrackedPayloads.push(`\n--- ui4a-untracked:${changedPath}:${bytes.toString('base64')}`);
  }
  const patch = `${trackedPatch}${untrackedPayloads.join('')}`;
  return {
    baseRevision: handle.baseRevision,
    headRevision: head.trim(),
    changedFiles,
    patch,
    patchHash: `sha256:${createHash('sha256').update(patch).digest('hex')}`,
    mainCheckoutFingerprint: mainFingerprint,
  };
}
