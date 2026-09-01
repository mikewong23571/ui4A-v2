import { spawn } from 'node:child_process';

import type { CredentialKey, CredentialStore, StoredCredential } from './auth-credential.js';
import { CliError } from './envelope.js';

const MAX_OUTPUT_BYTES = 64 * 1024;

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

function parseCredential(value: string): StoredCredential {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).toSorted().join(',') !== 'refreshToken,schemaVersion' ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      typeof (parsed as { refreshToken?: unknown }).refreshToken !== 'string' ||
      (parsed as { refreshToken: string }).refreshToken === ''
    ) {
      throw new Error('invalid credential');
    }
    return parsed as StoredCredential;
  } catch {
    throw new CliError('CREDENTIAL_STORE_INVALID', 'Keychain credential is invalid', 4);
  }
}

export class MacOsKeychainCredentialStore implements CredentialStore {
  private readonly platform: string;
  private readonly run: KeychainCommandRunner;

  constructor(options?: { platform?: string; run?: KeychainCommandRunner }) {
    this.platform = options?.platform ?? process.platform;
    this.run = options?.run ?? runSecurity;
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

  async read(key: CredentialKey): Promise<StoredCredential | undefined> {
    this.ensureAvailable();
    const names = keychainNames(key);
    const result = await this.run([
      'find-generic-password',
      '-a',
      names.account,
      '-s',
      names.service,
      '-w',
    ]);
    if (result.exitCode === 44) return undefined;
    if (result.exitCode !== 0) {
      throw new CliError('CREDENTIAL_STORE_FAILED', 'Unable to read macOS Keychain', 3);
    }
    return parseCredential(result.stdout);
  }

  async write(key: CredentialKey, credential: StoredCredential): Promise<void> {
    this.ensureAvailable();
    const names = keychainNames(key);
    const serialized = JSON.stringify(credential);
    const result = await this.run(
      ['add-generic-password', '-a', names.account, '-s', names.service, '-U', '-w'],
      `${serialized}\n${serialized}\n`,
    );
    if (result.exitCode !== 0) {
      throw new CliError('CREDENTIAL_STORE_FAILED', 'Unable to update macOS Keychain', 3);
    }
  }

  async delete(key: CredentialKey): Promise<void> {
    this.ensureAvailable();
    const names = keychainNames(key);
    const result = await this.run([
      'delete-generic-password',
      '-a',
      names.account,
      '-s',
      names.service,
    ]);
    if (result.exitCode !== 0 && result.exitCode !== 44) {
      throw new CliError('CREDENTIAL_STORE_FAILED', 'Unable to delete macOS Keychain item', 3);
    }
  }
}
