import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  createKeychainCommandRunner,
  MacOsKeychainCredentialStore,
  type KeychainCommandRunner,
} from './auth-keychain.js';

const key = {
  issuer: 'https://auth.ui4a.example/realms/ui4a',
  clientId: 'ui4a-cli',
};

describe('macOS Keychain credential store', () => {
  it('bounds the native security process and sends credential bytes only to stdin', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: { end(input?: string): void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill(): void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    let stdin = '';
    child.stdin = {
      end(input) {
        stdin = input ?? '';
      },
    };
    const run = createKeychainCommandRunner(() => child);
    const resultPromise = run(['add-generic-password', '-w'], 'secret\nsecret\n');
    child.stdout.emit('data', Buffer.from('ok\n'));
    child.stderr.emit('data', Buffer.from('prompt'));
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      exitCode: 0,
      stdout: 'ok',
      stderr: 'prompt',
    });
    expect(stdin).toBe('secret\nsecret\n');
  });

  it('writes the secret twice through stdin and never places it in argv or output', async () => {
    const refreshToken = 'offline-refresh-secret';
    const run = vi.fn<KeychainCommandRunner>(async (_args, stdin) => ({
      exitCode: 0,
      stdout: '',
      stderr: stdin === undefined ? '' : 'password prompts only',
    }));
    const store = new MacOsKeychainCredentialStore({ platform: 'darwin', run });

    await store.write(key, { schemaVersion: 1, refreshToken });

    expect(run).toHaveBeenCalledTimes(1);
    const [args, stdin] = run.mock.calls[0]!;
    expect(args).toEqual(
      expect.arrayContaining(['add-generic-password', '-a', 'ui4a-cli', '-U', '-w']),
    );
    expect(args.join(' ')).not.toContain(refreshToken);
    expect(stdin).toBe(
      `${JSON.stringify({ schemaVersion: 1, refreshToken })}\n${JSON.stringify({ schemaVersion: 1, refreshToken })}\n`,
    );
  });

  it('reads, validates, and deletes one bounded credential', async () => {
    const stored = JSON.stringify({ schemaVersion: 1, refreshToken: 'refresh-value' });
    const run = vi.fn<KeychainCommandRunner>(async (args) => {
      if (args[0] === 'find-generic-password') return { exitCode: 0, stdout: stored, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const store = new MacOsKeychainCredentialStore({ platform: 'darwin', run });

    await expect(store.read(key)).resolves.toEqual({
      schemaVersion: 1,
      refreshToken: 'refresh-value',
    });
    await expect(store.delete(key)).resolves.toBeUndefined();
    expect(run.mock.calls.flatMap(([args]) => args).join(' ')).not.toContain('refresh-value');
  });

  it('fails honestly off macOS and treats only item-not-found as missing', async () => {
    const unsupported = new MacOsKeychainCredentialStore({
      platform: 'linux',
      run: vi.fn<KeychainCommandRunner>(),
    });
    await expect(unsupported.read(key)).rejects.toMatchObject({
      code: 'CREDENTIAL_STORE_UNAVAILABLE',
    });

    const missing = new MacOsKeychainCredentialStore({
      platform: 'darwin',
      run: vi.fn<KeychainCommandRunner>(async () => ({
        exitCode: 44,
        stdout: '',
        stderr: 'not found',
      })),
    });
    await expect(missing.read(key)).resolves.toBeUndefined();
  });

  it('rejects malformed stored material and redacts command failures', async () => {
    const malformed = new MacOsKeychainCredentialStore({
      platform: 'darwin',
      run: vi.fn<KeychainCommandRunner>(async () => ({
        exitCode: 0,
        stdout: '{"schemaVersion":1,"refreshToken":""}',
        stderr: '',
      })),
    });
    await expect(malformed.read(key)).rejects.toMatchObject({
      code: 'CREDENTIAL_STORE_INVALID',
    });

    for (const operation of ['read', 'write', 'delete'] as const) {
      const failed = new MacOsKeychainCredentialStore({
        platform: 'darwin',
        run: vi.fn<KeychainCommandRunner>(async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'offline-refresh-secret',
        })),
      });
      const promise =
        operation === 'read'
          ? failed.read(key)
          : operation === 'write'
            ? failed.write(key, { schemaVersion: 1, refreshToken: 'offline-refresh-secret' })
            : failed.delete(key);
      await expect(promise).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_FAILED' });
      await expect(promise).rejects.not.toThrow('offline-refresh-secret');
    }
  });
});
