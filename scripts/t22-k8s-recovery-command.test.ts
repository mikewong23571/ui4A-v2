import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

interface ProcessCommand {
  executable: string;
  args: string[];
}

interface CliDependencies {
  readPrivateJson(path: string): unknown;
  run(command: ProcessCommand): Promise<{ exitCode: number }>;
}

interface RecoveryCommandModule {
  executeKubernetesRecoveryCli(
    dependencies: CliDependencies,
    argv: readonly string[],
    environment: Readonly<Record<string, string | undefined>>,
  ): Promise<Record<string, unknown>>;
}

const commandPath = 'scripts/t22-k8s-recovery-command.ts';
const execFileAsync = promisify(execFile);
const secretCanary = '__k8s_recovery_secret_must_not_escape__';

async function plannedApi(): Promise<RecoveryCommandModule> {
  return (await import('./t22-k8s-recovery-command')) as RecoveryCommandModule;
}

function observation(): Record<string, unknown> {
  return {
    current: {
      namespace: { name: 'ui4a-system', uid: 'namespace-current-uid' },
      postgresService: {
        name: 'postgres',
        uid: 'postgres-current-service-uid',
        clusterIp: '10.103.150.84',
      },
      claims: [
        {
          name: 'postgres-data',
          uid: 'postgres-current-claim-uid',
          volumeName: 'ui4a-postgres-pv',
        },
        {
          name: 'runtime-data',
          uid: 'runtime-current-claim-uid',
          volumeName: 'ui4a-runtime-pv',
        },
        {
          name: 'backup-data',
          uid: 'backup-current-claim-uid',
          volumeName: 'ui4a-backup-pv',
        },
        { name: 'pki-data', uid: 'pki-current-claim-uid', volumeName: 'ui4a-pki-pv' },
      ],
      volumes: [
        {
          name: 'ui4a-postgres-pv',
          uid: 'postgres-current-volume-uid',
          hostPath: '/srv/ui4a/postgres',
          nodeName: 'k8s-w-2',
        },
        {
          name: 'ui4a-runtime-pv',
          uid: 'runtime-current-volume-uid',
          hostPath: '/srv/ui4a/runtime',
          nodeName: 'k8s-w-2',
        },
        {
          name: 'ui4a-backup-pv',
          uid: 'backup-current-volume-uid',
          hostPath: '/srv/ui4a/backup',
          nodeName: 'k8s-w-2',
        },
        {
          name: 'ui4a-pki-pv',
          uid: 'pki-current-volume-uid',
          hostPath: '/srv/ui4a/pki',
          nodeName: 'k8s-w-2',
        },
      ],
    },
    quiescence: {
      observedAt: '2026-08-24T14:00:00.000Z',
      workloads: {
        web: { desired: 0, ready: 0 },
        worker: { desired: 0, ready: 0 },
        keycloak: { desired: 0, ready: 0 },
        temporal: { desired: 0, ready: 0 },
      },
      runner: { daemonReplicas: 0, activeRunJobs: 0 },
      postgres: { desired: 1, ready: 1 },
      eventHighWaterMarks: [42, 42],
    },
  };
}

function request(): Record<string, unknown> {
  return {
    backupId: 'ui4a-v0.1.0-experimental.1-kubernetes-20260824T140000Z-abcdef0',
    drillId: '20260824t140000z-abcdef0',
    gitSha: 'abcdef0123456789',
    target: {
      namespace: { name: 'ui4a-restore-abcdef0', exists: false },
      nodeName: 'k8s-w-2',
      root: '/srv/ui4a/restore-drills/20260824t140000z-abcdef0',
      existingResourceNames: [],
    },
  };
}

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    UI4A_K8S_RECOVERY_OBSERVATION_FILE: '/private/k8s-observation.json',
    UI4A_K8S_RECOVERY_REQUEST_FILE: '/private/k8s-request.json',
    ...overrides,
  };
}

function dependencies(options: { observation?: unknown; request?: unknown; failAt?: number } = {}) {
  const commands: ProcessCommand[] = [];
  const readPrivateJson = vi.fn((path: string) => {
    if (path.endsWith('observation.json')) return options.observation ?? observation();
    if (path.endsWith('request.json')) return options.request ?? request();
    throw new Error(secretCanary);
  });
  const run = vi.fn(async (command: ProcessCommand) => {
    commands.push(command);
    if (commands.length === options.failAt) throw new Error(secretCanary);
    return { exitCode: 0 };
  });
  return { commands, readPrivateJson, run };
}

