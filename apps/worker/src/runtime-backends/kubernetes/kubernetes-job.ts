import { createHash } from 'node:crypto';

import type { RuntimeBackendExecutionPort, RuntimeBackendSpi } from '../backend';

type Sha256 = `sha256:${string}`;

export interface RuntimeTask {
  schemaVersion: 1;
  runId: string;
  deliveryId: string;
  kind: 'coding' | 'writing' | 'authoring';
  payload: Record<string, unknown>;
  birth: { definitionHash: Sha256; promptHash: Sha256; runtimeHash: Sha256 };
}

export interface KubernetesBackendConfig {
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

export interface OwnerReference {
  apiVersion: 'batch/v1';
  kind: 'Job';
  name: string;
  uid: string;
  controller: true;
}

export interface KubernetesEvent {
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

export interface DeliveryReceipt {
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

export interface CallbackReceipt {
  callbackId: string;
  runId: string;
  resultHash: Sha256;
  accepted: true;
  duplicate: boolean;
}

export interface KubernetesClient {
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

export interface IdempotencyStore {
  deliveries: Map<string, DeliveryReceipt>;
  callbacks: Map<string, CallbackReceipt>;
}

export type KubernetesBackendErrorCode =
  | 'KUBERNETES_POD_OWNER_INVALID'
  | 'KUBERNETES_UNAVAILABLE'
  | 'RUNTIME_CALLBACK_CONFLICT'
  | 'RUNTIME_CALLBACK_INVALID'
  | 'RUNTIME_TASK_INVALID'
  | 'RUNTIME_TASK_OVERRIDE_FORBIDDEN';

export class KubernetesBackendError extends Error {
  readonly backend?: 'kubernetes';
  readonly fallback?: false;
  readonly field?: string;

  constructor(
    readonly code: KubernetesBackendErrorCode,
    details: { backend?: 'kubernetes'; fallback?: false; field?: string } = {},
  ) {
    super(code);
    this.name = 'KubernetesBackendError';
    this.backend = details.backend;
    this.fallback = details.fallback;
    this.field = details.field;
  }
}

export interface KubernetesJobBackend extends RuntimeBackendSpi {
  kind: 'kubernetes-job';
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

const FORBIDDEN_TASK_FIELDS = [
  'backend',
  'image',
  'command',
  'cwd',
  'provider',
  'model',
  'env',
] as const;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const LABEL_VALUE_PATTERN = /^[a-z0-9](?:[-a-z0-9_.]{0,61}[a-z0-9])?$/;

function unavailable(): KubernetesBackendError {
  return new KubernetesBackendError('KUBERNETES_UNAVAILABLE', {
    backend: 'kubernetes',
    fallback: false,
  });
}

function assertTask(task: RuntimeTask): void {
  const candidate = task as RuntimeTask & Record<string, unknown>;
  for (const field of FORBIDDEN_TASK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)) {
      throw new KubernetesBackendError('RUNTIME_TASK_OVERRIDE_FORBIDDEN', { field });
    }
  }
  if (
    task.schemaVersion !== 1 ||
    !LABEL_VALUE_PATTERN.test(task.runId) ||
    !LABEL_VALUE_PATTERN.test(task.deliveryId) ||
    (task.kind !== 'coding' && task.kind !== 'writing' && task.kind !== 'authoring') ||
    !SHA256_PATTERN.test(task.birth.definitionHash) ||
    !SHA256_PATTERN.test(task.birth.promptHash) ||
    !SHA256_PATTERN.test(task.birth.runtimeHash)
  ) {
    throw new KubernetesBackendError('RUNTIME_TASK_INVALID');
  }
}

function runLabels(runId: string, deliveryId: string): Record<string, string> {
  return {
    'app.kubernetes.io/name': 'ui4a-agent-runner',
    'app.kubernetes.io/component': 'runtime',
    'ui4a.dev/run-id': runId,
    'ui4a.dev/delivery-id': deliveryId,
  };
}

function buildJob(
  config: KubernetesBackendConfig,
  task: RuntimeTask,
  jobName: string,
  labels: Record<string, string>,
): Record<string, unknown> {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: config.namespace,
      labels,
      annotations: {
        'ui4a.dev/network-policy': config.networkPolicyRef,
        'ui4a.dev/workspace-retention': 'until-human-decision',
      },
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: config.activeDeadlineSeconds,
      ttlSecondsAfterFinished: config.ttlSecondsAfterFinished,
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName: config.serviceAccountName,
          automountServiceAccountToken: false,
          restartPolicy: 'Never',
          securityContext: {
            runAsNonRoot: true,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          containers: [
            {
              name: 'runner',
              image: config.image,
              imagePullPolicy: 'IfNotPresent',
              command: [...config.command],
              workingDir: '/app',
              env: [{ name: 'UI4A_RUN_REF', value: `run:${task.runId}` }],
              resources: {
                requests: { ...config.resources.requests },
                limits: { ...config.resources.limits },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ['ALL'] },
              },
              volumeMounts: [{ name: 'workspace', mountPath: config.workspace.mountPath }],
            },
          ],
          volumes: [
            {
              name: 'workspace',
              persistentVolumeClaim: { claimName: jobName },
            },
          ],
        },
      },
    },
  };
}

