import { canonicalJson } from '@ui4a/engine';

import type {
  CompiledRuntimeTransportEnvelope,
  CompiledRuntimeTransportResult,
} from '../production-wiring';
import {
  annotations,
  containsSecret,
  exactFields,
  hash,
  metadata,
  object,
  runnerResultFields,
  sha256Pattern,
  type InClusterKubernetesRuntimeTransportOptions,
  type KubernetesObject,
} from './runtime-transport-types';

function deliveryIdentity(envelope: CompiledRuntimeTransportEnvelope): {
  name: string;
  deliveryId: string;
} {
  const suffix = hash(`${envelope.runId}\0${envelope.execution.profileId}`).slice(0, 40);
  return {
    name: `ui4a-run-${suffix}`,
    deliveryId: `delivery:${envelope.runId}:${envelope.execution.profileId}`,
  };
}

function runnerBirth(envelope: CompiledRuntimeTransportEnvelope): KubernetesObject {
  return {
    definitionRef: `${envelope.birth.definition.ref}@${envelope.birth.definition.version}`,
    definitionHash: envelope.birth.definition.flattenedHash,
    promptHash: envelope.birth.prompt.compiledHash,
    runtimeHash: `sha256:${hash(canonicalJson(envelope.birth.runtime))}`,
    taskContractHash: envelope.birth.taskContract.hash,
    resultContractHash: envelope.birth.resultContract.hash,
  };
}

function runnerDelivery(
  envelope: CompiledRuntimeTransportEnvelope,
  deliveryId: string,
): KubernetesObject {
  return structuredClone({
    schemaVersion: 1,
    deliveryId,
    request: {
      schemaVersion: 1,
      runId: envelope.runId,
      specialization: envelope.specialization,
      birth: runnerBirth(envelope),
      task: {
        contractRef: 'generic-codex-transport@1',
        payload: envelope.request,
        contextRefs: [],
      },
    },
    execution: {
      profileId: envelope.execution.profileId,
      backend: 'kubernetes-job',
      image: envelope.execution.image,
      workspace: { rootRef: envelope.execution.workspace.rootRef },
      resources: {
        cpu: envelope.execution.resources.cpu,
        memory: envelope.execution.resources.memory,
        timeoutMs: envelope.execution.resources.timeoutMs,
      },
      networkPolicy: envelope.execution.networkPolicy,
      credentialRefs: envelope.execution.credentialRefs,
    },
  });
}

function labels(name: string): Record<string, string> {
  return {
    'app.kubernetes.io/name': 'ui4a-agent-runner',
    'app.kubernetes.io/component': 'runtime',
    'ui4a.dev/delivery': name,
  };
}

export function assertExistingDelivery(
  value: KubernetesObject,
  expectedName: string,
  expectedHash: string,
  expectedData?: string,
): void {
  const meta = metadata(value, 'runtime_kubernetes_delivery_conflict');
  if (
    meta.name !== expectedName ||
    annotations(value)['ui4a.dev/delivery-hash'] !== expectedHash ||
    (expectedData !== undefined &&
      object(value.data, 'runtime_kubernetes_delivery_conflict')['delivery.json'] !== expectedData)
  ) {
    throw new Error('runtime_kubernetes_delivery_conflict');
  }
}

function configMap(input: {
  namespace: string;
  name: string;
  labels: Record<string, string>;
  serializedDelivery: string;
  deliveryHash: string;
}): KubernetesObject {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: input.name,
      namespace: input.namespace,
      labels: input.labels,
      annotations: { 'ui4a.dev/delivery-hash': input.deliveryHash },
    },
    immutable: true,
    data: { 'delivery.json': input.serializedDelivery },
  };
}

function job(input: {
  options: InClusterKubernetesRuntimeTransportOptions;
  envelope: CompiledRuntimeTransportEnvelope;
  name: string;
  labels: Record<string, string>;
  deliveryHash: string;
}): KubernetesObject {
  const { options, envelope } = input;
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: input.name,
      namespace: options.namespace,
      labels: input.labels,
      annotations: {
        'ui4a.dev/delivery-hash': input.deliveryHash,
        'ui4a.dev/network-policy': 'restricted',
      },
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: Math.ceil(envelope.execution.resources.timeoutMs / 1_000),
      ttlSecondsAfterFinished: 3_600,
      template: {
        metadata: {
          labels: input.labels,
          annotations: { 'sidecar.istio.io/inject': 'false' },
        },
        spec: {
          serviceAccountName: options.runnerServiceAccountName,
          automountServiceAccountToken: false,
          restartPolicy: 'Never',
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          containers: [
            {
              name: 'runner',
              image: envelope.execution.image,
              imagePullPolicy: 'IfNotPresent',
              command: ['node', 'dist/main.js', 'oneshot'],
              workingDir: '/app',
              env: [
                { name: 'UI4A_DEPLOYMENT_PROFILE', value: 'production' },
                { name: 'UI4A_DEPLOYMENT_SETTINGS_FILE', value: '/run/ui4a/settings.json' },
                {
                  name: 'UI4A_DEPLOYMENT_SECRETS_FILE',
                  value: '/run/secrets/ui4a-runner-secrets',
                },
                { name: 'UI4A_RUNNER_PROFILE_ID', value: envelope.execution.profileId },
                { name: 'UI4A_RUNNER_DELIVERY_FILE', value: '/run/ui4a/delivery.json' },
                { name: 'UI4A_RUNNER_IMAGE', value: envelope.execution.image },
              ],
              resources: {
                requests: {
                  cpu: envelope.execution.resources.cpu,
                  memory: envelope.execution.resources.memory,
                },
                limits: {
                  cpu: envelope.execution.resources.cpu,
                  memory: envelope.execution.resources.memory,
                },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ['ALL'] },
              },
              volumeMounts: [
                {
                  name: 'delivery',
                  mountPath: '/run/ui4a/delivery.json',
                  subPath: 'delivery.json',
                  readOnly: true,
                },
                {
                  name: 'deployment-settings',
                  mountPath: '/run/ui4a/settings.json',
                  subPath: options.settingsKey,
                  readOnly: true,
                },
                {
                  name: 'runner-secrets',
                  mountPath: '/run/secrets/ui4a-runner-secrets',
                  subPath: 'runner-secrets.json',
                  readOnly: true,
                },
                { name: 'runtime-workspace', mountPath: options.workspaceMountPath },
                { name: 'tmp', mountPath: '/tmp' },
              ],
            },
          ],
          volumes: [
            { name: 'delivery', configMap: { name: input.name } },
            {
              name: 'deployment-settings',
              configMap: { name: options.settingsConfigMapName },
            },
            {
              name: 'runner-secrets',
              secret: {
                secretName: options.secretsSecretName,
                defaultMode: 0o400,
                items: [
                  {
                    key: options.secretsKey,
                    path: 'runner-secrets.json',
                    mode: 0o400,
                  },
                ],
              },
            },
            {
              name: 'runtime-workspace',
              persistentVolumeClaim: { claimName: options.workspaceClaimName },
            },
            { name: 'tmp', emptyDir: {} },
          ],
        },
      },
    },
  };
}

