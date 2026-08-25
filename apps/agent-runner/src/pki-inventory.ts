import { execFile } from 'node:child_process';
import { access, mkdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const RUNNER_PKI_FILES = {
  rootCertificate: 'root-ca.crt',
  rootPrivateKey: 'root-ca.key',
  ui4aCertificate: 'ui4a/tls.crt',
  ui4aPrivateKey: 'ui4a/tls.key',
  keycloakCertificate: 'keycloak/tls.crt',
  keycloakPrivateKey: 'keycloak/tls.key',
  postgresCertificate: 'postgres/server.crt',
  postgresPrivateKey: 'postgres/server.key',
} as const;

export type RunnerPkiFileId = keyof typeof RUNNER_PKI_FILES;

export interface PkiProcessResult {
  stdout: string;
}

export type PkiProcessRunner = (
  executable: 'openssl',
  args: readonly string[],
) => Promise<PkiProcessResult>;

export interface RunnerPkiResult {
  status: 'created' | 'reused';
  rootDirectory: string;
  files: Array<{
    id: RunnerPkiFileId;
    path: string;
    sha256: string;
    mode: 0o600 | 0o644;
  }>;
  postgresHandoff: {
    certificatePath: string;
    privateKeyPath: string;
    certificateMode: 0o644;
    privateKeyMode: 0o600;
    ownership: 'deployment-adapter-copy-init';
  };
}

export interface RunnerPkiInput {
  rootDirectory: string;
  ui4aHost: string;
  keycloakHost: string;
  postgresHost: string;
  processRunner?: PkiProcessRunner;
  edgeUid?: number;
  edgeGid?: number;
}

export const ROOT_COMMON_NAME = 'UI4A Experimental Internal CA';
export const COMPLETE_MARKER = '.ui4a-pki-complete.json';
export const LOCK_DIRECTORY = '.ui4a-pki-init.lock';
export const MATERIAL_IDS = Object.keys(RUNNER_PKI_FILES) as RunnerPkiFileId[];
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export function fail(code: string): never {
  throw new Error(code);
}

export function expectedMode(id: RunnerPkiFileId): 0o600 | 0o644 {
  return id.endsWith('PrivateKey') ? 0o600 : 0o644;
}

export function safeRootDirectory(path: string): string {
  if (!isAbsolute(path)) fail('PKI_CONFIGURATION_INVALID');
  const normalized = resolve(path);
  if (normalized === '/') fail('PKI_CONFIGURATION_INVALID');
  return normalized;
}

export function requireHost(host: string): string {
  if (
    !HOST_PATTERN.test(host) ||
    host.includes('..') ||
    host === 'localhost' ||
    host.startsWith('127.')
  ) {
    fail('PKI_CONFIGURATION_INVALID');
  }
  return host;
}

export const runOpenSsl: PkiProcessRunner = async (executable, args) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      executable,
      [...args],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, shell: false },
      (error, stdout) => {
        if (error === null) resolvePromise({ stdout });
        else rejectPromise(error);
      },
    );
  });

export async function runCommand(runner: PkiProcessRunner, args: readonly string[]): Promise<void> {
  try {
    await runner('openssl', args);
  } catch {
    fail('PKI_OPENSSL_FAILED');
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function ensureWritableRoot(rootDirectory: string): Promise<void> {
  try {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
    await access(rootDirectory, constants.W_OK);
  } catch {
    fail('PKI_ROOT_NOT_WRITABLE');
  }
}

export async function inventoryState(
  rootDirectory: string,
): Promise<'empty' | 'complete' | 'partial'> {
  const present = await Promise.all(
    MATERIAL_IDS.map((id) => pathExists(join(rootDirectory, RUNNER_PKI_FILES[id]))),
  );
  const marker = await pathExists(join(rootDirectory, COMPLETE_MARKER));
  const count = present.filter(Boolean).length;
  if (count === 0 && !marker) return 'empty';
  if (count === MATERIAL_IDS.length && marker) return 'complete';
  return 'partial';
}