function hasExactJobOwner(event: KubernetesEvent, receipt: DeliveryReceipt): boolean {
  return (
    event.object.kind !== 'Pod' ||
    event.object.metadata.ownerReferences?.some(
      (owner) =>
        owner.apiVersion === 'batch/v1' &&
        owner.kind === 'Job' &&
        owner.name === receipt.jobName &&
        owner.uid === receipt.jobUid &&
        owner.controller === true,
    ) === true
  );
}

function terminalReason(
  reason: KubernetesEvent['object']['reason'],
): { status: 'completed' | 'failed' | 'reconciling'; reason: string } | undefined {
  switch (reason) {
    case 'Completed':
      return { status: 'completed', reason: 'job-completed' };
    case 'Evicted':
      return { status: 'failed', reason: 'pod-evicted' };
    case 'DeadlineExceeded':
      return { status: 'failed', reason: 'job-timeout' };
    case 'WatchDisconnected':
      return { status: 'reconciling', reason: 'watch-disconnected' };
    default:
      return undefined;
  }
}

/** Construct a Kubernetes Job adapter whose external state and I/O are supplied by the caller. */
export function createKubernetesJobBackend(input: {
  config: KubernetesBackendConfig;
  client: KubernetesClient;
  idempotency: IdempotencyStore;
  runtimeExecution?: RuntimeBackendExecutionPort;
}): KubernetesJobBackend {
  const { client, config, idempotency, runtimeExecution } = input;
  const cancellationRequests = new Set<string>();
  const workspaceReleases = new Set<string>();
  const inFlightDeliveries = new Map<string, Promise<DeliveryReceipt>>();
  const spiReceipts = new Map<string, DeliveryReceipt>();

  const deliver = async (task: RuntimeTask): Promise<DeliveryReceipt> => {
    assertTask(task);
    const existing = idempotency.deliveries.get(task.deliveryId);
    if (existing !== undefined) {
      if (existing.runId !== task.runId) throw new KubernetesBackendError('RUNTIME_TASK_INVALID');
      return existing;
    }
    const inFlight = inFlightDeliveries.get(task.deliveryId);
    if (inFlight !== undefined) return inFlight;
    const delivery = (async (): Promise<DeliveryReceipt> => {
      const jobName = `${config.workspace.claimPrefix}${task.runId}`;
      const labels = runLabels(task.runId, task.deliveryId);
      const job = buildJob(config, task, jobName, labels);
      let created: { uid: string };
      try {
        created = await client.createJob(config.namespace, job);
      } catch {
        throw unavailable();
      }
      const receipt: DeliveryReceipt = {
        runId: task.runId,
        deliveryId: task.deliveryId,
        backend: 'kubernetes',
        jobName,
        jobUid: created.uid,
        networkPolicyRef: config.networkPolicyRef,
        workspace: { claimName: jobName, retention: 'until-human-decision' },
        job,
      };
      idempotency.deliveries.set(task.deliveryId, receipt);
      return receipt;
    })();
    inFlightDeliveries.set(task.deliveryId, delivery);
    try {
      return await delivery;
    } finally {
      inFlightDeliveries.delete(task.deliveryId);
    }
  };

  const watch: KubernetesJobBackend['watch'] = async (receipt, heartbeat) => {
    const labels = runLabels(receipt.runId, receipt.deliveryId);
    try {
      for await (const event of client.watchRun(config.namespace, labels)) {
        if (!hasExactJobOwner(event, receipt)) {
          throw new KubernetesBackendError('KUBERNETES_POD_OWNER_INVALID');
        }
        const phase = event.object.phase ?? event.object.reason ?? event.type;
        heartbeat({ runId: receipt.runId, resourceVersion: event.resourceVersion, phase });
        const terminal = terminalReason(event.object.reason);
        if (terminal !== undefined) {
          return { ...terminal, backend: 'kubernetes', fallback: false };
        }
      }
      return {
        status: 'reconciling',
        reason: 'watch-ended',
        backend: 'kubernetes',
        fallback: false,
      };
    } catch (error) {
      if (error instanceof KubernetesBackendError) throw error;
      return {
        status: 'reconciling',
        reason: 'watch-disconnected',
        backend: 'kubernetes',
        fallback: false,
      };
    }
  };

  const cancel: KubernetesJobBackend['cancel'] = async (receipt) => {
    if (cancellationRequests.has(receipt.deliveryId)) {
      return { status: 'cancel-requested', duplicate: true };
    }
    try {
      await client.deleteJob(config.namespace, receipt.jobName, {
        propagationPolicy: 'Foreground',
        gracePeriodSeconds: 0,
      });
    } catch {
      throw unavailable();
    }
    cancellationRequests.add(receipt.deliveryId);
    return { status: 'cancel-requested', duplicate: false };
  };

  const reconcile: KubernetesJobBackend['reconcile'] = async (runId) => {
    let events: KubernetesEvent[];
    try {
      events = await client.findRun(config.namespace, runId);
    } catch {
      throw unavailable();
    }
    const failed = events.find(
      ({ object }) => object.reason === 'Evicted' || object.reason === 'DeadlineExceeded',
    );
    if (failed !== undefined) {
      return {
        status: 'failed',
        reason: failed.object.reason === 'Evicted' ? 'pod-evicted' : 'job-timeout',
        restartBoundary: true,
        backend: 'kubernetes',
        fallback: false,
      };
    }
    const running = events.find(
      ({ object }) =>
        object.phase === 'Running' && object.metadata.labels['ui4a.dev/run-id'] === runId,
    );
    if (running !== undefined) {
      return {
        status: 'watching',
        reason: 'job-running',
        restartBoundary: true,
        backend: 'kubernetes',
        fallback: false,
      };
    }
    return {
      status: 'missing',
      reason: 'job-missing',
      restartBoundary: true,
      backend: 'kubernetes',
      fallback: false,
    };
  };

  const acceptCallback: KubernetesJobBackend['acceptCallback'] = async (callback) => {
    const delivery = idempotency.deliveries.get(callback.deliveryId);
    if (
      delivery === undefined ||
      delivery.runId !== callback.runId ||
      !SHA256_PATTERN.test(callback.resultHash)
    ) {
      throw new KubernetesBackendError('RUNTIME_CALLBACK_INVALID');
    }
    const existing = idempotency.callbacks.get(callback.callbackId);
    if (existing !== undefined) {
      if (existing.runId !== callback.runId || existing.resultHash !== callback.resultHash) {
        throw new KubernetesBackendError('RUNTIME_CALLBACK_CONFLICT');
      }
      return { ...existing, duplicate: true };
    }
    const receipt: CallbackReceipt = {
      callbackId: callback.callbackId,
      runId: callback.runId,
      resultHash: callback.resultHash,
      accepted: true,
      duplicate: false,
    };
    idempotency.callbacks.set(callback.callbackId, receipt);
    return receipt;
  };

  const releaseWorkspace: KubernetesJobBackend['releaseWorkspace'] = async (receipt, decision) => {
    if (!workspaceReleases.has(receipt.workspace.claimName)) {
      try {
        await client.deleteWorkspaceClaim(config.namespace, receipt.workspace.claimName);
      } catch {
        throw unavailable();
      }
      workspaceReleases.add(receipt.workspace.claimName);
    }
    return { released: true, decision };
  };

  const transportLabel = (prefix: string, value: string): string =>
    `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 40)}`;

  const prepare: RuntimeBackendSpi['prepare'] = async (envelope) => {
    if (runtimeExecution === undefined) throw unavailable();
    const deliveryId = transportLabel('delivery', envelope.execution.leaseId);
    const receipt = await deliver({
      schemaVersion: 1,
      runId: transportLabel('run', envelope.runId),
      deliveryId,
      kind: envelope.specialization,
      payload: { delivery: envelope },
      birth: {
        definitionHash: envelope.birth.definitionHash as Sha256,
        promptHash: envelope.birth.promptHash as Sha256,
        runtimeHash: envelope.birth.runtimeHash as Sha256,
      },
    });
    spiReceipts.set(deliveryId, receipt);
    return { handle: deliveryId };
  };

  const execute: RuntimeBackendSpi['execute'] = async (envelope, prepared, controls) => {
    if (runtimeExecution === undefined || !spiReceipts.has(prepared.handle)) throw unavailable();
    return runtimeExecution.execute({
      envelope,
      handle: prepared.handle,
      signal: controls.signal,
      ...(controls.checkpoint === undefined ? {} : { checkpoint: controls.checkpoint }),
      heartbeat: controls.heartbeat,
    });
  };

  const collect: RuntimeBackendSpi['collect'] = async (envelope, execution) => {
    if (runtimeExecution === undefined) throw unavailable();
    return runtimeExecution.collect({ envelope, execution });
  };

  return {
    kind: 'kubernetes-job',
    prepare,
    execute,
    collect,
    deliver,
    watch,
    cancel,
    reconcile,
    acceptCallback,
    releaseWorkspace,
  };
}
