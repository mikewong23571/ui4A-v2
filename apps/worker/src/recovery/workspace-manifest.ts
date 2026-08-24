export type WorkspaceSha256 = `sha256:${string}`;
export type PortableOperationKind = 'git-bundle' | 'tracked-patch' | 'untracked-archive';
export type RunWorkspaceEntryType =
  'regular-file' | 'directory' | 'symlink' | 'device' | 'fifo' | 'socket';

export type WorkspaceManifestErrorCode =
  | 'WORKSPACE_ARTIFACT_INVALID'
  | 'WORKSPACE_DIRECT_ARCHIVE_FORBIDDEN'
  | 'WORKSPACE_ENTRY_DUPLICATE'
  | 'WORKSPACE_ENTRY_TYPE_UNSAFE'
  | 'WORKSPACE_IDENTITY_INVALID'
  | 'WORKSPACE_PATH_NOT_ALLOWED'
  | 'WORKSPACE_PATH_UNSAFE';

export class WorkspaceManifestError extends Error {
  constructor(readonly code: WorkspaceManifestErrorCode) {
    super(code);
    this.name = 'WorkspaceManifestError';
  }
}

export interface CodingWorkspaceInput {
  runId: string;
  archiveStrategy: 'portable-git';
  repositoryRef: string;
  baseSha: string;
  branch: string;
  mainCheckoutFingerprint: WorkspaceSha256;
  allowedUntrackedPaths: string[];
  untrackedPaths: string[];
}

export interface PortableOperation {
  kind: PortableOperationKind;
  output: 'base.bundle' | 'tracked.patch' | 'untracked.tar';
  baseSha?: string;
  paths?: string[];
}

export interface CodingWorkspaceArchivePlan {
  schemaVersion: 1;
  strategy: 'portable-git';
  operations: PortableOperation[];
}

export interface CapturedArtifact {
  sha256: WorkspaceSha256;
  sizeBytes: number;
  mode: number;
}

export interface CodingWorkspaceArtifact extends CapturedArtifact {
  kind: 'base-bundle' | 'tracked-patch' | 'untracked-archive';
  path: 'base.bundle' | 'tracked.patch' | 'untracked.tar';
}

export interface CodingWorkspaceManifest extends CodingWorkspaceArchivePlan {
  kind: 'coding-workspace';
  runId: string;
  repositoryRef: string;
  baseSha: string;
  branch: string;
  mainCheckoutFingerprint: WorkspaceSha256;
  artifacts: CodingWorkspaceArtifact[];
}

export interface RunWorkspaceEntry {
  path: string;
  type: RunWorkspaceEntryType;
  sha256: WorkspaceSha256;
  sizeBytes: number;
  mode: number;
}

export interface RunWorkspaceManifest {
  schemaVersion: 1;
  kind: 'run-workspace';
  specialization: 'writing' | 'authoring';
  runId: string;
  entries: Array<RunWorkspaceEntry & { type: 'regular-file' | 'directory' }>;
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FULL_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const REPOSITORY_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function fail(code: WorkspaceManifestErrorCode): never {
  throw new WorkspaceManifestError(code);
}

function safePortablePath(value: string): string {
  const parts = value.split('/');
  if (
    value === '' ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail('WORKSPACE_PATH_UNSAFE');
  }
  return value;
}

function safeBranch(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !/[\\\s~^:?*[\]]/u.test(value) &&
    value.split('/').every((part) => part !== '' && part !== '.')
  );
}

function assertCodingIdentity(input: CodingWorkspaceInput): void {
  if (
    !RUN_ID_PATTERN.test(input.runId) ||
    !REPOSITORY_REF_PATTERN.test(input.repositoryRef) ||
    !FULL_COMMIT_PATTERN.test(input.baseSha) ||
    !safeBranch(input.branch) ||
    !SHA256_PATTERN.test(input.mainCheckoutFingerprint)
  ) {
    fail('WORKSPACE_IDENTITY_INVALID');
  }
}

