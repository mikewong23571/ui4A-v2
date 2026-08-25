import type { ProductionRuntimeTransportPort } from '../production-wiring';
import {
  assertExistingDelivery,
  compiledResult,
  exactOwnedPod,
  jobStatus,
  prepareDeliveryManifests,
} from './runtime-transport-manifests';
import {
  KubernetesRestError,
  metadata,
  requiredName,
  requiredPath,
  type InClusterKubernetesRuntimeTransportOptions,
  type KubernetesObject,
} from './runtime-transport-types';

export type {
  InClusterKubernetesRuntimeTransportOptions,
  KubernetesRuntimeApi,
} from './runtime-transport-types';
export {
  createInClusterKubernetesRuntimeApi,
  createInClusterKubernetesRuntimeTransportFromEnvironment,
} from './runtime-transport-rest';

async function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('runtime_kubernetes_cancelled');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(new Error('runtime_kubernetes_cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function createOrDiscover(input: {
  get(): Promise<KubernetesObject | undefined>;
  create(): Promise<KubernetesObject>;
  validate(value: KubernetesObject): void;
}): Promise<KubernetesObject> {
  const existing = await input.get();
  if (existing !== undefined) {
    input.validate(existing);
    return existing;
  }
  try {
    const created = await input.create();
    input.validate(created);
    return created;
  } catch (error) {
    if (!(error instanceof KubernetesRestError) || error.status !== 409) throw error;
    const raced = await input.get();
    if (raced === undefined) throw new Error('runtime_kubernetes_unavailable');
    input.validate(raced);
    return raced;
  }
}

function validateOptions(options: InClusterKubernetesRuntimeTransportOptions): void {
  requiredName(options.namespace, 'runtime_kubernetes_config_invalid');
  requiredName(options.settingsConfigMapName, 'runtime_kubernetes_config_invalid');
  requiredName(options.secretsSecretName, 'runtime_kubernetes_config_invalid');
  requiredName(options.workspaceClaimName, 'runtime_kubernetes_config_invalid');
  requiredName(options.runnerServiceAccountName, 'runtime_kubernetes_config_invalid');
  requiredPath(options.workspaceMountPath, 'runtime_kubernetes_config_invalid');
  if (
    options.settingsKey === '' ||
    options.settingsKey.includes('/') ||
    options.secretsKey === '' ||
    options.secretsKey.includes('/') ||
    !Number.isSafeInteger(options.pollIntervalMs) ||
    options.pollIntervalMs < 1
  ) {
    throw new Error('runtime_kubernetes_config_invalid');
  }
}

/** Execute a compiled request in one deterministic, in-cluster Kubernetes one-shot Runner Job. */
export function createInClusterKubernetesRuntimeTransport(
  options: InClusterKubernetesRuntimeTransportOptions,
): ProductionRuntimeTransportPort {
  validateOptions(options);
  const wait = options.wait ?? defaultWait;
  return {
    kind: 'kubernetes-job',
    async execute(input) {
      if (
        input.envelope.execution.workspace.rootRef !== options.workspaceMountPath &&
        !input.envelope.execution.workspace.rootRef.startsWith(`${options.workspaceMountPath}/`)
      ) {
        throw new Error('runtime_kubernetes_workspace_invalid');
      }
      const prepared = prepareDeliveryManifests(options, input.envelope);
      let createdJob: KubernetesObject | undefined;
      const cleanup = async (): Promise<void> => {
        await Promise.allSettled([
          options.api.deleteJob(options.namespace, prepared.name),
          options.api.deleteConfigMap(options.namespace, prepared.name),
        ]);
      };
      try {
        await createOrDiscover({
          get: () => options.api.getConfigMap(options.namespace, prepared.name, input.signal),
          create: () =>
            options.api.createConfigMap(options.namespace, prepared.configMapObject, input.signal),
          validate: (value) =>
            assertExistingDelivery(
              value,
              prepared.name,
              prepared.deliveryHash,
              prepared.serializedDelivery,
            ),
        });
        createdJob = await createOrDiscover({
          get: () => options.api.getJob(options.namespace, prepared.name, input.signal),
          create: () => options.api.createJob(options.namespace, prepared.jobObject, input.signal),
          validate: (value) => assertExistingDelivery(value, prepared.name, prepared.deliveryHash),
        });
        const startedAt = Date.now();
        while (jobStatus(createdJob) === 'running') {
          if (input.signal.aborted) throw new Error('runtime_kubernetes_cancelled');
          const resourceVersion = String(
            metadata(createdJob, 'runtime_kubernetes_job_invalid').resourceVersion ?? '',
          );
          input.reportProgress(resourceVersion || null, {
            kind: 'kubernetes-job',
            phase: 'running',
          });
          if (Date.now() - startedAt >= input.envelope.execution.resources.timeoutMs) {
            throw new Error('runtime_kubernetes_timeout');
          }
          await wait(options.pollIntervalMs, input.signal);
          createdJob =
            (await options.api.getJob(options.namespace, prepared.name, input.signal)) ??
            (() => {
              throw new Error('runtime_kubernetes_job_missing');
            })();
        }
        if (jobStatus(createdJob) === 'failed') throw new Error('runtime_kubernetes_job_failed');
        const meta = metadata(createdJob, 'runtime_kubernetes_job_invalid');
        if (typeof meta.uid !== 'string' || meta.uid === '') {
          throw new Error('runtime_kubernetes_job_invalid');
        }
        const pods = await options.api.listPods(
          options.namespace,
          prepared.runLabels,
          input.signal,
        );
        const owned = pods.filter((pod) => exactOwnedPod(pod, prepared.name, meta.uid as string));
        if (owned.length !== 1) throw new Error('runtime_kubernetes_pod_owner_invalid');
        const podName = metadata(owned[0]!, 'runtime_kubernetes_pod_owner_invalid').name;
        if (typeof podName !== 'string' || podName === '') {
          throw new Error('runtime_kubernetes_pod_owner_invalid');
        }
        const log = await options.api.readPodLog(options.namespace, podName, input.signal);
        const result = compiledResult({
          log,
          delivery: prepared.delivery,
          envelope: input.envelope,
        });
        for (const [index, event] of result.events.entries()) {
          input.reportProgress(String(index + 1), event);
        }
        return result;
      } catch (error) {
        if (
          input.signal.aborted ||
          (error instanceof Error && error.message === 'runtime_kubernetes_cancelled')
        ) {
          await cleanup();
          throw new Error('runtime_kubernetes_cancelled');
        }
        if (error instanceof Error && error.message === 'runtime_kubernetes_timeout') {
          await cleanup();
          throw error;
        }
        if (error instanceof Error && /^runtime_kubernetes_[a-z_]+$/.test(error.message)) {
          throw error;
        }
        throw new Error('runtime_kubernetes_unavailable');
      }
    },
  };
}
