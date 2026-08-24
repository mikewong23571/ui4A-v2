import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  instrumentationRegister,
  runProductionEntrypoint,
  startProductionServer,
} from './production-entrypoint.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Web production container bootstrap', () => {
  it('awaits the CommonJS default register before importing the standalone server', async () => {
    let completeRegister: (() => void) | undefined;
    const register = vi.fn(
      () => new Promise<void>((resolveRegister) => (completeRegister = resolveRegister)),
    );
    const serverImport = vi.fn();
    const loadCallbackToken = vi.fn();
    const loadModule = vi.fn(async (specifier: string) => {
      if (specifier === 'instrumentation:test') return { default: { register } };
      serverImport();
      return {};
    });

    const started = startProductionServer({
      loadModule,
      loadCallbackToken,
      instrumentationUrl: 'instrumentation:test',
      serverUrl: 'server:test',
    });
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
    expect(loadCallbackToken).toHaveBeenCalledOnce();
    expect(loadCallbackToken.mock.invocationCallOrder[0]).toBeLessThan(
      loadModule.mock.invocationCallOrder[0]!,
    );
    expect(serverImport).not.toHaveBeenCalled();

    completeRegister?.();
    await started;

    expect(loadModule).toHaveBeenNthCalledWith(2, 'server:test');
    expect(serverImport).toHaveBeenCalledOnce();
  });

  it('supports Node module.exports instrumentation namespaces', async () => {
    const register = vi.fn();

    expect(instrumentationRegister({ 'module.exports': { register } })).toBe(register);
  });

  it('never imports the standalone server when register rejects', async () => {
    const serverImport = vi.fn();
    const loadModule = vi.fn(async (specifier: string) => {
      if (specifier === 'instrumentation:test') {
        return { default: { register: () => Promise.reject(new Error('preflight rejected')) } };
      }
      serverImport();
      return {};
    });

    await expect(
      startProductionServer({
        loadModule,
        instrumentationUrl: 'instrumentation:test',
        serverUrl: 'server:test',
      }),
    ).rejects.toThrow('preflight rejected');
    expect(serverImport).not.toHaveBeenCalled();
  });

  it('returns a non-zero direct-entrypoint result after bootstrap rejection', async () => {
    const errors: unknown[] = [];

    await expect(
      runProductionEntrypoint({
        start: () => Promise.reject(new Error('preflight rejected')),
        reportError: (error: unknown) => errors.push(error),
      }),
    ).resolves.toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('exits non-zero without starting server.js when executed directly', () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'ui4a-web-entrypoint-'));
    temporaryDirectories.push(fixtureRoot);
    const instrumentationPath = resolve(fixtureRoot, 'apps/web/.next/server/instrumentation.js');
    const serverPath = resolve(fixtureRoot, 'apps/web/server.js');
    const serverMarker = resolve(fixtureRoot, 'server-started');
    mkdirSync(dirname(instrumentationPath), { recursive: true });
    mkdirSync(dirname(serverPath), { recursive: true });
    writeFileSync(
      instrumentationPath,
      "module.exports.register = async () => { throw new Error('fixture preflight rejected'); };\n",
    );
    writeFileSync(
      serverPath,
      `require('node:fs').writeFileSync(${JSON.stringify(serverMarker)}, 'started');\n`,
    );
    const entrypointPath = fileURLToPath(new URL('./production-entrypoint.mjs', import.meta.url));

    const result = spawnSync(process.execPath, [entrypointPath], {
      cwd: fixtureRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture preflight rejected');
    expect(existsSync(serverMarker)).toBe(false);
  });
});
