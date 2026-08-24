import { describe, expect, it, vi } from 'vitest';

type Sha256 = `sha256:${string}`;

interface RuntimeTask {
  schemaVersion: 1;
  runId: string;
  deliveryId: string;
  kind: 'coding' | 'writing' | 'authoring';
  payload: Record<string, unknown>;
  birth: { definitionHash: Sha256; promptHash: Sha256; runtimeHash: Sha256 };
}

interface KubernetesBackendConfig {
  namespace: string;
  image: string;
  serviceAccountName: string;
  command: string[];
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
  networkPolicyRef: string;
  workspace: { claimPrefix: string; mountPath: string };
  activeDeadlineSeconds: number;
  ttlSecondsAfterFinished: number;
}

interface OwnerReference {
  apiVersion: 'batch/v1';
  kind: 'Job';
  name: string;
  uid: string;
  controller: true;
}

interface KubernetesEvent {
  type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR';
  resourceVersion: string;
  object: {
    kind: 'Job' | 'Pod';
    metadata: {
      name: string;
      uid: string;
      labels: Record<string, string>;
      ownerReferences?: OwnerReference[];
    };
    phase?: 'Pending' | 'Running' | 'Succeeded' | 'Failed';
    reason?: 'Completed' | 'Evicted' | 'WatchDisconnected' | 'DeadlineExceeded';
  };
}

interface DeliveryReceipt {
  runId: string;
  deliveryId: string;
  backend: 'kubernetes';
  jobName: string;
  jobUid: string;
  networkPolicyRef: string;
  workspace: {
    claimName: string;
    retention: 'until-human-decision';
  };
  job: Record<string, unknown>;
}

interface CallbackReceipt {
  callbackId: string;
  runId: string;
  resultHash: Sha256;
  accepted: true;
  duplicate: boolean;
}

interface KubernetesClient {
  createJob(namespace: string, job: Record<string, unknown>): Promise<{ uid: string }>;
  watchRun(namespace: string, labels: Record<string, string>): AsyncIterable<KubernetesEvent>;
  deleteJob(
    namespace: string,
    jobName: string,
    options: { propagationPolicy: 'Foreground'; gracePeriodSeconds: 0 },
  ): Promise<void>;
  findRun(namespace: string, runId: string): Promise<KubernetesEvent[]>;
  deleteWorkspaceClaim(namespace: string, claimName: string): Promise<void>;
}

interface IdempotencyStore {
  deliveries: Map<string, DeliveryReceipt>;
  callbacks: Map<string, CallbackReceipt>;
}

interface KubernetesJobBackend {
  deliver(task: RuntimeTask): Promise<DeliveryReceipt>;
  watch(
    receipt: DeliveryReceipt,
    heartbeat: (event: { runId: string; resourceVersion: string; phase: string }) => void,
  ): Promise<{
    status: 'completed' | 'failed' | 'reconciling';
    reason: string;
    backend: 'kubernetes';
    fallback: false;
  }>;
  cancel(receipt: DeliveryReceipt): Promise<{ status: 'cancel-requested'; duplicate: boolean }>;
  reconcile(runId: string): Promise<{
    status: 'watching' | 'failed' | 'missing';
    reason: string;
    restartBoundary: true;
    backend: 'kubernetes';
    fallback: false;
  }>;
  acceptCallback(input: {
    callbackId: string;
    runId: string;
    deliveryId: string;
    resultHash: Sha256;
  }): Promise<CallbackReceipt>;
  releaseWorkspace(
    receipt: DeliveryReceipt,
    decision: 'accepted' | 'rejected',
  ): Promise<{ released: true; decision: 'accepted' | 'rejected' }>;
}

interface KubernetesJobModule {
  createKubernetesJobBackend(input: {
    config: KubernetesBackendConfig;
    client: KubernetesClient;
    idempotency: IdempotencyStore;
  }): KubernetesJobBackend;
}

const plannedModulePath = './kubernetes-job';
const SHA_A = `sha256:${'a'.repeat(64)}` as const;
const SHA_B = `sha256:${'b'.repeat(64)}` as const;
const RUN_LABELS = {
  'app.kubernetes.io/name': 'ui4a-agent-runner',
  'app.kubernetes.io/component': 'runtime',
  'ui4a.dev/run-id': 'run-42',
  'ui4a.dev/delivery-id': 'delivery-42',
};