export function jobStatus(value: KubernetesObject): 'running' | 'succeeded' | 'failed' {
  const status = object(value.status ?? {}, 'runtime_kubernetes_job_invalid');
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  for (const entry of conditions) {
    const condition = object(entry, 'runtime_kubernetes_job_invalid');
    if (condition.status === 'True' && condition.type === 'Complete') return 'succeeded';
    if (condition.status === 'True' && condition.type === 'Failed') return 'failed';
  }
  if (typeof status.succeeded === 'number' && status.succeeded > 0) return 'succeeded';
  if (typeof status.failed === 'number' && status.failed > 0) return 'failed';
  return 'running';
}

export function exactOwnedPod(pod: KubernetesObject, jobName: string, jobUid: string): boolean {
  const owners = metadata(pod, 'runtime_kubernetes_pod_owner_invalid').ownerReferences;
  return (
    Array.isArray(owners) &&
    owners.some((entry) => {
      const owner = object(entry, 'runtime_kubernetes_pod_owner_invalid');
      return (
        owner.apiVersion === 'batch/v1' &&
        owner.kind === 'Job' &&
        owner.name === jobName &&
        owner.uid === jobUid &&
        owner.controller === true
      );
    })
  );
}

export function compiledResult(input: {
  log: string;
  delivery: KubernetesObject;
  envelope: CompiledRuntimeTransportEnvelope;
}): CompiledRuntimeTransportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.log.trim());
  } catch {
    throw new Error('runtime_kubernetes_result_invalid');
  }
  const value = object(parsed, 'runtime_kubernetes_result_invalid');
  const request = object(input.delivery.request, 'runtime_kubernetes_result_invalid');
  if (
    !exactFields(value, runnerResultFields) ||
    value.schemaVersion !== 1 ||
    value.deliveryId !== input.delivery.deliveryId ||
    value.runId !== input.envelope.runId ||
    value.specialization !== input.envelope.specialization ||
    value.status !== 'succeeded' ||
    !sha256Pattern.test(String(value.resultHash)) ||
    canonicalJson(value.birth) !== canonicalJson(request.birth) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new Error('runtime_kubernetes_result_invalid');
  }
  const candidate = object(value.candidate, 'runtime_kubernetes_result_invalid');
  if (
    !exactFields(candidate, ['schemaVersion', 'nativeSessionId', 'result', 'events']) ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.nativeSessionId !== 'string' ||
    candidate.nativeSessionId === '' ||
    !Array.isArray(candidate.events)
  ) {
    throw new Error('runtime_kubernetes_result_invalid');
  }
  return {
    schemaVersion: 1,
    runId: input.envelope.runId,
    birth: structuredClone(input.envelope.birth),
    nativeSessionId: candidate.nativeSessionId,
    result: structuredClone(candidate.result),
    events: structuredClone(candidate.events),
  };
}

export interface PreparedDelivery {
  name: string;
  deliveryHash: string;
  serializedDelivery: string;
  delivery: KubernetesObject;
  configMapObject: KubernetesObject;
  jobObject: KubernetesObject;
  runLabels: Record<string, string>;
}

/** Build the deterministic delivery, ConfigMap, and Job manifests for one compiled request. */
export function prepareDeliveryManifests(
  options: InClusterKubernetesRuntimeTransportOptions,
  envelope: CompiledRuntimeTransportEnvelope,
): PreparedDelivery {
  const identity = deliveryIdentity(envelope);
  const delivery = runnerDelivery(envelope, identity.deliveryId);
  const serializedDelivery = canonicalJson(delivery);
  if (
    Buffer.byteLength(serializedDelivery) > 1024 * 1024 ||
    containsSecret(serializedDelivery, options.forbiddenSecretValues)
  ) {
    throw new Error('runtime_kubernetes_delivery_invalid');
  }
  const deliveryHash = `sha256:${hash(serializedDelivery)}`;
  const runLabels = labels(identity.name);
  return {
    name: identity.name,
    deliveryHash,
    serializedDelivery,
    delivery,
    configMapObject: configMap({
      namespace: options.namespace,
      name: identity.name,
      labels: runLabels,
      serializedDelivery,
      deliveryHash,
    }),
    jobObject: job({
      options,
      envelope,
      name: identity.name,
      labels: runLabels,
      deliveryHash,
    }),
    runLabels,
  };
}
