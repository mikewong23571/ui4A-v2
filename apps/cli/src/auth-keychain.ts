import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { CredentialKey, CredentialStore, StoredCredential } from './auth-credential.js';
import { CliError } from './envelope.js';

const MAX_OUTPUT_BYTES = 64 * 1024;
const CHUNK_SIZE = 96;
const MAX_CHUNKS = 1024;

interface CredentialManifest {
  schemaVersion: 1;
  generation: string;
  chunks: number;
}

interface SecurityChild {
  stdin: { end(input?: string): void };
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void };
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): void };
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
  kill(): void;
}

export type SecurityProcessStarter = (args: string[]) => SecurityChild;

export type KeychainCommandRunner = (
  args: string[],
  stdin?: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export function createKeychainCommandRunner(
  start: SecurityProcessStarter = (args) =>
    spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] }),
): KeychainCommandRunner {
  return async (args, stdin) =>
    await new Promise((resolve, reject) => {
      const child = start(args);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) child.kill();
        else target.push(chunk);
      };
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.on('error', reject);
      child.on('close', (code) => {
        if (bytes > MAX_OUTPUT_BYTES) {
          reject(new CliError('CREDENTIAL_STORE_FAILED', 'Keychain response is too large', 3));
          return;
        }
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8').trim(),
          stderr: Buffer.concat(stderr).toString('utf8').trim(),
        });
      });
      if (stdin !== undefined) child.stdin.end(stdin);
      else child.stdin.end();
    });
}

const runSecurity = createKeychainCommandRunner();

function keychainNames(key: CredentialKey): { account: string; service: string } {
  const issuer = new URL(key.issuer);
  return {
    account: key.clientId,
    service: `ui4a-cli:${issuer.host}${issuer.pathname}`,
  };
}

function manifestService(key: CredentialKey): string {
  return `${keychainNames(key).service}:manifest`;
}

function chunkService(key: CredentialKey, generation: string, index: number): string {
  return `${keychainNames(key).service}:credential:${generation}:${index}`;
}

function parseManifest(value: string): CredentialManifest {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).toSorted().join(',') !== 'chunks,generation,schemaVersion' ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (parsed as { generation?: unknown }).generation !== 'string' ||
      !/^[a-zA-Z0-9-]{1,64}$/.test((parsed as { generation: string }).generation) ||
      !Number.isInteger((parsed as { chunks?: unknown }).chunks) ||
      (parsed as { chunks: number }).chunks < 1 ||
      (parsed as { chunks: number }).chunks > MAX_CHUNKS
    ) {
      throw new Error('invalid manifest');
    }
    return parsed as CredentialManifest;
  } catch {
    throw new CliError('CREDENTIAL_STORE_INVALID', 'Keychain credential is invalid', 4);
  }
}

export class MacOsKeychainCredentialStore implements CredentialStore {
  private readonly platform: string;
  private readonly run: KeychainCommandRunner;
  private readonly generation: () => string;

  constructor(options?: {
    platform?: string;
    run?: KeychainCommandRunner;
    generation?: () => string;
  }) {
    this.platform = options?.platform ?? process.platform;
    this.run = options?.run ?? runSecurity;
    this.generation = options?.generation ?? randomUUID;
  }

  private ensureAvailable(): void {
    if (this.platform !== 'darwin') {
      throw new CliError(
        'CREDENTIAL_STORE_UNAVAILABLE',
        'Device credential storage currently requires macOS Keychain',
        3,
      );
    }
  }

  private async readValue(key: CredentialKey, service: string): Promise<string | undefined> {
    const result = await this.run([
      'find-generic-password',
      '-a',
      keychainNames(key).account,
      '-s',
      service,
      '-w',
    ]);
    if (result.exitCode === 44) return undefined;
    if (result.exitCode !== 0) {
      throw new CliError('CREDENTIAL_STORE_FAILED', 'Unable to read macOS Keychain', 3);
    }
    return result.stdout;
  }

