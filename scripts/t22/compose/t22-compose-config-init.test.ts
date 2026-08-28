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

const repositoryRoot = resolve(import.meta.dirname, '../../..');
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
    runnerTargetDirectory: string;
    hostRunnerTargetDirectory: string;
    uid: number;
    gid: number;
  }): Promise<{ code: 'UI4A_RUNTIME_CONFIG_READY'; files: 11 }>;
  runConfigInit(input: {
    initialize: () => Promise<{ code: 'UI4A_RUNTIME_CONFIG_READY'; files: 11 }>;
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
  runnerTargetDirectory: string;
  hostRunnerTargetDirectory: string;
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
  writeFileSync(
    sources.settings,
    JSON.stringify({
      llm: { apiKeyRef: 'llm-api-key' },
      runtime: {
        profiles: [
          {
            backend: 'host',
            runnerId: 'compose-container-runner',
            runnerTokenRef: 'compose-container-runner-token',
            credentialRefs: ['llm-api-key', 'codex-api-token'],
          },
          {
            backend: 'host',
            runnerId: 'compose-host-runner',
            runnerTokenRef: 'compose-host-runner-token',
            credentialRefs: ['llm-api-key', 'codex-api-token'],
          },
          {
            backend: 'host',
            runnerId: 'compose-container-runner',
            runnerTokenRef: 'compose-container-runner-token',
            credentialRefs: ['container-writing-token'],
          },
          {
            backend: 'host',
            runnerId: 'compose-host-runner',
            runnerTokenRef: 'compose-host-runner-token',
            credentialRefs: ['host-authoring-token'],
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    sources.deploymentSecrets,
    JSON.stringify({
      'llm-api-key': '__llm_canary__',
      'codex-api-token': '__codex_canary__',
      'compose-container-runner-token': '__container_runner_canary__',
      'compose-host-runner-token': '__host_runner_canary__',
      'container-writing-token': '__container_writing_canary__',
      'host-authoring-token': '__host_authoring_canary__',
      'postgres-runtime-password': '__postgres_canary__',
      'oidc-client-secret': '__keycloak_canary__',
    }),
    { mode: 0o600 },
  );
  writeFileSync(sources.callbackToken, 'callback.fixture', { mode: 0o600 });
  writeFileSync(sources.temporalSchemaPassword, 'temporal-schema.fixture', { mode: 0o600 });
  writeFileSync(sources.temporalRuntimePassword, 'temporal-runtime.fixture', { mode: 0o600 });
  writeFileSync(sources.keycloakDatabasePassword, 'keycloak-database.fixture', { mode: 0o600 });
  writeFileSync(sources.keycloakBootstrapAdminPassword, 'keycloak-bootstrap.fixture', {
    mode: 0o600,
  });
  return {
    root,
    sources,
    targetDirectory: join(root, 'runtime-config'),
    runnerTargetDirectory: join(root, 'runner-config'),
    hostRunnerTargetDirectory: join(root, 'host-runner-config'),
  };
}

// uid-1000 chown 交接在 darwin 非 root 下不可执行(EPERM);该环境跳过,
// chown 合同由 Linux CI(通常 root/容器)覆盖,断言本身不放松。
const chownUnavailable = process.platform === 'darwin' && process.getuid() !== 0;

describe.skipIf(chownUnavailable)('T22 Compose rootless runtime config handoff', () => {
  it('atomically creates a bounded private uid-1000 handoff without echoing material', async () => {
    const module = await loadConfigInit();
    const input = fixture();
    await expect(
      module.initializeRuntimeConfig({ ...input, uid: 1000, gid: 1000 }),
    ).resolves.toEqual({ code: 'UI4A_RUNTIME_CONFIG_READY', files: 11 });

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
    expect(
      JSON.parse(readFileSync(join(input.runnerTargetDirectory, 'runner-secrets.json'), 'utf8')),
    ).toEqual({
      'llm-api-key': '__llm_canary__',
      'codex-api-token': '__codex_canary__',
      'compose-container-runner-token': '__container_runner_canary__',
      'container-writing-token': '__container_writing_canary__',
    });
    expect(
      JSON.parse(
        readFileSync(join(input.hostRunnerTargetDirectory, 'runner-secrets.json'), 'utf8'),
      ),
    ).toEqual({
      'llm-api-key': '__llm_canary__',
      'codex-api-token': '__codex_canary__',
      'compose-host-runner-token': '__host_runner_canary__',
      'host-authoring-token': '__host_authoring_canary__',
    });
    for (const directory of [input.runnerTargetDirectory, input.hostRunnerTargetDirectory]) {
      expect(readFileSync(join(directory, 'settings.json'), 'utf8')).toBe(
        readFileSync(input.sources.settings, 'utf8'),
      );
      for (const name of ['settings.json', 'runner-secrets.json']) {
        expect(statSync(join(directory, name)).mode & 0o777).toBe(0o400);
      }
      expect(readFileSync(join(directory, 'runner-secrets.json'), 'utf8')).not.toContain(
        '__postgres_canary__',
      );
      expect(readFileSync(join(directory, 'runner-secrets.json'), 'utf8')).not.toContain(
        '__keycloak_canary__',
      );
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
        initialize: async () => ({ code: 'UI4A_RUNTIME_CONFIG_READY', files: 11 }),
        write: (value) => success.push(value),
      }),
    ).resolves.toBe(0);
    expect(success).toEqual(['{"code":"UI4A_RUNTIME_CONFIG_READY","files":11}']);

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
