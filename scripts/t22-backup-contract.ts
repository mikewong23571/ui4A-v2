import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type DeploymentEnvironment = 'compose' | 'kubernetes';
export type BackupState = 'incomplete' | 'completed';
export type BackupArtifactKind = 'database' | 'runtime' | 'realm' | 'pki' | 'private-config';

export interface QuiescenceReceipt {
  verified: true;
  quiescedAt: string;
  eventHighWaterMark: number;
  stopped: {
    web: true;
    worker: true;
    runner: true;
    keycloak: true;
    temporal: true;
  };
}

export interface BackupArtifact {
  kind: BackupArtifactKind;
  ref: string;
  digest: string;
  bytes: number;
  private: boolean;
}

export interface BackupManifest {
  schemaVersion: 1;
  backupId: string;
  state: BackupState;
  release: 'v0.1.0-experimental.1';
  gitSha: string;
  environment: DeploymentEnvironment;
  postgresMajor: 17;
  startedAt: string;
  finishedAt?: string;
  singleReplica: true;
  ha: false;
  strategy: 'quiesced-pg-dump';
  quiescenceReceipt: QuiescenceReceipt;
  artifacts: BackupArtifact[];
  checksums: Record<string, string>;
}

export interface BackupPlan {
  backupId: string;
  stagingDirectoryName: string;
  completedDirectoryName: string;
  manifest: BackupManifest;
}

export interface ProcessCommand {
  executable: 'pg_dump' | 'pg_restore' | 'tar';
  args: string[];
  outputPath?: string;
  environment: Record<string, string>;
}

export interface CommandResult {
  exitCode: 0 | 1;
  output: {
    status: 'completed' | 'failed';
    backupId: string;
    manifestPath?: string;
    reasonCode?: string;
  };
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const REQUIRED_DATABASE_REFS = [
  'databases/ui4a.dump',
  'databases/keycloak.dump',
  'databases/temporal.dump',
  'databases/temporal_visibility.dump',
] as const;
const DATABASE_NAMES = ['ui4a', 'keycloak', 'temporal', 'temporal_visibility'] as const;
const REQUIRED_STOPPED_SERVICES = ['web', 'worker', 'runner', 'keycloak', 'temporal'] as const;

function fail(message: string): never {
  throw new Error(message);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeRef(ref: string): boolean {
  return (
    ref !== '' &&
    !isAbsolute(ref) &&
    !ref.includes('\\') &&
    ref.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function safeRoot(path: string): string {
  if (!isAbsolute(path)) fail('BACKUP_OUTPUT_ROOT_UNSAFE');
  const normalized = resolve(path);
  if (normalized === resolve('/') || normalized === resolve(homedir())) {
    fail('BACKUP_OUTPUT_ROOT_UNSAFE');
  }
  return normalized;
}

function safeSourceRoot(path: string): string {
  if (!isAbsolute(path)) fail('BACKUP_ARCHIVE_SOURCE_UNSAFE');
  const normalized = resolve(path);
  if (normalized === resolve('/') || normalized === resolve(homedir())) {
    fail('BACKUP_ARCHIVE_SOURCE_UNSAFE');
  }
  return normalized;
}

function canonicalTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) fail('BACKUP_TIME_INVALID');
  return value.replace(/[-:]/g, '').replace('.000', '');
}

function requireQuiescenceReceipt(value: unknown): QuiescenceReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('BACKUP_QUIESCENCE_INVALID');
  }
  const receipt = value as Record<string, unknown>;
  const stopped = receipt.stopped;
  if (
    receipt.verified !== true ||
    typeof receipt.quiescedAt !== 'string' ||
    !Number.isSafeInteger(receipt.eventHighWaterMark) ||
    (receipt.eventHighWaterMark as number) < 0 ||
    typeof stopped !== 'object' ||
    stopped === null ||
    Array.isArray(stopped)
  ) {
    fail('BACKUP_QUIESCENCE_INVALID');
  }
  try {
    canonicalTimestamp(receipt.quiescedAt);
  } catch {
    fail('BACKUP_QUIESCENCE_INVALID');
  }
  const stoppedRecord = stopped as Record<string, unknown>;
  if (
    Object.keys(stoppedRecord).sort().join(',') !==
      [...REQUIRED_STOPPED_SERVICES].sort().join(',') ||
    REQUIRED_STOPPED_SERVICES.some((service) => stoppedRecord[service] !== true)
  ) {
    fail('BACKUP_QUIESCENCE_INVALID');
  }
  return {
    verified: true,
    quiescedAt: receipt.quiescedAt,
    eventHighWaterMark: receipt.eventHighWaterMark as number,
    stopped: {
      web: true,
      worker: true,
      runner: true,
      keycloak: true,
      temporal: true,
    },
  };
}