  private async writeValue(key: CredentialKey, service: string, value: string): Promise<void> {
    const result = await this.run(
      ['add-generic-password', '-a', keychainNames(key).account, '-s', service, '-U', '-w'],
      `${value}\n${value}\n`,
    );
    if (result.exitCode !== 0) {
      throw new CliError('CREDENTIAL_STORE_FAILED', 'Unable to update macOS Keychain', 3);
    }
  }

  private async deleteValue(key: CredentialKey, service: string): Promise<void> {
    const result = await this.run([
      'delete-generic-password',
      '-a',
      keychainNames(key).account,
      '-s',
      service,
    ]);
    if (result.exitCode !== 0 && result.exitCode !== 44) {
      throw new CliError('CREDENTIAL_STORE_FAILED', 'Unable to delete macOS Keychain item', 3);
    }
  }

  private async readManifest(key: CredentialKey): Promise<CredentialManifest | undefined> {
    const value = await this.readValue(key, manifestService(key));
    return value === undefined ? undefined : parseManifest(value);
  }

  async read(key: CredentialKey): Promise<StoredCredential | undefined> {
    this.ensureAvailable();
    const manifest = await this.readManifest(key);
    if (manifest === undefined) return undefined;
    const chunks: string[] = [];
    for (let index = 0; index < manifest.chunks; index += 1) {
      const chunk = await this.readValue(key, chunkService(key, manifest.generation, index));
      if (chunk === undefined) {
        throw new CliError('CREDENTIAL_STORE_INVALID', 'Keychain credential is incomplete', 4);
      }
      chunks.push(chunk);
    }
    const refreshToken = chunks.join('');
    if (refreshToken === '' || refreshToken.length > CHUNK_SIZE * MAX_CHUNKS) {
      throw new CliError('CREDENTIAL_STORE_INVALID', 'Keychain credential is invalid', 4);
    }
    return { schemaVersion: 1, refreshToken };
  }

  async write(key: CredentialKey, credential: StoredCredential): Promise<void> {
    this.ensureAvailable();
    if (!/^[\x21-\x7e]+$/.test(credential.refreshToken)) {
      throw new CliError('CREDENTIAL_STORE_INVALID', 'Keychain credential is invalid', 4);
    }
    const chunks = credential.refreshToken.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'g')) ?? [];
    if (chunks.length === 0 || chunks.length > MAX_CHUNKS) {
      throw new CliError('CREDENTIAL_STORE_INVALID', 'Keychain credential is invalid', 4);
    }
    const previous = await this.readManifest(key);
    const generation = this.generation();
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(generation)) {
      throw new CliError('CREDENTIAL_STORE_INVALID', 'Keychain generation is invalid', 4);
    }
    let written = 0;
    try {
      for (const [index, chunk] of chunks.entries()) {
        await this.writeValue(key, chunkService(key, generation, index), chunk);
        written += 1;
      }
      await this.writeValue(
        key,
        manifestService(key),
        JSON.stringify({ schemaVersion: 1, generation, chunks: chunks.length }),
      );
    } catch (error) {
      for (let index = 0; index < written; index += 1) {
        await this.deleteValue(key, chunkService(key, generation, index)).catch(() => {});
      }
      throw error;
    }
    if (previous !== undefined && previous.generation !== generation) {
      for (let index = 0; index < previous.chunks; index += 1) {
        await this.deleteValue(key, chunkService(key, previous.generation, index));
      }
    }
  }

  async delete(key: CredentialKey): Promise<void> {
    this.ensureAvailable();
    const manifest = await this.readManifest(key);
    if (manifest === undefined) return;
    for (let index = 0; index < manifest.chunks; index += 1) {
      await this.deleteValue(key, chunkService(key, manifest.generation, index));
    }
    await this.deleteValue(key, manifestService(key));
  }
}