describe('T22 host-side Kubernetes recovery operator', () => {
  it('returns a dry-run isolated plan without invoking any process', async () => {
    const api = await plannedApi();
    const deps = dependencies();

    const result = await api.executeKubernetesRecoveryCli(deps, ['plan'], environment());

    expect(result).toMatchObject({
      ok: true,
      code: 'K8S_RECOVERY_PLAN_READY',
      plan: {
        mode: 'isolated',
        destructive: false,
        backupId: request().backupId,
        target: {
          namespace: 'ui4a-restore-abcdef0',
          postgresServiceFqdn: 'postgres-restore.ui4a-restore-abcdef0.svc.cluster.local',
        },
        commands: expect.any(Array),
      },
    });
    expect(deps.readPrivateJson.mock.calls.map(([path]) => path)).toEqual([
      '/private/k8s-observation.json',
      '/private/k8s-request.json',
    ]);
    expect(deps.run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it('executes only the canonical explicit argv plan and returns a bounded receipt', async () => {
    const api = await plannedApi();
    const deps = dependencies();

    const result = await api.executeKubernetesRecoveryCli(deps, ['execute'], environment());

    expect(result).toEqual({
      ok: true,
      code: 'K8S_RECOVERY_EXECUTED',
      receipt: {
        schemaVersion: 1,
        backupId: request().backupId,
        drillId: request().drillId,
        mode: 'isolated',
        destructive: false,
        targetNamespace: 'ui4a-restore-abcdef0',
        commandsExecuted: 11,
      },
    });
    expect(deps.commands).toHaveLength(11);
    expect(deps.commands.every(({ args }) => Array.isArray(args) && args.length > 0)).toBe(true);
    expect(JSON.stringify(deps.commands)).not.toMatch(/sh -c|bash -c|--clean/);
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it('fails current-target and quiescence gates before the first process', async () => {
    const api = await plannedApi();
    const unsafe = request();
    unsafe.target = {
      ...(unsafe.target as Record<string, unknown>),
      root: '/srv/ui4a/postgres',
    };
    const deps = dependencies({ request: unsafe });

    expect(await api.executeKubernetesRecoveryCli(deps, ['execute'], environment())).toEqual({
      ok: false,
      code: 'K8S_RESTORE_TARGET_NOT_ISOLATED',
    });
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('redacts runner failures into one stable code', async () => {
    const api = await plannedApi();
    const deps = dependencies({ failAt: 2 });

    const result = await api.executeKubernetesRecoveryCli(deps, ['execute'], environment());

    expect(result).toEqual({ ok: false, code: 'K8S_RECOVERY_COMMAND_FAILED' });
    expect(deps.run).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it.each([
    [['unknown'], environment(), 'K8S_RECOVERY_USAGE_INVALID'],
    [
      ['plan'],
      environment({ UI4A_K8S_RECOVERY_REQUEST_FILE: undefined }),
      'K8S_RECOVERY_INPUT_INVALID',
    ],
    [
      ['plan'],
      environment({ UI4A_K8S_RECOVERY_OBSERVATION_FILE: 'relative.json' }),
      'K8S_RECOVERY_INPUT_INVALID',
    ],
  ])('returns stable JSON-safe failures for invalid operator input', async (argv, env, code) => {
    const api = await plannedApi();
    const deps = dependencies();

    expect(await api.executeKubernetesRecoveryCli(deps, argv, env)).toEqual({ ok: false, code });
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('implements an absolute O_NOFOLLOW 0600 bounded regular-file reader and stable CLI JSON', async () => {
    expect(existsSync(resolve(commandPath)), commandPath).toBe(true);
    const source = readFileSync(resolve(commandPath), 'utf8');
    expect(source).toContain('O_NOFOLLOW');
    expect(source).toMatch(/mode\s*&\s*0o077/);
    expect(source).toMatch(/isAbsolute/);
    expect(source).toMatch(/isFile\(\)/);
    expect(source).not.toMatch(/shell:\s*true|execSync|spawnSync/);

    await expect(
      execFileAsync('apps/worker/node_modules/.bin/tsx', [commandPath, 'invalid'], {
        cwd: process.cwd(),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: '{"ok":false,"code":"K8S_RECOVERY_USAGE_INVALID"}\n',
    });
  });
});