function validateArtifact(artifact: BackupArtifact): void {
  if (!safeRef(artifact.ref)) fail('BACKUP_ARTIFACT_REF_UNSAFE');
  if (!DIGEST_PATTERN.test(artifact.digest)) fail('BACKUP_ARTIFACT_DIGEST_INVALID');
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
    fail('BACKUP_ARTIFACT_SIZE_INVALID');
  }
}

function completeInventory(artifacts: readonly BackupArtifact[]): boolean {
  const refs = new Set(artifacts.map(({ ref }) => ref));
  return (
    REQUIRED_DATABASE_REFS.every((ref) => refs.has(ref)) &&
    ['coding', 'writing', 'authoring'].every((kind) =>
      artifacts.some(({ ref }) => ref.startsWith(`runtime/${kind}/`)),
    ) &&
    refs.has('identity/realm-import.json') &&
    refs.has('identity/deployment-bindings.json') &&
    artifacts.some(({ kind }) => kind === 'pki' && refs.has('private/pki.tar')) &&
    artifacts.some(
      ({ kind }) => kind === 'private-config' && refs.has('private/deployment-secrets.tar'),
    )
  );
}

/** Create the immutable naming and `.incomplete` staging contract without touching disk. */
export function createBackupPlan(input: {
  release: 'v0.1.0-experimental.1';
  gitSha: string;
  environment: DeploymentEnvironment;
  startedAt: string;
  postgresMajor: 17;
  quiescenceReceipt: QuiescenceReceipt;
}): BackupPlan {
  if (!/^[0-9a-f]{7,40}$/.test(input.gitSha)) fail('BACKUP_GIT_SHA_INVALID');
  const timestamp = canonicalTimestamp(input.startedAt);
  const backupId = `ui4a-${input.release}-${input.environment}-${timestamp}-${input.gitSha.slice(0, 7)}`;
  if (!SAFE_ID_PATTERN.test(backupId)) fail('BACKUP_ID_INVALID');
  const quiescenceReceipt = requireQuiescenceReceipt(input.quiescenceReceipt);
  const manifest: BackupManifest = {
    schemaVersion: 1,
    backupId,
    state: 'incomplete',
    release: input.release,
    gitSha: input.gitSha,
    environment: input.environment,
    postgresMajor: input.postgresMajor,
    startedAt: input.startedAt,
    singleReplica: true,
    ha: false,
    strategy: 'quiesced-pg-dump',
    quiescenceReceipt,
    artifacts: [],
    checksums: {},
  };
  return {
    backupId,
    stagingDirectoryName: `${backupId}.incomplete`,
    completedDirectoryName: backupId,
    manifest,
  };
}

/** Complete a manifest only when every bounded experimental backup component is present. */
export function completeBackup(input: {
  plan: BackupPlan;
  finishedAt: string;
  artifacts: BackupArtifact[];
}): BackupManifest {
  canonicalTimestamp(input.finishedAt);
  if (input.plan.manifest.state !== 'incomplete') fail('BACKUP_ALREADY_COMPLETED');
  requireQuiescenceReceipt(input.plan.manifest.quiescenceReceipt);
  const refs = new Set<string>();
  for (const artifact of input.artifacts) {
    validateArtifact(artifact);
    if (refs.has(artifact.ref)) fail('BACKUP_ARTIFACT_DUPLICATE');
    refs.add(artifact.ref);
  }
  if (!completeInventory(input.artifacts)) fail('BACKUP_INVENTORY_INCOMPLETE');
  const artifacts = input.artifacts
    .map((artifact) => ({ ...artifact }))
    .sort((left, right) => compareText(left.ref, right.ref));
  return {
    ...input.plan.manifest,
    state: 'completed',
    finishedAt: input.finishedAt,
    artifacts,
    checksums: Object.fromEntries(artifacts.map(({ ref, digest }) => [ref, digest])),
  };
}

