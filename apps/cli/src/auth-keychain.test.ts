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
  it('round-trips a long refresh token through bounded Keychain chunks', async () => {
    const items = new Map<string, string>();
    const calls: Array<{ args: string[]; stdin?: string }> = [];
    const run = vi.fn<KeychainCommandRunner>(async (args, stdin) => {
      calls.push({ args, stdin });
      const service = args[args.indexOf('-s') + 1]!;
      if (args[0] === 'add-generic-password') {
        const firstLine = stdin?.split('\n')[0] ?? '';
        items.set(service, firstLine.slice(0, 128));
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'find-generic-password') {
        const value = items.get(service);
        return value === undefined
          ? { exitCode: 44, stdout: '', stderr: 'not found' }
          : { exitCode: 0, stdout: value, stderr: '' };
      }
      items.delete(service);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const store = new MacOsKeychainCredentialStore({
      platform: 'darwin',
      run,
      generation: () => 'generation-one',
    });
    const refreshToken = 'r'.repeat(1_024);

    await store.write(key, { schemaVersion: 1, refreshToken });
    await expect(store.read(key)).resolves.toEqual({ schemaVersion: 1, refreshToken });

    const writes = calls.filter(({ args }) => args[0] === 'add-generic-password');
    expect(writes.length).toBeGreaterThan(2);
    expect(
      writes.every(
        ({ args, stdin }) =>
          args.every((argument) => !argument.includes(refreshToken.slice(0, 32))) &&
          (stdin?.split('\n')[0]?.length ?? 0) <= 128,
      ),
    ).toBe(true);
    expect(writes.at(-1)?.args.join(' ')).toContain(':manifest');
  });

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
    const run = vi.fn<KeychainCommandRunner>(async (args, stdin) => ({
      exitCode: args[0] === 'find-generic-password' ? 44 : 0,
      stdout: '',
      stderr: stdin === undefined ? '' : 'password prompts only',
    }));
    const store = new MacOsKeychainCredentialStore({
      platform: 'darwin',
      run,
      generation: () => 'generation-one',
    });

    await store.write(key, { schemaVersion: 1, refreshToken });

    const writes = run.mock.calls.filter(([args]) => args[0] === 'add-generic-password');
    expect(writes).toHaveLength(2);
    const [args, stdin] = writes[0]!;
    expect(args).toEqual(
      expect.arrayContaining(['add-generic-password', '-a', 'ui4a-cli', '-U', '-w']),
    );
    expect(args.join(' ')).not.toContain(refreshToken);
    expect(stdin).toBe(`${refreshToken}\n${refreshToken}\n`);
    expect(writes[1]?.[0].join(' ')).toContain(':manifest');
  });

  it('reads, validates, and deletes one bounded credential', async () => {
    const items = new Map<string, string>();
    const run = vi.fn<KeychainCommandRunner>(async (args, stdin) => {
      const service = args[args.indexOf('-s') + 1]!;
      if (args[0] === 'find-generic-password') {
        const value = items.get(service);
        return value === undefined
          ? { exitCode: 44, stdout: '', stderr: '' }
          : { exitCode: 0, stdout: value, stderr: '' };
      }
      if (args[0] === 'add-generic-password') {
        items.set(service, stdin?.split('\n')[0] ?? '');
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      items.delete(service);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const store = new MacOsKeychainCredentialStore({
      platform: 'darwin',
      run,
      generation: () => 'generation-one',
    });

    await store.write(key, { schemaVersion: 1, refreshToken: 'refresh-value' });

    await expect(store.read(key)).resolves.toEqual({
      schemaVersion: 1,
      refreshToken: 'refresh-value',
    });
    await expect(store.delete(key)).resolves.toBeUndefined();
    await expect(store.read(key)).resolves.toBeUndefined();
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
