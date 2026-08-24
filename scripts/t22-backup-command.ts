import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createBackupPlan,
  executeBackupCommand,
  type ProcessCommand,
  type QuiescenceReceipt,
} from './t22-backup-contract';

const requestEnvironmentVariable = 'UI4A_BACKUP_REQUEST_FILE';
const maximumRequestBytes = 1024 * 1024;

interface BackupCliRequest {
  gitSha: string;
  startedAt: string;
  finishedAt: string;
  outputRoot: string;
  quiescenceReceipt: QuiescenceReceipt;
  databaseServices: Record<'ui4a' | 'keycloak' | 'temporal' | 'temporal_visibility', string>;
  pgPassFileRef: string;
  prestagedArtifacts: Array<{ ref: string; content: string }>;
  archiveSources?: Array<{ ref: string; sourceRoot: string; entry: string }>;
}

export interface BackupCliDependencies {
  execute(input: {
    outputRoot: string;
    backupId: string;
    manifest: Record<string, unknown>;
    finishedAt: string;
    databaseServices: BackupCliRequest['databaseServices'];
    pgPassFileRef: string;
    prestagedArtifacts: BackupCliRequest['prestagedArtifacts'];
    archiveSources?: BackupCliRequest['archiveSources'];
    run?: (command: ProcessCommand) => Promise<void>;
  }): ReturnType<typeof executeBackupCommand>;
  readRequest(path: string): unknown;
}

export type BackupCliResult =
  | { ok: true; status: 'completed'; backupId: string; manifestPath?: string }
  | { ok: false; code: string };

function readPrivateRequest(path: string): unknown {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('BACKUP_REQUEST_INVALID');
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const facts = fstatSync(descriptor);
    if (
      !facts.isFile() ||
      facts.size === 0 ||
      facts.size > maximumRequestBytes ||
      (facts.mode & 0o077) !== 0
    ) {
      throw new Error('BACKUP_REQUEST_INVALID');
    }
    return JSON.parse(readFileSync(descriptor, 'utf8'));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function request(value: unknown): BackupCliRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('BACKUP_REQUEST_INVALID');
  }
  return value as BackupCliRequest;
}

const productionDependencies: BackupCliDependencies = {
  execute: executeBackupCommand,
  readRequest: readPrivateRequest,
};

export async function executeBackupCli(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: BackupCliDependencies = productionDependencies,
): Promise<BackupCliResult> {
  if (argv.join('\0') !== ['backup', '--environment', 'compose'].join('\0')) {
    return { ok: false, code: 'BACKUP_USAGE_INVALID' };
  }
  const requestPath = environment[requestEnvironmentVariable];
  if (requestPath === undefined) return { ok: false, code: 'BACKUP_REQUEST_INVALID' };
  try {
    const input = request(dependencies.readRequest(requestPath));
    const plan = createBackupPlan({
      release: 'v0.1.0-experimental.1',
      gitSha: input.gitSha,
      environment: 'compose',
      startedAt: input.startedAt,
      postgresMajor: 17,
      quiescenceReceipt: input.quiescenceReceipt,
    });
    const result = await dependencies.execute({
      outputRoot: input.outputRoot,
      backupId: plan.backupId,
      manifest: plan.manifest,
      finishedAt: input.finishedAt,
      databaseServices: input.databaseServices,
      pgPassFileRef: input.pgPassFileRef,
      prestagedArtifacts: input.prestagedArtifacts,
      ...(input.archiveSources === undefined ? {} : { archiveSources: input.archiveSources }),
    });
    if (result.exitCode !== 0) {
      return { ok: false, code: result.output.reasonCode ?? 'BACKUP_COMMAND_FAILED' };
    }
    return {
      ok: true,
      status: 'completed',
      backupId: result.output.backupId,
      ...(result.output.manifestPath === undefined
        ? {}
        : { manifestPath: result.output.manifestPath }),
    };
  } catch {
    return { ok: false, code: 'BACKUP_REQUEST_INVALID' };
  }
}

async function main(): Promise<void> {
  const result = await executeBackupCli(process.argv.slice(2), process.env);
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (directEntry === import.meta.url) {
  void main().catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'BACKUP_COMMAND_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