/** Spawn one controlled command without shell parsing or exposing captured stderr. */
export function runProcessCommand(command: ProcessCommand): Promise<void> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command.executable, command.args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        ...command.environment,
      },
    });
    child.once('error', () => rejectCommand(new Error('BACKUP_PROCESS_FAILED')));
    child.once('exit', (code) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error('BACKUP_PROCESS_FAILED'));
    });
  });
}

function artifactKind(ref: string): BackupArtifactKind {
  if (ref.startsWith('databases/')) return 'database';
  if (ref.startsWith('runtime/')) return 'runtime';
  if (ref.startsWith('identity/')) return 'realm';
  if (ref === 'private/pki.tar') return 'pki';
  return 'private-config';
}

async function hashArtifact(root: string, ref: string): Promise<BackupArtifact> {
  const path = join(root, ref);
  const [content, metadata] = await Promise.all([readFile(path), stat(path)]);
  if (!metadata.isFile()) fail('BACKUP_ARTIFACT_NOT_FILE');
  return {
    kind: artifactKind(ref),
    ref,
    digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    bytes: content.byteLength,
    private:
      ref.startsWith('databases/') || ref.startsWith('runtime/') || ref.startsWith('private/'),
  };
}

function sanitizeExecutionManifest(
  manifest: Record<string, unknown>,
  backupId: string,
  finishedAt: string,
): Omit<BackupManifest, 'artifacts' | 'checksums'> {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.backupId !== backupId ||
    manifest.state !== 'incomplete' ||
    manifest.release !== 'v0.1.0-experimental.1' ||
    typeof manifest.gitSha !== 'string' ||
    !/^[0-9a-f]{7,40}$/.test(manifest.gitSha) ||
    (manifest.environment !== 'compose' && manifest.environment !== 'kubernetes') ||
    manifest.postgresMajor !== 17 ||
    typeof manifest.startedAt !== 'string' ||
    manifest.singleReplica !== true ||
    manifest.ha !== false ||
    manifest.strategy !== 'quiesced-pg-dump'
  ) {
    fail('BACKUP_MANIFEST_INVALID');
  }
  canonicalTimestamp(manifest.startedAt);
  canonicalTimestamp(finishedAt);
  const quiescenceReceipt = requireQuiescenceReceipt(manifest.quiescenceReceipt);
  return {
    schemaVersion: 1,
    backupId,
    state: 'completed',
    release: manifest.release,
    gitSha: manifest.gitSha,
    environment: manifest.environment,
    postgresMajor: 17,
    startedAt: manifest.startedAt,
    finishedAt,
    singleReplica: true,
    ha: false,
    strategy: 'quiesced-pg-dump',
    quiescenceReceipt,
  };
}

