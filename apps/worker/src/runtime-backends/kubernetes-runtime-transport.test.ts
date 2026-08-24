import { describe, expect, it, vi } from 'vitest';

import type { AgentRunWorkflowArgs } from '../agents/host/contracts';
import type {
  CompiledRuntimeTransportEnvelope,
  CompiledRuntimeTransportResult,
} from './production-wiring';
import {
  createInClusterKubernetesRuntimeApi,
  createInClusterKubernetesRuntimeTransport,
  type KubernetesRuntimeApi,
} from './kubernetes-runtime-transport';

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const image = `registry.internal/ui4a/agent-runner@${digest('a')}`;

function birth(): AgentRunWorkflowArgs['birth'] {
  return {
    schemaVersion: 1,
    kind: 'event-native',
    definition: {
      ref: 'editorial-writer',
      version: 1,
      sourceHash: digest('1'),
      parentHashes: [],
      flattenedHash: digest('2'),
    },
    prompt: { templateHash: digest('3'), compiledHash: digest('4') },
    runtime: {
      profileName: 'writing-k8s',
      profileVersion: '1',
      adapterVersion: 'document-agent-runtime@1',
    },
    taskContract: { ref: 'writing-task@1', hash: digest('5') },
    resultContract: { ref: 'writing-result@1', hash: digest('6') },
  } as AgentRunWorkflowArgs['birth'];
}

function envelope(): CompiledRuntimeTransportEnvelope {
  return {
    schemaVersion: 1,
    runId: 'agent-run:kubernetes:42',
    specialization: 'writing',
    birth: birth(),
    request: {
      schemaVersion: 1,
      compiledHash: digest('4'),
      messages: [
        { role: 'system', content: 'Use only the sealed contract.' },
        { role: 'user', content: '{"briefRef":"artifact:42"}' },
      ],
      outputSchema: { type: 'object', required: ['status'] },
      sandboxMode: 'workspace-write',
    },
    execution: {
      profileId: 'writing-k8s',
      backend: 'kubernetes-job',
      image,
      workspace: { rootRef: '/workspaces/writing' },
      resources: { cpu: '1', memory: '1Gi', timeoutMs: 60_000 },
      networkPolicy: 'restricted',
      credentialRefs: ['llm-api-key'],
    },
  };
}

function runnerResult(delivery: Record<string, unknown>): Record<string, unknown> {
  const request = delivery.request as Record<string, unknown>;
  return {
    schemaVersion: 1,
    deliveryId: delivery.deliveryId,
    runId: request.runId,
    specialization: request.specialization,
    status: 'succeeded',
    birth: request.birth,
    candidate: {
      schemaVersion: 1,
      nativeSessionId: 'codex-session:kubernetes:42',
      result: { status: 'completed', summary: 'bounded' },
      events: [{ type: 'thread.started', thread_id: 'codex-session:kubernetes:42' }],
    },
    artifacts: [],
    resultHash: digest('9'),
  };
}

interface ApiFixture {
  api: KubernetesRuntimeApi;
  objects: { configMaps: Record<string, unknown>[]; jobs: Record<string, unknown>[] };
  deleted: { configMaps: string[]; jobs: string[] };
}

function apiFixture(
  input: {
    existingConfigMap?: Record<string, unknown>;
    existingJob?: Record<string, unknown>;
    jobStates?: Record<string, unknown>[];
    pods?: Record<string, unknown>[];
    log?: (delivery: Record<string, unknown>) => string;
  } = {},
): ApiFixture {
  const objects = {
    configMaps: [] as Record<string, unknown>[],
    jobs: [] as Record<string, unknown>[],
  };
  const deleted = { configMaps: [] as string[], jobs: [] as string[] };
  let configMap = input.existingConfigMap;
  let job = input.existingJob;
  const states = [...(input.jobStates ?? [])];
  const api: KubernetesRuntimeApi = {
    getConfigMap: vi.fn(async () => configMap),
    createConfigMap: vi.fn(async (_namespace, value) => {
      objects.configMaps.push(structuredClone(value));
      configMap = {
        ...structuredClone(value),
        metadata: { ...(value.metadata as object), uid: 'cm-42' },
      };
      return configMap!;
    }),
    deleteConfigMap: vi.fn(async (_namespace, name) => {
      deleted.configMaps.push(name);
    }),
    getJob: vi.fn(async () => {
      if (job === undefined) return undefined;
      const state = states.shift();
      if (state === undefined) return job;
      return {
        ...job,
        ...state,
        metadata: {
          ...(job.metadata as object),
          ...((state.metadata as object | undefined) ?? {}),
          name: (job.metadata as { name: string }).name,
          uid: (job.metadata as { uid: string }).uid,
          annotations: (job.metadata as { annotations: object }).annotations,
        },
      };
    }),
    createJob: vi.fn(async (_namespace, value) => {
      objects.jobs.push(structuredClone(value));
      job = {
        ...structuredClone(value),
        metadata: { ...(value.metadata as object), uid: 'job-uid-42', resourceVersion: '1' },
        status: { active: 1 },
      };
      return job!;
    }),
    deleteJob: vi.fn(async (_namespace, name) => {
      deleted.jobs.push(name);
    }),
    listPods: vi.fn(
      async () =>
        input.pods ?? [
          {
            metadata: {
              name: 'ui4a-agent-run-pod',
              uid: 'pod-uid-42',
              ownerReferences: [
                {
                  apiVersion: 'batch/v1',
                  kind: 'Job',
                  name: (job?.metadata as { name?: string } | undefined)?.name,
                  uid: (job?.metadata as { uid?: string } | undefined)?.uid,
                  controller: true,
                },
              ],
            },
            status: { phase: 'Succeeded' },
          },
        ],
    ),
    readPodLog: vi.fn(async () => {
      const delivery = JSON.parse(
        String((configMap?.data as Record<string, unknown> | undefined)?.['delivery.json']),
      ) as Record<string, unknown>;
      return input.log?.(delivery) ?? JSON.stringify(runnerResult(delivery));
    }),
  };
  return { api, objects, deleted };
}