function pathAllowed(path: string, allowedPaths: readonly string[]): boolean {
  return allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

function assertArtifact(value: CapturedArtifact): CapturedArtifact {
  if (
    !SHA256_PATTERN.test(value.sha256) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 0 ||
    !Number.isInteger(value.mode) ||
    value.mode < 0 ||
    value.mode > 0o777
  ) {
    fail('WORKSPACE_ARTIFACT_INVALID');
  }
  return { sha256: value.sha256, sizeBytes: value.sizeBytes, mode: value.mode };
}

/**
 * Plan a portable Coding recovery inventory. A linked worktree itself is never an archive source;
 * only the exact base bundle, tracked patch, and allowlisted untracked paths cross environments.
 */
export function planCodingWorkspaceArchive(
  input: CodingWorkspaceInput,
): CodingWorkspaceArchivePlan {
  if (input.archiveStrategy !== 'portable-git') fail('WORKSPACE_DIRECT_ARCHIVE_FORBIDDEN');
  assertCodingIdentity(input);
  const allowedPaths = input.allowedUntrackedPaths.map(safePortablePath);
  const untrackedPaths = [...new Set(input.untrackedPaths.map(safePortablePath))].sort();
  if (untrackedPaths.some((path) => !pathAllowed(path, allowedPaths))) {
    fail('WORKSPACE_PATH_NOT_ALLOWED');
  }
  return {
    schemaVersion: 1,
    strategy: 'portable-git',
    operations: [
      { kind: 'git-bundle', output: 'base.bundle', baseSha: input.baseSha },
      { kind: 'tracked-patch', output: 'tracked.patch', baseSha: input.baseSha },
      { kind: 'untracked-archive', output: 'untracked.tar', paths: untrackedPaths },
    ],
  };
}

function artifactIdentity(
  operation: PortableOperation,
): Pick<CodingWorkspaceArtifact, 'kind' | 'path'> {
  switch (operation.kind) {
    case 'git-bundle':
      return { kind: 'base-bundle', path: 'base.bundle' };
    case 'tracked-patch':
      return { kind: 'tracked-patch', path: 'tracked.patch' };
    case 'untracked-archive':
      return { kind: 'untracked-archive', path: 'untracked.tar' };
  }
}

/** Materialize deterministic Coding recovery metadata through an injected, side-effect-owned executor. */
export async function createCodingWorkspaceManifest(
  input: CodingWorkspaceInput,
  executor: { capture(operation: PortableOperation): Promise<CapturedArtifact> },
): Promise<CodingWorkspaceManifest> {
  const plan = planCodingWorkspaceArchive(input);
  const artifacts: CodingWorkspaceArtifact[] = [];
  for (const operation of plan.operations) {
    const evidence = assertArtifact(await executor.capture({ ...operation }));
    artifacts.push({ ...artifactIdentity(operation), ...evidence });
  }
  return {
    ...plan,
    kind: 'coding-workspace',
    runId: input.runId,
    repositoryRef: input.repositoryRef,
    baseSha: input.baseSha,
    branch: input.branch,
    mainCheckoutFingerprint: input.mainCheckoutFingerprint,
    artifacts,
  };
}

/** Create a content-free, portable Writing or Authoring run inventory. */
export function createRunWorkspaceManifest(input: {
  specialization: 'writing' | 'authoring';
  runId: string;
  entries: RunWorkspaceEntry[];
}): RunWorkspaceManifest {
  if (
    (input.specialization !== 'writing' && input.specialization !== 'authoring') ||
    !RUN_ID_PATTERN.test(input.runId)
  ) {
    fail('WORKSPACE_IDENTITY_INVALID');
  }
  const entries = input.entries.map((entry) => {
    const path = safePortablePath(entry.path);
    if (entry.type !== 'regular-file' && entry.type !== 'directory') {
      fail('WORKSPACE_ENTRY_TYPE_UNSAFE');
    }
    const artifact = assertArtifact(entry);
    return { path, type: entry.type, ...artifact };
  });
  const paths = new Set<string>();
  for (const entry of entries) {
    if (paths.has(entry.path)) fail('WORKSPACE_ENTRY_DUPLICATE');
    paths.add(entry.path);
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    schemaVersion: 1,
    kind: 'run-workspace',
    specialization: input.specialization,
    runId: input.runId,
    entries,
  };
}
