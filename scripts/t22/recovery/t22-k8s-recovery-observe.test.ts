import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

interface KubectlCommand {
  executable: 'kubectl';
  args: string[];
}

interface ObserveModule {
  planKubernetesRecoveryObservation(input: {
    namespace: string;
    firstHwmProbe: string;
    secondHwmProbe: string;
  }): KubectlCommand[];
  captureKubernetesRecoveryObservation(
    dependencies: {
      run(command: KubectlCommand): Promise<{ exitCode: number; stdout: string }>;
      clock(): string;
    },
    input: { namespace: string; firstHwmProbe: string; secondHwmProbe: string },
  ): Promise<Record<string, unknown>>;
}

interface ObserveCommandModule {
  executeKubernetesRecoveryObserveCli(
    dependencies: {
      capture(input: {
        namespace: string;
        firstHwmProbe: string;
        secondHwmProbe: string;
      }): Promise<Record<string, unknown>>;
      writePrivateJson(path: string, value: unknown): void;
    },
    argv: readonly string[],
    environment: Readonly<Record<string, string | undefined>>,
  ): Promise<Record<string, unknown>>;
}

const observePath = 'scripts/t22/recovery/t22-k8s-recovery-observe.ts';
const commandPath = 'scripts/t22/recovery/t22-k8s-recovery-observe-command.ts';
const execFileAsync = promisify(execFile);
const secretCanary = '__observe_secret_must_not_escape__';

async function observeApi(): Promise<ObserveModule> {
  return (await import('./t22-k8s-recovery-observe')) as ObserveModule;
}

async function commandApi(): Promise<ObserveCommandModule> {
  return (await import('./t22-k8s-recovery-observe-command')) as ObserveCommandModule;
}

function metadata(name: string, uid: string, extra: Record<string, unknown> = {}) {
  return { name, uid, resourceVersion: `rv-${uid}`, ...extra };
}

function list(items: unknown[]) {
  return { apiVersion: 'v1', kind: 'List', items };
}

function fixtureResponses(): string[] {
  const claims = ['postgres', 'runtime', 'backup', 'pki'].map((name) => ({
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: metadata(`${name}-data`, `${name}-claim-uid`),
    spec: { volumeName: `ui4a-${name}-pv` },
  }));
  const volumes = ['postgres', 'runtime', 'backup', 'pki'].map((name) => ({
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: metadata(`ui4a-${name}-pv`, `${name}-volume-uid`),
    spec: {
      local: { path: `/srv/ui4a/${name}` },
      nodeAffinity: {
        required: {
          nodeSelectorTerms: [
            {
              matchExpressions: [
                { key: 'kubernetes.io/hostname', operator: 'In', values: ['k8s-w-2'] },
              ],
            },
          ],
        },
      },
    },
  }));
  const deployments = ['web', 'worker', 'keycloak', 'temporal'].map((name) => ({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metadata(name, `${name}-deployment-uid`),
    spec: { replicas: 0 },
    status: { readyReplicas: 0 },
  }));
  const jobs = [
    {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: metadata('ui4a-run-active', 'active-job-uid', {
        labels: { 'app.kubernetes.io/name': 'ui4a-agent-runner' },
      }),
      status: { active: 1 },
    },
    {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: metadata('ui4a-run-complete', 'complete-job-uid', {
        labels: { 'app.kubernetes.io/name': 'ui4a-agent-runner' },
      }),
      status: { succeeded: 1, completionTime: '2026-08-24T13:59:00.000Z' },
    },
  ];
  const probe = (name: string, uid: string) => ({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: metadata(name, uid, {
      labels: { 'ui4a.io/recovery-hwm-probe': 'true' },
    }),
    immutable: true,
    data: { eventHighWaterMark: '42' },
  });
  return [
    JSON.stringify({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: metadata('ui4a-system', 'namespace-current-uid'),
    }),
    JSON.stringify({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: metadata('postgres', 'postgres-service-uid'),
      spec: { clusterIP: '10.103.150.84' },
    }),
    JSON.stringify(list(claims)),
    JSON.stringify(list(volumes)),
    JSON.stringify(list(deployments)),
    JSON.stringify({
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: metadata('postgres', 'postgres-statefulset-uid'),
      spec: { replicas: 1 },
      status: { readyReplicas: 1 },
    }),
    JSON.stringify(list(jobs)),
    JSON.stringify(probe('ui4a-recovery-hwm-first', 'hwm-first-uid')),
    JSON.stringify(probe('ui4a-recovery-hwm-second', 'hwm-second-uid')),
  ];
}