function transport(api: KubernetesRuntimeApi) {
  return createInClusterKubernetesRuntimeTransport({
    api,
    namespace: 'ui4a',
    settingsConfigMapName: 'ui4a-runtime-settings',
    settingsKey: 'settings.json',
    secretsSecretName: 'ui4a-runtime-secrets',
    secretsKey: 'secrets.json',
    workspaceClaimName: 'ui4a-runtime-workspace',
    workspaceMountPath: '/workspaces',
    runnerServiceAccountName: 'ui4a-runner',
    pollIntervalMs: 1,
    forbiddenSecretValues: ['super-secret-value'],
    wait: vi.fn(async () => undefined),
  });
}

describe('T22 in-cluster Kubernetes compiled Runtime transport', () => {
  it('creates a deterministic delivery ConfigMap and one-shot Job without Secret material', async () => {
    const fixture = apiFixture({
      jobStates: [
        {
          metadata: { name: 'pending', uid: 'job-uid-42', resourceVersion: '2' },
          status: { active: 1 },
        },
        {
          metadata: { name: 'pending', uid: 'job-uid-42', resourceVersion: '3' },
          status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] },
        },
      ],
    });

    const result = await transport(fixture.api).execute({
      envelope: envelope(),
      signal: new AbortController().signal,
      reportProgress: vi.fn(),
    });

    expect(result).toEqual<CompiledRuntimeTransportResult>({
      schemaVersion: 1,
      runId: envelope().runId,
      birth: birth(),
      nativeSessionId: 'codex-session:kubernetes:42',
      result: { status: 'completed', summary: 'bounded' },
      events: [{ type: 'thread.started', thread_id: 'codex-session:kubernetes:42' }],
    });
    expect(fixture.objects.configMaps).toHaveLength(1);
    expect(fixture.objects.jobs).toHaveLength(1);
    expect(
      (
        (
          (fixture.objects.jobs[0]!.spec as Record<string, unknown>).template as Record<
            string,
            unknown
          >
        ).metadata as Record<string, unknown>
      ).annotations,
    ).toEqual({ 'sidecar.istio.io/inject': 'false' });
    const serializedObjects = JSON.stringify(fixture.objects);
    expect(serializedObjects).not.toContain('super-secret-value');
    expect(serializedObjects).not.toContain('Authorization');
    expect(serializedObjects).toContain('ui4a-runtime-secrets');
    expect(serializedObjects).toContain('ui4a-runtime-settings');
    expect(serializedObjects).toContain('ui4a-runtime-workspace');
    expect(serializedObjects).toContain('node');
    expect(serializedObjects).toContain('dist/main.js');
    expect(serializedObjects).toContain('oneshot');
    expect(serializedObjects).toContain(image);
  });

  it('discovers and reuses an exact existing delivery after Worker restart', async () => {
    const first = apiFixture({
      jobStates: [
        {
          metadata: { name: 'existing-job', uid: 'job-uid-42', resourceVersion: '9' },
          status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] },
        },
      ],
    });
    await transport(first.api).execute({
      envelope: envelope(),
      signal: new AbortController().signal,
      reportProgress: vi.fn(),
    });
    const existingConfigMap = first.objects.configMaps[0]!;
    const existingJob = first.objects.jobs[0]!;
    const restarted = apiFixture({
      existingConfigMap,
      existingJob: {
        ...existingJob,
        metadata: { ...(existingJob.metadata as object), uid: 'job-uid-42', resourceVersion: '10' },
        status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] },
      },
      log: (delivery) => JSON.stringify(runnerResult(delivery)),
    });

    await expect(
      transport(restarted.api).execute({
        envelope: envelope(),
        signal: new AbortController().signal,
        reportProgress: vi.fn(),
      }),
    ).resolves.toMatchObject({ runId: envelope().runId });
    expect(restarted.api.createConfigMap).not.toHaveBeenCalled();
    expect(restarted.api.createJob).not.toHaveBeenCalled();
  });

  it('deletes only its exact Job and ConfigMap when Temporal cancellation aborts the activity', async () => {
    const controller = new AbortController();
    const fixture = apiFixture({
      jobStates: [
        {
          metadata: { name: 'pending', uid: 'job-uid-42', resourceVersion: '2' },
          status: { active: 1 },
        },
      ],
    });
    const runtime = createInClusterKubernetesRuntimeTransport({
      api: fixture.api,
      namespace: 'ui4a',
      settingsConfigMapName: 'ui4a-runtime-settings',
      settingsKey: 'settings.json',
      secretsSecretName: 'ui4a-runtime-secrets',
      secretsKey: 'secrets.json',
      workspaceClaimName: 'ui4a-runtime-workspace',
      workspaceMountPath: '/workspaces',
      runnerServiceAccountName: 'ui4a-runner',
      pollIntervalMs: 1,
      forbiddenSecretValues: ['super-secret-value'],
      wait: vi.fn(async () => controller.abort()),
    });

    await expect(
      runtime.execute({ envelope: envelope(), signal: controller.signal, reportProgress: vi.fn() }),
    ).rejects.toThrow('runtime_kubernetes_cancelled');
    expect(fixture.deleted.jobs).toHaveLength(1);
    expect(fixture.deleted.configMaps).toHaveLength(1);
  });

  it('bounds the wait by the profile timeout and cleans up the exact delivery', async () => {
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(envelope().execution.resources.timeoutMs + 1);
    const fixture = apiFixture();
    try {
      await expect(
        transport(fixture.api).execute({
          envelope: envelope(),
          signal: new AbortController().signal,
          reportProgress: vi.fn(),
        }),
      ).rejects.toThrow('runtime_kubernetes_timeout');
      expect(fixture.deleted.jobs).toHaveLength(1);
      expect(fixture.deleted.configMaps).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });

  it('uses the mounted ServiceAccount bearer token and CA only in the Kubernetes REST port', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const api = createInClusterKubernetesRuntimeApi(
      {},
      {
        readFile: (path) =>
          path.endsWith('/token') ? '__test_service_account_token__' : '__test_cluster_ca__',
        request: vi.fn(async (input) => {
          requests.push(input);
          return { status: 404, body: '' };
        }),
      },
    );

    await expect(api.getJob('ui4a', 'ui4a-run-42')).resolves.toBeUndefined();
    expect(requests).toEqual([
      expect.objectContaining({
        origin: 'https://kubernetes.default.svc',
        method: 'GET',
        path: '/apis/batch/v1/namespaces/ui4a/jobs/ui4a-run-42',
        token: '__test_service_account_token__',
        ca: '__test_cluster_ca__',
      }),
    ]);
  });

  it('rejects Secret material before creating either Kubernetes object', async () => {
    const fixture = apiFixture();
    const injected = envelope();
    injected.request.messages[1]!.content = 'super-secret-value';

    await expect(
      transport(fixture.api).execute({
        envelope: injected,
        signal: new AbortController().signal,
        reportProgress: vi.fn(),
      }),
    ).rejects.toThrow('runtime_kubernetes_delivery_invalid');
    expect(fixture.api.createConfigMap).not.toHaveBeenCalled();
    expect(fixture.api.createJob).not.toHaveBeenCalled();
  });

  it.each([
    [
      'foreign Pod owner',
      { pods: [{ metadata: { name: 'foreign', ownerReferences: [] } }], log: undefined },
      'runtime_kubernetes_pod_owner_invalid',
    ],
    [
      'invalid Runner result',
      { log: () => '{"status":"forged"}' },
      'runtime_kubernetes_result_invalid',
    ],
  ] as const)('fails closed for %s', async (_name, input, error) => {
    const fixture = apiFixture({
      jobStates: [
        {
          metadata: { name: 'terminal', uid: 'job-uid-42', resourceVersion: '3' },
          status: { succeeded: 1, conditions: [{ type: 'Complete', status: 'True' }] },
        },
      ],
      ...(!('pods' in input) || input.pods === undefined ? {} : { pods: [...input.pods] }),
      ...(input.log === undefined ? {} : { log: input.log }),
    });

    await expect(
      transport(fixture.api).execute({
        envelope: envelope(),
        signal: new AbortController().signal,
        reportProgress: vi.fn(),
      }),
    ).rejects.toThrow(error);
  });
});
