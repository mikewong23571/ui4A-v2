import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  executeRestoreCommand,
  planIsolatedRestore,
  type RestoreInput,
} from './t22-restore-contract';

const requestEnvironmentVariable = 'UI4A_RESTORE_REQUEST_FILE';
const maximumRequestBytes = 1024 * 1024;

interface RestoreCliRequest {
  planInput: RestoreInput;
  backupRoot: string;
  targetDatabaseServices: Record<'ui4a' | 'keycloak' | 'temporal' | 'temporal_visibility', string>;
  pgPassFileRef: string;
}

export interface RestoreCliDependencies {
  execute(input: {
    backupId: string;
    backupRoot: string;
    targetDatabaseServices: RestoreCliRequest['targetDatabaseServices'];
    pgPassFileRef: string;
    validatedIsolatedPlan: { mode: 'isolated'; destructive: false; useCleanRestore: false };
  }): ReturnType<typeof executeRestoreCommand>;
  readRequest(path: string): unknown;
}

export type RestoreCliResult =
  { ok: true; status: 'completed'; backupId: string } | { ok: false; code: string };

function readPrivateRequest(path: string): unknown {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('RESTORE_REQUEST_INVALID');
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
      throw new Error('RESTORE_REQUEST_INVALID');
    }
    return JSON.parse(readFileSync(descriptor, 'utf8'));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function request(value: unknown): RestoreCliRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('RESTORE_REQUEST_INVALID');
  }
  return value as RestoreCliRequest;
}

const productionDependencies: RestoreCliDependencies = {
  execute: executeRestoreCommand,
  readRequest: readPrivateRequest,
};

export async function executeRestoreCli(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: RestoreCliDependencies = productionDependencies,
): Promise<RestoreCliResult> {
  if (argv.join('\0') !== ['restore', '--target', 'isolated'].join('\0')) {
    return { ok: false, code: 'RESTORE_USAGE_INVALID' };
  }
  const requestPath = environment[requestEnvironmentVariable];
  if (requestPath === undefined) return { ok: false, code: 'RESTORE_REQUEST_INVALID' };
  try {
    const input = request(dependencies.readRequest(requestPath));
    const plan = planIsolatedRestore(input.planInput);
    const result = await dependencies.execute({
      backupId: plan.backupId,
      backupRoot: input.backupRoot,
      targetDatabaseServices: input.targetDatabaseServices,
      pgPassFileRef: input.pgPassFileRef,
      validatedIsolatedPlan: plan,
    });
    if (result.exitCode !== 0) {
      return { ok: false, code: result.output.reasonCode ?? 'RESTORE_COMMAND_FAILED' };
    }
    return { ok: true, status: 'completed', backupId: result.output.backupId };
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : 'RESTORE_REQUEST_INVALID';
    return { ok: false, code };
  }
}

async function main(): Promise<void> {
  const result = await executeRestoreCli(process.argv.slice(2), process.env);
  const stream = result.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (directEntry === import.meta.url) {
  void main().catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'RESTORE_COMMAND_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