function observerDependencies(overrides: { responses?: string[]; failAt?: number } = {}) {
  const responses = overrides.responses ?? fixtureResponses();
  let index = 0;
  return {
    run: vi.fn(async (_command: KubectlCommand) => {
      index += 1;
      if (index === overrides.failAt) throw new Error(secretCanary);
      return { exitCode: 0, stdout: responses[index - 1] ?? '{}' };
    }),
    clock: vi.fn(() => '2026-08-24T14:00:00.000Z'),
  };
}

const input = {
  namespace: 'ui4a-system',
  firstHwmProbe: 'ui4a-recovery-hwm-first',
  secondHwmProbe: 'ui4a-recovery-hwm-second',
};

describe('T22 Kubernetes recovery observed attestation capture', () => {
  it('plans only nine bounded kubectl get JSON commands without Secret resources', async () => {
    const { planKubernetesRecoveryObservation } = await observeApi();

    const commands = planKubernetesRecoveryObservation(input);

    expect(commands).toHaveLength(9);
    expect(commands.every(({ executable }) => executable === 'kubectl')).toBe(true);
    expect(
      commands.every(({ args }) => args.includes('get') && args.includes('--output=json')),
    ).toBe(true);
    const argv = commands.flatMap(({ args }) => args);
    expect(argv).not.toEqual(
      expect.arrayContaining([
        'secret',
        'secrets',
        'apply',
        'create',
        'delete',
        'patch',
        'scale',
        'exec',
      ]),
    );
  });

  it('captures exact current resource identity, readiness, active Runs and two HWM references', async () => {
    const { captureKubernetesRecoveryObservation } = await observeApi();
    const deps = observerDependencies();

    const result = await captureKubernetesRecoveryObservation(deps, input);

    expect(result).toMatchObject({
      current: {
        namespace: { name: 'ui4a-system', uid: 'namespace-current-uid' },
        postgresService: {
          name: 'postgres',
          uid: 'postgres-service-uid',
          clusterIp: '10.103.150.84',
        },
        claims: expect.arrayContaining([
          {
            name: 'postgres-data',
            uid: 'postgres-claim-uid',
            volumeName: 'ui4a-postgres-pv',
          },
        ]),
        volumes: expect.arrayContaining([
          {
            name: 'ui4a-postgres-pv',
            uid: 'postgres-volume-uid',
            hostPath: '/srv/ui4a/postgres',
            nodeName: 'k8s-w-2',
          },
        ]),
      },
      quiescence: {
        observedAt: '2026-08-24T14:00:00.000Z',
        workloads: {
          web: { desired: 0, ready: 0 },
          worker: { desired: 0, ready: 0 },
          keycloak: { desired: 0, ready: 0 },
          temporal: { desired: 0, ready: 0 },
        },
        runner: { daemonReplicas: 0, activeRunJobs: 1 },
        postgres: { desired: 1, ready: 1 },
        eventHighWaterMarks: [42, 42],
        eventHighWaterMarkProbes: [
          {
            name: 'ui4a-recovery-hwm-first',
            uid: 'hwm-first-uid',
            resourceVersion: 'rv-hwm-first-uid',
          },
          {
            name: 'ui4a-recovery-hwm-second',
            uid: 'hwm-second-uid',
            resourceVersion: 'rv-hwm-second-uid',
          },
        ],
      },
    });
    expect(deps.run).toHaveBeenCalledTimes(9);
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it('fails closed and redacts malformed or failed kubectl output', async () => {
    const { captureKubernetesRecoveryObservation } = await observeApi();
    const malformed = fixtureResponses();
    malformed[3] = JSON.stringify({ ...JSON.parse(malformed[3]!), items: [] });

    await expect(
      captureKubernetesRecoveryObservation(observerDependencies({ responses: malformed }), input),
    ).rejects.toMatchObject({ code: 'K8S_RECOVERY_OBSERVATION_INVALID' });
    await expect(
      captureKubernetesRecoveryObservation(observerDependencies({ failAt: 2 }), input),
    ).rejects.toMatchObject({ code: 'K8S_RECOVERY_OBSERVATION_COMMAND_FAILED' });
  });

  it('writes one stable observation receipt through an injected private writer', async () => {
    const api = await commandApi();
    const value = { current: { namespace: { name: 'ui4a-system' } }, quiescence: {} };
    const capture = vi.fn(async () => value);
    const writePrivateJson = vi.fn(() => undefined);

    const result = await api.executeKubernetesRecoveryObserveCli(
      { capture, writePrivateJson },
      ['capture'],
      {
        UI4A_K8S_RECOVERY_NAMESPACE: 'ui4a-system',
        UI4A_K8S_RECOVERY_HWM_PROBE_FIRST: 'ui4a-recovery-hwm-first',
        UI4A_K8S_RECOVERY_HWM_PROBE_SECOND: 'ui4a-recovery-hwm-second',
        UI4A_K8S_RECOVERY_OBSERVATION_OUTPUT_FILE: '/private/recovery-observation.json',
      },
    );

    expect(result).toEqual({
      ok: true,
      code: 'K8S_RECOVERY_OBSERVATION_WRITTEN',
      receipt: {
        namespace: 'ui4a-system',
        outputPath: '/private/recovery-observation.json',
        firstHwmProbe: 'ui4a-recovery-hwm-first',
        secondHwmProbe: 'ui4a-recovery-hwm-second',
      },
    });
    expect(writePrivateJson).toHaveBeenCalledWith('/private/recovery-observation.json', value);
    expect(JSON.stringify(result)).not.toContain(secretCanary);
  });

  it('returns stable redacted failures without writing partial evidence', async () => {
    const api = await commandApi();
    const writePrivateJson = vi.fn(() => undefined);
    const capture = vi.fn(async () => {
      throw new Error(secretCanary);
    });

    expect(
      await api.executeKubernetesRecoveryObserveCli({ capture, writePrivateJson }, ['capture'], {
        UI4A_K8S_RECOVERY_NAMESPACE: 'ui4a-system',
        UI4A_K8S_RECOVERY_HWM_PROBE_FIRST: 'ui4a-recovery-hwm-first',
        UI4A_K8S_RECOVERY_HWM_PROBE_SECOND: 'ui4a-recovery-hwm-second',
        UI4A_K8S_RECOVERY_OBSERVATION_OUTPUT_FILE: '/private/recovery-observation.json',
      }),
    ).toEqual({ ok: false, code: 'K8S_RECOVERY_OBSERVATION_FAILED' });
    expect(writePrivateJson).not.toHaveBeenCalled();
  });

  it('implements a no-overwrite exact-0600 output writer and stable invalid CLI JSON', async () => {
    expect(existsSync(resolve(observePath)), observePath).toBe(true);
    expect(existsSync(resolve(commandPath)), commandPath).toBe(true);
    const source = readFileSync(resolve(commandPath), 'utf8');
    expect(source).toContain('O_NOFOLLOW');
    expect(source).toContain('O_EXCL');
    expect(source).toContain('0o600');
    expect(source).toMatch(/isAbsolute/);
    expect(source).not.toMatch(/shell:\s*true|execSync|spawnSync/);

    await expect(
      execFileAsync('apps/worker/node_modules/.bin/tsx', [commandPath, 'invalid'], {
        cwd: process.cwd(),
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: '{"ok":false,"code":"K8S_RECOVERY_OBSERVATION_USAGE_INVALID"}\n',
    });
  });
});