/** Execute a generic four-database backup seam with bounded staged and archive inventory hooks. */
export async function executeBackupCommand(input: {
  outputRoot: string;
  backupId: string;
  manifest: Record<string, unknown>;
  finishedAt: string;
  databaseServices: Record<'ui4a' | 'keycloak' | 'temporal' | 'temporal_visibility', string>;
  pgPassFileRef: string;
  prestagedArtifacts: Array<{ ref: string; content: string }>;
  archiveSources?: Array<{ ref: string; sourceRoot: string; entry: string }>;
  run?: (command: ProcessCommand) => Promise<void>;
}): Promise<CommandResult> {
  try {
    requireQuiescenceReceipt(input.manifest.quiescenceReceipt);
  } catch {
    return {
      exitCode: 1,
      output: {
        status: 'failed',
        backupId: input.backupId,
        reasonCode: 'BACKUP_QUIESCENCE_INVALID',
      },
    };
  }
  const root = safeRoot(input.outputRoot);
  if (!SAFE_ID_PATTERN.test(input.backupId)) fail('BACKUP_ID_INVALID');
  const staging = join(root, `${input.backupId}.incomplete`);
  const completed = join(root, input.backupId);
  const run = input.run ?? runProcessCommand;
  let movedToCompleted = false;
  try {
    const executionManifest = sanitizeExecutionManifest(
      input.manifest,
      input.backupId,
      input.finishedAt,
    );
    await mkdir(staging, { recursive: false, mode: 0o700 });
    if (
      Object.keys(input.databaseServices).sort().join(',') !== [...DATABASE_NAMES].sort().join(',')
    ) {
      fail('BACKUP_DATABASE_SET_INVALID');
    }
    for (const database of DATABASE_NAMES) {
      const service = input.databaseServices[database];
      if (!/^[A-Za-z0-9._-]+$/.test(service)) fail('BACKUP_DATABASE_SERVICE_INVALID');
      const ref = `databases/${database}.dump`;
      const outputPath = join(staging, ref);
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
      await run({
        executable: 'pg_dump',
        args: [
          '--format=custom',
          '--no-owner',
          '--no-acl',
          `--file=${outputPath}`,
          `service=${service}`,
        ],
        outputPath,
        environment: { PGPASSFILE: input.pgPassFileRef },
      });
    }
    for (const archive of input.archiveSources ?? []) {
      if (
        !safeRef(archive.ref) ||
        archive.ref.startsWith('databases/') ||
        !safeRef(archive.entry)
      ) {
        fail('BACKUP_ARCHIVE_REF_UNSAFE');
      }
      const sourceRoot = safeSourceRoot(archive.sourceRoot);
      const outputPath = join(staging, archive.ref);
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
      await run({
        executable: 'tar',
        args: [
          '--create',
          `--file=${outputPath}`,
          `--directory=${sourceRoot}`,
          '--',
          archive.entry,
        ],
        outputPath,
        environment: {},
      });
    }
    for (const artifact of input.prestagedArtifacts) {
      if (!safeRef(artifact.ref) || artifact.ref.startsWith('databases/')) {
        fail('BACKUP_ARTIFACT_REF_UNSAFE');
      }
      const path = join(staging, artifact.ref);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, artifact.content, { encoding: 'utf8', mode: 0o600 });
    }
    const refs = [
      ...DATABASE_NAMES.map((database) => `databases/${database}.dump`),
      ...(input.archiveSources ?? []).map(({ ref }) => ref),
      ...input.prestagedArtifacts.map(({ ref }) => ref),
    ].sort();
    if (new Set(refs).size !== refs.length) fail('BACKUP_ARTIFACT_DUPLICATE');
    const artifacts = await Promise.all(refs.map((ref) => hashArtifact(staging, ref)));
    if (!completeInventory(artifacts)) fail('BACKUP_INVENTORY_INCOMPLETE');
    const checksums = Object.fromEntries(artifacts.map(({ ref, digest }) => [ref, digest]));
    const manifest = {
      ...executionManifest,
      artifacts,
      checksums,
    };
    await writeFile(
      join(staging, 'manifest.json.incomplete'),
      `${JSON.stringify({ ...manifest, state: 'incomplete', finishedAt: undefined }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await writeFile(
      join(staging, 'manifest.json.pending'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
    await rename(staging, completed);
    movedToCompleted = true;
    await unlink(join(completed, 'manifest.json.incomplete'));
    await rename(join(completed, 'manifest.json.pending'), join(completed, 'manifest.json'));
    return {
      exitCode: 0,
      output: {
        status: 'completed',
        backupId: input.backupId,
        manifestPath: join(completed, 'manifest.json'),
      },
    };
  } catch {
    if (movedToCompleted) {
      try {
        await rename(completed, staging);
      } catch {
        // Absence of manifest.json still prevents an incomplete target from being accepted.
      }
    }
    return {
      exitCode: 1,
      output: { status: 'failed', backupId: input.backupId, reasonCode: 'BACKUP_COMMAND_FAILED' },
    };
  }
}
