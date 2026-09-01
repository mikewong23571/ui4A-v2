import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../../..');
const workerRoot = resolve(repositoryRoot, 'apps/worker');
const pnpmExecutable = process.env.UI4A_PNPM_EXECUTABLE ?? process.env.npm_execpath;

async function executeAdminEntry(file: string, arguments_: string[]) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [resolve(workerRoot, 'dist', file), ...arguments_],
      {
        cwd: workerRoot,
        env: { ...process.env, UI4A_DEPLOYMENT_PROFILE: '' },
      },
    );
    return { exitCode: 0, ...result };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

beforeAll(async () => {
  const executable = pnpmExecutable === undefined ? 'pnpm' : process.execPath;
  const arguments_ = [
    ...(pnpmExecutable === undefined ? [] : [pnpmExecutable]),
    '--filter',
    '@ui4a/worker',
    'build',
  ];
  await execFileAsync(executable, arguments_, {
    cwd: repositoryRoot,
    env: process.env,
    timeout: 120_000,
  });
}, 130_000);

describe('T22 Compose Worker admin entry artifacts', () => {
  it.each(['t22-migrate.js', 't22-keycloak-realm-bootstrap.js', 't22-keycloak-realm-migration.js'])(
    'ships compiled %s in the Worker runtime payload',
    (file) => {
      const artifact = resolve(workerRoot, 'dist', file);

      expect(existsSync(artifact), `${file} must be emitted by the Worker production build`).toBe(
        true,
      );
      expect(readFileSync(artifact, 'utf8')).not.toMatch(
        /(?:import|from)\s*\(?['"][^'"]*scripts\/t22-.+\.ts/,
      );
    },
  );

  it('returns a stable JSON failure envelope from the compiled migration entry', async () => {
    const result = await executeAdminEntry('t22-migrate.js', ['unexpected']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, code: 'MIGRATION_USAGE_INVALID' });
  });

  it('returns a stable JSON failure envelope from the compiled realm entry', async () => {
    const result = await executeAdminEntry('t22-keycloak-realm-bootstrap.js', ['unexpected']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      code: 'KEYCLOAK_REALM_IMPORT_INVALID',
      message: 'Usage: t22-keycloak-realm-bootstrap.ts --check|--apply',
    });
  });

  it('returns a stable JSON failure envelope from the compiled realm migration entry', async () => {
    const result = await executeAdminEntry('t22-keycloak-realm-migration.js', ['unexpected']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      code: 'KEYCLOAK_REALM_IMPORT_INVALID',
      message:
        'Usage: t22-keycloak-realm-migration.ts --backup-file /var/lib/ui4a/realm/backups/<name>.json',
    });
  });
});
