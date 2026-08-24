import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const scriptPath = resolve(repositoryRoot, 'deploy/compose/config-init.mjs');
const roots: string[] = [];

interface ConfigInitModule {
  initializeRuntimeConfig(input: {
    sources: Record<
      | 'settings'
      | 'deploymentSecrets'
      | 'callbackToken'
      | 'temporalSchemaPassword'
      | 'temporalRuntimePassword'
      | 'keycloakDatabasePassword'
      | 'keycloakBootstrapAdminPassword',
      string
    >;
    targetDirectory: string;
    uid: number;
    gid: number;
  }): Promise<{ code: 'UI4A_RUNTIME_CONFIG_READY'; files: 7 }>;
  runConfigInit(input: {
    initialize: () => Promise<{ code: 'UI4A_RUNTIME_CONFIG_READY'; files: 7 }>;
    write: (value: string) => void;
  }): Promise<number>;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

async function loadConfigInit(): Promise<ConfigInitModule> {
  expect(existsSync(scriptPath), 'deploy/compose/config-init.mjs must exist').toBe(true);
  return import(
    `${pathToFileURL(scriptPath).href}?test=${Date.now()}`
  ) as Promise<ConfigInitModule>;
}

function fixture(): {
  root: string;
  sources: ConfigInitModule extends {
    initializeRuntimeConfig(input: infer Input): unknown;
  }
    ? Input extends { sources: infer Sources }
      ? Sources
      : never
    : never;
  targetDirectory: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'ui4a-compose-config-init-'));
  roots.push(root);
  const sources = {
    settings: join(root, 'settings.json'),
    deploymentSecrets: join(root, 'deployment-secrets.json'),
    callbackToken: join(root, 'capability-callback-token'),
    temporalSchemaPassword: join(root, 'temporal-schema-password'),
    temporalRuntimePassword: join(root, 'temporal-runtime-password'),
    keycloakDatabasePassword: join(root, 'keycloak-database-password'),
    keycloakBootstrapAdminPassword: join(root, 'keycloak-bootstrap-admin-password'),
  };
  writeFileSync(sources.settings, '{"schemaVersion":1}', { mode: 0o600 });
  writeFileSync(sources.deploymentSecrets, '{"schemaVersion":1,"private":"fixture"}', {
    mode: 0o600,
  });
  writeFileSync(sources.callbackToken, 'callback.fixture', { mode: 0o600 });
  writeFileSync(sources.temporalSchemaPassword, 'temporal-schema.fixture', { mode: 0o600 });
  writeFileSync(sources.temporalRuntimePassword, 'temporal-runtime.fixture', { mode: 0o600 });
  writeFileSync(sources.keycloakDatabasePassword, 'keycloak-database.fixture', { mode: 0o600 });
  writeFileSync(sources.keycloakBootstrapAdminPassword, 'keycloak-bootstrap.fixture', {
    mode: 0o600,
  });
  return { root, sources, targetDirectory: join(root, 'runtime-config') };
}

describe('T22 Compose rootless runtime config handoff', () => {
  it('atomically creates a bounded private uid-1000 handoff without echoing material', async () => {
    const module = await loadConfigInit();
    const input = fixture();
    await expect(
      module.initializeRuntimeConfig({ ...input, uid: 1000, gid: 1000 }),
    ).resolves.toEqual({ code: 'UI4A_RUNTIME_CONFIG_READY', files: 7 });

    const expected = {
      'settings.json': readFileSync(input.sources.settings, 'utf8'),
      'deployment-secrets.json': readFileSync(input.sources.deploymentSecrets, 'utf8'),
      'capability-callback-token': readFileSync(input.sources.callbackToken, 'utf8'),
      'temporal-schema-password': readFileSync(input.sources.temporalSchemaPassword, 'utf8'),
      'temporal-runtime-password': readFileSync(input.sources.temporalRuntimePassword, 'utf8'),
      'keycloak-database-password': readFileSync(input.sources.keycloakDatabasePassword, 'utf8'),
      'keycloak-bootstrap-admin-password': readFileSync(
        input.sources.keycloakBootstrapAdminPassword,
        'utf8',
      ),
    };
    for (const [name, material] of Object.entries(expected)) {
      const target = join(input.targetDirectory, name);
      expect(lstatSync(target).isFile()).toBe(true);
      expect(statSync(target).mode & 0o777).toBe(0o400);
      expect(statSync(target)).toMatchObject({ uid: 1000, gid: 1000 });
      expect(readFileSync(target, 'utf8')).toBe(material);
    }
  });

  it('updates idempotently and rejects symlink, empty, oversized, or group-readable sources', async () => {
    const module = await loadConfigInit();
    const first = fixture();
    await module.initializeRuntimeConfig({ ...first, uid: 1000, gid: 1000 });
    writeFileSync(first.sources.callbackToken, 'callback.updated', { mode: 0o600 });
    await module.initializeRuntimeConfig({ ...first, uid: 1000, gid: 1000 });
    expect(readFileSync(join(first.targetDirectory, 'capability-callback-token'), 'utf8')).toBe(
      'callback.updated',
    );

    for (const mutate of [
      (path: string) => writeFileSync(path, '', { mode: 0o600 }),
      (path: string) => writeFileSync(path, 'x'.repeat(1024 * 1024 + 1), { mode: 0o600 }),
      (path: string) => {
        writeFileSync(path, 'group-readable');
        chmodSync(path, 0o640);
      },
      (path: string) => {
        rmSync(path);
        symlinkSync(first.sources.settings, path);
      },
    ]) {
      const invalid = fixture();
      mutate(invalid.sources.callbackToken);
      await expect(
        module.initializeRuntimeConfig({ ...invalid, uid: 1000, gid: 1000 }),
      ).rejects.toThrow('UI4A_RUNTIME_CONFIG_SOURCE_INVALID');
    }

    const invalidTarget = fixture();
    await expect(
      module.initializeRuntimeConfig({
        ...invalidTarget,
        targetDirectory: 'relative/runtime-config',
        uid: 1000,
        gid: 1000,
      }),
    ).rejects.toThrow('UI4A_RUNTIME_CONFIG_TARGET_INVALID');
  });

  it('reports only stable JSON outcome codes and counts', async () => {
    const module = await loadConfigInit();
    const success: string[] = [];
    await expect(
      module.runConfigInit({
        initialize: async () => ({ code: 'UI4A_RUNTIME_CONFIG_READY', files: 7 }),
        write: (value) => success.push(value),
      }),
    ).resolves.toBe(0);
    expect(success).toEqual(['{"code":"UI4A_RUNTIME_CONFIG_READY","files":7}']);

    const failure: string[] = [];
    await expect(
      module.runConfigInit({
        initialize: async () => {
          throw new Error('private.fixture.must.not.escape');
        },
        write: (value) => failure.push(value),
      }),
    ).resolves.toBe(1);
    expect(failure).toEqual(['{"code":"UI4A_RUNTIME_CONFIG_INIT_FAILED"}']);
  });
});