const config: KubernetesBackendConfig = {
  namespace: 'ui4a-runtime',
  image: 'registry.internal/ui4a/agent-runner@sha256:' + '1'.repeat(64),
  serviceAccountName: 'ui4a-agent-runtime',
  command: ['node', '/app/apps/agent-runner/dist/main.js', 'oneshot'],
  resources: {
    requests: { cpu: '500m', memory: '512Mi' },
    limits: { cpu: '2', memory: '2Gi' },
  },
  networkPolicyRef: 'ui4a-runtime-egress-deny',
  workspace: { claimPrefix: 'ui4a-run-', mountPath: '/workspaces/run' },
  activeDeadlineSeconds: 900,
  ttlSecondsAfterFinished: 3600,
};

function task(overrides: Partial<RuntimeTask> = {}): RuntimeTask {
  return {
    schemaVersion: 1,
    runId: 'run-42',
    deliveryId: 'delivery-42',
    kind: 'coding',
    payload: { instruction: 'Change the bounded artifact.' },
    birth: { definitionHash: SHA_A, promptHash: SHA_B, runtimeHash: SHA_A },
    ...overrides,
  };
}

async function plannedApi(): Promise<KubernetesJobModule> {
  return (await import(plannedModulePath)) as KubernetesJobModule;
}

async function* eventStream(events: KubernetesEvent[]): AsyncIterable<KubernetesEvent> {
  for (const event of events) yield event;
}

function client(overrides: Partial<KubernetesClient> = {}): KubernetesClient {
  return {
    createJob: vi.fn(async () => ({ uid: 'job-uid-42' })),
    watchRun: vi.fn(() => eventStream([])),
    deleteJob: vi.fn(async () => undefined),
    findRun: vi.fn(async () => []),
    deleteWorkspaceClaim: vi.fn(async () => undefined),
    ...overrides,
  };
}

function idempotencyStore(): IdempotencyStore {
  return { deliveries: new Map(), callbacks: new Map() };
}

async function backend(
  overrides: Partial<KubernetesClient> = {},
  store = idempotencyStore(),
): Promise<{ backend: KubernetesJobBackend; client: KubernetesClient; store: IdempotencyStore }> {
  const { createKubernetesJobBackend } = await plannedApi();
  const kubernetesClient = client(overrides);
  return {
    backend: createKubernetesJobBackend({ config, client: kubernetesClient, idempotency: store }),
    client: kubernetesClient,
    store,
  };
}

describe('T22 Kubernetes Job Runtime Backend contract', () => {
  it('creates one fixed, isolated Job and workspace per sealed Run', async () => {
    const fixture = await backend();

    const receipt = await fixture.backend.deliver(task());

    expect(receipt).toMatchObject({
      runId: 'run-42',
      deliveryId: 'delivery-42',
      backend: 'kubernetes',
      jobName: 'ui4a-run-run-42',
      jobUid: 'job-uid-42',
      networkPolicyRef: 'ui4a-runtime-egress-deny',
      workspace: {
        claimName: 'ui4a-run-run-42',
        retention: 'until-human-decision',
      },
    });
    expect(fixture.client.createJob).toHaveBeenCalledWith(
      'ui4a-runtime',
      expect.objectContaining({
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: 'ui4a-run-run-42',
          namespace: 'ui4a-runtime',
          labels: RUN_LABELS,
          annotations: {
            'ui4a.dev/network-policy': 'ui4a-runtime-egress-deny',
            'ui4a.dev/workspace-retention': 'until-human-decision',
          },
        },
        spec: expect.objectContaining({
          backoffLimit: 0,
          activeDeadlineSeconds: 900,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: { labels: RUN_LABELS },
            spec: expect.objectContaining({
              serviceAccountName: 'ui4a-agent-runtime',
              automountServiceAccountToken: false,
              restartPolicy: 'Never',
              securityContext: {
                runAsNonRoot: true,
                seccompProfile: { type: 'RuntimeDefault' },
              },
              containers: [
                expect.objectContaining({
                  name: 'runner',
                  image: config.image,
                  imagePullPolicy: 'IfNotPresent',
                  command: config.command,
                  workingDir: '/app',
                  env: [{ name: 'UI4A_RUN_REF', value: 'run:run-42' }],
                  resources: config.resources,
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: true,
                    capabilities: { drop: ['ALL'] },
                  },
                  volumeMounts: [{ name: 'workspace', mountPath: '/workspaces/run' }],
                }),
              ],
              volumes: [
                {
                  name: 'workspace',
                  persistentVolumeClaim: { claimName: 'ui4a-run-run-42' },
                },
              ],
            }),
          },
        }),
      }),
    );
  });

  it.each(['backend', 'image', 'command', 'cwd', 'provider', 'model', 'env'])(
    'rejects request-controlled %s before creating a Job',
    async (field) => {
      const fixture = await backend();
      const unsafe = { ...task(), [field]: 'request-controlled' } as RuntimeTask;

      await expect(fixture.backend.deliver(unsafe)).rejects.toThrow(
        expect.objectContaining({ code: 'RUNTIME_TASK_OVERRIDE_FORBIDDEN', field }),
      );
      expect(fixture.client.createJob).not.toHaveBeenCalled();
    },
  );

  it('watches the owned Pod, emits heartbeats, and returns a terminal completion', async () => {
    const fixture = await backend({
      watchRun: vi.fn(() =>
        eventStream([
          {
            type: 'ADDED',
            resourceVersion: '1',
            object: {
              kind: 'Pod',
              metadata: {
                name: 'ui4a-run-run-42-pod',
                uid: 'pod-uid-42',
                labels: RUN_LABELS,
                ownerReferences: [
                  {
                    apiVersion: 'batch/v1',
                    kind: 'Job',
                    name: 'ui4a-run-run-42',
                    uid: 'job-uid-42',
                    controller: true,
                  },
                ],
              },
              phase: 'Running',
            },
          },
          {
            type: 'MODIFIED',
            resourceVersion: '2',
            object: {
              kind: 'Job',
              metadata: { name: 'ui4a-run-run-42', uid: 'job-uid-42', labels: RUN_LABELS },
              reason: 'Completed',
            },
          },
        ]),
      ),
    });
    const receipt = await fixture.backend.deliver(task());
    const heartbeat = vi.fn();

    await expect(fixture.backend.watch(receipt, heartbeat)).resolves.toEqual({
      status: 'completed',
      reason: 'job-completed',
      backend: 'kubernetes',
      fallback: false,
    });
    expect(fixture.client.watchRun).toHaveBeenCalledWith('ui4a-runtime', RUN_LABELS);
    expect(heartbeat).toHaveBeenNthCalledWith(1, {
      runId: 'run-42',
      resourceVersion: '1',
      phase: 'Running',
    });
    expect(heartbeat).toHaveBeenNthCalledWith(2, {
      runId: 'run-42',
      resourceVersion: '2',
      phase: 'Completed',
    });
  });

  it('rejects a Pod without the exact Job controller owner reference', async () => {
    const fixture = await backend({
      watchRun: vi.fn(() =>
        eventStream([
          {
            type: 'ADDED',
            resourceVersion: '1',
            object: {
              kind: 'Pod',
              metadata: {
                name: 'foreign-pod',
                uid: 'foreign-uid',
                labels: RUN_LABELS,
                ownerReferences: [],
              },
              phase: 'Running',
            },
          },
        ]),
      ),
    });
    const receipt = await fixture.backend.deliver(task());

    await expect(fixture.backend.watch(receipt, vi.fn())).rejects.toThrow(
      expect.objectContaining({ code: 'KUBERNETES_POD_OWNER_INVALID' }),
    );
  });

  it('cancels by foreground Job deletion and makes duplicate cancellation idempotent', async () => {
    const fixture = await backend();
    const receipt = await fixture.backend.deliver(task());

    await expect(fixture.backend.cancel(receipt)).resolves.toEqual({
      status: 'cancel-requested',
      duplicate: false,
    });
    await expect(fixture.backend.cancel(receipt)).resolves.toEqual({
      status: 'cancel-requested',
      duplicate: true,
    });
    expect(fixture.client.deleteJob).toHaveBeenCalledTimes(1);
    expect(fixture.client.deleteJob).toHaveBeenCalledWith('ui4a-runtime', 'ui4a-run-run-42', {
      propagationPolicy: 'Foreground',
      gracePeriodSeconds: 0,
    });
  });

  it.each([
    ['Evicted', 'pod-evicted'],
    ['DeadlineExceeded', 'job-timeout'],
  ] as const)('reconciles %s into an auditable no-fallback failure', async (reason, expected) => {
    const fixture = await backend({
      findRun: vi.fn(async (): Promise<KubernetesEvent[]> => [
        {
          type: 'MODIFIED',
          resourceVersion: '7',
          object: {
            kind: reason === 'Evicted' ? 'Pod' : 'Job',
            metadata: { name: 'ui4a-run-run-42', uid: 'uid-42', labels: RUN_LABELS },
            phase: 'Failed',
            reason,
          },
        },
      ]),
    });

    await expect(fixture.backend.reconcile('run-42')).resolves.toEqual({
      status: 'failed',
      reason: expected,
      restartBoundary: true,
      backend: 'kubernetes',
      fallback: false,
    });
  });

  it('turns a watch disconnect into reconciliation without switching backend', async () => {
    const fixture = await backend({
      watchRun: vi.fn(() =>
        eventStream([
          {
            type: 'ERROR',
            resourceVersion: '9',
            object: {
              kind: 'Job',
              metadata: { name: 'ui4a-run-run-42', uid: 'job-uid-42', labels: RUN_LABELS },
              reason: 'WatchDisconnected',
            },
          },
        ]),
      ),
    });
    const receipt = await fixture.backend.deliver(task());

    await expect(fixture.backend.watch(receipt, vi.fn())).resolves.toEqual({
      status: 'reconciling',
      reason: 'watch-disconnected',
      backend: 'kubernetes',
      fallback: false,
    });
  });

  it('re-discovers one active labeled Job after Worker restart instead of creating a duplicate', async () => {
    const fixture = await backend({
      findRun: vi.fn(async (): Promise<KubernetesEvent[]> => [
        {
          type: 'MODIFIED',
          resourceVersion: '10',
          object: {
            kind: 'Pod',
            metadata: {
              name: 'ui4a-run-run-42-pod',
              uid: 'pod-uid-42',
              labels: RUN_LABELS,
              ownerReferences: [
                {
                  apiVersion: 'batch/v1',
                  kind: 'Job',
                  name: 'ui4a-run-run-42',
                  uid: 'job-uid-42',
                  controller: true,
                },
              ],
            },
            phase: 'Running',
          },
        },
      ]),
    });

    await expect(fixture.backend.reconcile('run-42')).resolves.toEqual({
      status: 'watching',
      reason: 'job-running',
      restartBoundary: true,
      backend: 'kubernetes',
      fallback: false,
    });
    expect(fixture.client.findRun).toHaveBeenCalledWith('ui4a-runtime', 'run-42');
    expect(fixture.client.createJob).not.toHaveBeenCalled();
  });

  it('reuses durable delivery and callback receipts across duplicate delivery and Worker restart', async () => {
    const store = idempotencyStore();
    const first = await backend({}, store);
    const delivery = await first.backend.deliver(task());
    const firstCallback = await first.backend.acceptCallback({
      callbackId: 'callback-42',
      runId: 'run-42',
      deliveryId: 'delivery-42',
      resultHash: SHA_A,
    });
    const restarted = await backend({}, store);

    await expect(restarted.backend.deliver(task())).resolves.toEqual(delivery);
    await expect(
      restarted.backend.acceptCallback({
        callbackId: 'callback-42',
        runId: 'run-42',
        deliveryId: 'delivery-42',
        resultHash: SHA_A,
      }),
    ).resolves.toEqual({ ...firstCallback, duplicate: true });
    expect(first.client.createJob).toHaveBeenCalledTimes(1);
    expect(restarted.client.createJob).not.toHaveBeenCalled();
  });

  it('rejects a duplicate callback whose canonical result differs', async () => {
    const fixture = await backend();
    await fixture.backend.deliver(task());
    await fixture.backend.acceptCallback({
      callbackId: 'callback-42',
      runId: 'run-42',
      deliveryId: 'delivery-42',
      resultHash: SHA_A,
    });

    await expect(
      fixture.backend.acceptCallback({
        callbackId: 'callback-42',
        runId: 'run-42',
        deliveryId: 'delivery-42',
        resultHash: SHA_B,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'RUNTIME_CALLBACK_CONFLICT' }));
  });

  it('retains a Coding workspace after completion until a human decision releases it', async () => {
    const fixture = await backend();
    const receipt = await fixture.backend.deliver(task());

    expect(receipt.workspace.retention).toBe('until-human-decision');
    expect(fixture.client.deleteWorkspaceClaim).not.toHaveBeenCalled();
    await expect(fixture.backend.releaseWorkspace(receipt, 'accepted')).resolves.toEqual({
      released: true,
      decision: 'accepted',
    });
    expect(fixture.client.deleteWorkspaceClaim).toHaveBeenCalledWith(
      'ui4a-runtime',
      'ui4a-run-run-42',
    );
  });

  it('fails closed with zero fallback when Kubernetes is unavailable', async () => {
    const fixture = await backend({
      createJob: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    });

    await expect(fixture.backend.deliver(task())).rejects.toThrow(
      expect.objectContaining({
        code: 'KUBERNETES_UNAVAILABLE',
        backend: 'kubernetes',
        fallback: false,
      }),
    );
  });
});
