import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';

import { canonicalJson } from '@ui4a/engine';

import type {
  CompiledRuntimeTransportEnvelope,
  CompiledRuntimeTransportResult,
  ProductionRuntimeTransportPort,
} from './production-wiring';

type KubernetesObject = Record<string, unknown>;

export interface KubernetesRuntimeApi {
  getConfigMap(
    namespace: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<KubernetesObject | undefined>;
  createConfigMap(
    namespace: string,
    value: KubernetesObject,
    signal?: AbortSignal,
  ): Promise<KubernetesObject>;
  deleteConfigMap(namespace: string, name: string, signal?: AbortSignal): Promise<void>;
  getJob(
    namespace: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<KubernetesObject | undefined>;
  createJob(
    namespace: string,
    value: KubernetesObject,
    signal?: AbortSignal,
  ): Promise<KubernetesObject>;
  deleteJob(namespace: string, name: string, signal?: AbortSignal): Promise<void>;
  listPods(
    namespace: string,
    labels: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<KubernetesObject[]>;
  readPodLog(namespace: string, podName: string, signal?: AbortSignal): Promise<string>;
}

export interface InClusterKubernetesRuntimeTransportOptions {
  api: KubernetesRuntimeApi;
  namespace: string;
  settingsConfigMapName: string;
  settingsKey: string;
  secretsSecretName: string;
  secretsKey: string;
  workspaceClaimName: string;
  workspaceMountPath: string;
  runnerServiceAccountName: string;
  pollIntervalMs: number;
  forbiddenSecretValues: readonly string[];
  wait?(milliseconds: number, signal: AbortSignal): Promise<void>;
}

interface KubernetesRestResponse {
  status: number;
  body: string;
}

interface InClusterRestDependencies {
  readFile?(path: string): string;
  request?(input: {
    origin: string;
    ca: string;
    token: string;
    method: string;
    path: string;
    body?: string;
    signal?: AbortSignal;
  }): Promise<KubernetesRestResponse>;
}

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const dnsLabelPattern = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const absolutePathPattern = /^\/(?!$)/;
const runnerResultFields = [
  'schemaVersion',
  'deliveryId',
  'runId',
  'specialization',
  'status',
  'birth',
  'candidate',
  'artifacts',
  'resultHash',
] as const;

class KubernetesRestError extends Error {
  constructor(readonly status: number) {
    super(`runtime_kubernetes_status:${status}`);
  }
}

function object(value: unknown, code: string): KubernetesObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value as KubernetesObject;
}

function exactFields(value: KubernetesObject, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function requiredName(value: string, code: string): string {
  if (!dnsLabelPattern.test(value)) throw new Error(code);
  return value;
}

function requiredPath(value: string, code: string): string {
  if (!absolutePathPattern.test(value) || value.includes('..')) throw new Error(code);
  return value;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function containsSecret(value: string, secrets: readonly string[]): boolean {
  return secrets.some((secret) => secret !== '' && value.includes(secret));
}

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

function metadata(value: KubernetesObject, code: string): KubernetesObject {
  return object(value.metadata, code);
}

function annotations(value: KubernetesObject): KubernetesObject {
  const candidate = metadata(value, 'runtime_kubernetes_object_invalid').annotations;
  return candidate === undefined ? {} : object(candidate, 'runtime_kubernetes_object_invalid');
}

function assertExistingDelivery(
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
        metadata: { labels: input.labels },
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
                  value: '/run/secrets/ui4a-deployment-secrets',
                },
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
                  name: 'deployment-secrets',
                  mountPath: '/run/secrets/ui4a-deployment-secrets',
                  subPath: options.secretsKey,
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
              name: 'deployment-secrets',
              secret: { secretName: options.secretsSecretName },
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

function jobStatus(value: KubernetesObject): 'running' | 'succeeded' | 'failed' {
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

function exactOwnedPod(pod: KubernetesObject, jobName: string, jobUid: string): boolean {
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

function compiledResult(input: {
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
      const identity = deliveryIdentity(input.envelope);
      const delivery = runnerDelivery(input.envelope, identity.deliveryId);
      const serializedDelivery = canonicalJson(delivery);
      if (
        Buffer.byteLength(serializedDelivery) > 1024 * 1024 ||
        containsSecret(serializedDelivery, options.forbiddenSecretValues)
      ) {
        throw new Error('runtime_kubernetes_delivery_invalid');
      }
      const deliveryHash = `sha256:${hash(serializedDelivery)}`;
      const runLabels = labels(identity.name);
      const configMapObject = configMap({
        namespace: options.namespace,
        name: identity.name,
        labels: runLabels,
        serializedDelivery,
        deliveryHash,
      });
      const jobObject = job({
        options,
        envelope: input.envelope,
        name: identity.name,
        labels: runLabels,
        deliveryHash,
      });
      let createdJob: KubernetesObject | undefined;
      const cleanup = async (): Promise<void> => {
        await Promise.allSettled([
          options.api.deleteJob(options.namespace, identity.name),
          options.api.deleteConfigMap(options.namespace, identity.name),
        ]);
      };
      try {
        await createOrDiscover({
          get: () => options.api.getConfigMap(options.namespace, identity.name, input.signal),
          create: () =>
            options.api.createConfigMap(options.namespace, configMapObject, input.signal),
          validate: (value) =>
            assertExistingDelivery(value, identity.name, deliveryHash, serializedDelivery),
        });
        createdJob = await createOrDiscover({
          get: () => options.api.getJob(options.namespace, identity.name, input.signal),
          create: () => options.api.createJob(options.namespace, jobObject, input.signal),
          validate: (value) => assertExistingDelivery(value, identity.name, deliveryHash),
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
            (await options.api.getJob(options.namespace, identity.name, input.signal)) ??
            (() => {
              throw new Error('runtime_kubernetes_job_missing');
            })();
        }
        if (jobStatus(createdJob) === 'failed') throw new Error('runtime_kubernetes_job_failed');
        const meta = metadata(createdJob, 'runtime_kubernetes_job_invalid');
        if (typeof meta.uid !== 'string' || meta.uid === '') {
          throw new Error('runtime_kubernetes_job_invalid');
        }
        const pods = await options.api.listPods(options.namespace, runLabels, input.signal);
        const owned = pods.filter((pod) => exactOwnedPod(pod, identity.name, meta.uid as string));
        if (owned.length !== 1) throw new Error('runtime_kubernetes_pod_owner_invalid');
        const podName = metadata(owned[0]!, 'runtime_kubernetes_pod_owner_invalid').name;
        if (typeof podName !== 'string' || podName === '') {
          throw new Error('runtime_kubernetes_pod_owner_invalid');
        }
        const log = await options.api.readPodLog(options.namespace, podName, input.signal);
        const result = compiledResult({ log, delivery, envelope: input.envelope });
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

function defaultRestRequest(input: {
  origin: string;
  ca: string;
  token: string;
  method: string;
  path: string;
  body?: string;
  signal?: AbortSignal;
}): Promise<KubernetesRestResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(input.path, input.origin);
    const request = httpsRequest(
      url,
      {
        method: input.method,
        ca: input.ca,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${input.token}`,
          ...(input.body === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(input.body),
              }),
        },
        signal: input.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            request.destroy(new Error('runtime_kubernetes_response_too_large'));
          else chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 500,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

function jsonBody(response: KubernetesRestResponse): KubernetesObject {
  if (response.status < 200 || response.status >= 300)
    throw new KubernetesRestError(response.status);
  try {
    return object(JSON.parse(response.body), 'runtime_kubernetes_response_invalid');
  } catch (error) {
    if (error instanceof KubernetesRestError) throw error;
    throw new Error('runtime_kubernetes_response_invalid');
  }
}

function queryLabels(labels: Readonly<Record<string, string>>): string {
  return encodeURIComponent(
    Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join(','),
  );
}

/** Build the production Kubernetes REST port from the mounted ServiceAccount token and CA. */
export function createInClusterKubernetesRuntimeApi(
  environment: NodeJS.ProcessEnv,
  dependencies: InClusterRestDependencies = {},
): KubernetesRuntimeApi {
  const read = dependencies.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const request = dependencies.request ?? defaultRestRequest;
  const origin = environment.UI4A_KUBERNETES_API_ORIGIN ?? 'https://kubernetes.default.svc';
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error('runtime_kubernetes_config_invalid');
  }
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin) {
    throw new Error('runtime_kubernetes_config_invalid');
  }
  const tokenPath =
    environment.UI4A_KUBERNETES_TOKEN_FILE ?? '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath =
    environment.UI4A_KUBERNETES_CA_FILE ?? '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
  let token: string;
  let ca: string;
  try {
    token = read(requiredPath(tokenPath, 'runtime_kubernetes_config_invalid')).trim();
    ca = read(requiredPath(caPath, 'runtime_kubernetes_config_invalid'));
  } catch {
    throw new Error('runtime_kubernetes_config_invalid');
  }
  if (token === '' || ca === '') throw new Error('runtime_kubernetes_config_invalid');
  const call = async (
    method: string,
    path: string,
    signal?: AbortSignal,
    value?: KubernetesObject,
  ): Promise<KubernetesRestResponse> =>
    request({
      origin,
      ca,
      token,
      method,
      path,
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      ...(signal === undefined ? {} : { signal }),
    });
  const namespaced = (namespace: string, resource: string, name?: string): string =>
    `/api${resource === 'jobs' ? 's/batch/v1' : '/v1'}/namespaces/${encodeURIComponent(namespace)}/${resource}${name === undefined ? '' : `/${encodeURIComponent(name)}`}`;
  const optional = async (
    response: Promise<KubernetesRestResponse>,
  ): Promise<KubernetesObject | undefined> => {
    const resolved = await response;
    return resolved.status === 404 ? undefined : jsonBody(resolved);
  };
  return {
    getConfigMap: (namespace, name, signal) =>
      optional(call('GET', namespaced(namespace, 'configmaps', name), signal)),
    createConfigMap: async (namespace, value, signal) =>
      jsonBody(await call('POST', namespaced(namespace, 'configmaps'), signal, value)),
    deleteConfigMap: async (namespace, name, signal) => {
      const response = await call('DELETE', namespaced(namespace, 'configmaps', name), signal);
      if (response.status !== 404) jsonBody(response);
    },
    getJob: (namespace, name, signal) =>
      optional(call('GET', namespaced(namespace, 'jobs', name), signal)),
    createJob: async (namespace, value, signal) =>
      jsonBody(await call('POST', namespaced(namespace, 'jobs'), signal, value)),
    deleteJob: async (namespace, name, signal) => {
      const path = `${namespaced(namespace, 'jobs', name)}?propagationPolicy=Foreground&gracePeriodSeconds=0`;
      const response = await call('DELETE', path, signal);
      if (response.status !== 404) jsonBody(response);
    },
    listPods: async (namespace, labels, signal) => {
      const response = jsonBody(
        await call(
          'GET',
          `${namespaced(namespace, 'pods')}?labelSelector=${queryLabels(labels)}`,
          signal,
        ),
      );
      if (!Array.isArray(response.items)) throw new Error('runtime_kubernetes_response_invalid');
      return response.items.map((item) => object(item, 'runtime_kubernetes_response_invalid'));
    },
    readPodLog: async (namespace, podName, signal) => {
      const response = await call(
        'GET',
        `${namespaced(namespace, 'pods', podName)}/log?container=runner`,
        signal,
      );
      if (response.status < 200 || response.status >= 300)
        throw new KubernetesRestError(response.status);
      return response.body;
    },
  };
}

/** Resolve the non-secret Kubernetes object references used by the Worker production activity. */
export function createInClusterKubernetesRuntimeTransportFromEnvironment(
  environment: NodeJS.ProcessEnv,
  forbiddenSecretValues: readonly string[],
): ProductionRuntimeTransportPort {
  const read = (path: string): string => readFileSync(path, 'utf8').trim();
  let namespace: string;
  try {
    namespace =
      environment.UI4A_KUBERNETES_NAMESPACE ??
      read('/var/run/secrets/kubernetes.io/serviceaccount/namespace');
  } catch {
    throw new Error('runtime_kubernetes_config_invalid');
  }
  return createInClusterKubernetesRuntimeTransport({
    api: createInClusterKubernetesRuntimeApi(environment),
    namespace,
    settingsConfigMapName:
      environment.UI4A_KUBERNETES_SETTINGS_CONFIGMAP ?? 'ui4a-deployment-settings',
    settingsKey: environment.UI4A_KUBERNETES_SETTINGS_KEY ?? 'settings.json',
    secretsSecretName: environment.UI4A_KUBERNETES_SECRETS_SECRET ?? 'ui4a-deployment-secrets',
    secretsKey: environment.UI4A_KUBERNETES_SECRETS_KEY ?? 'ui4a-deployment-secrets',
    workspaceClaimName: environment.UI4A_KUBERNETES_WORKSPACE_CLAIM ?? 'runtime-data',
    workspaceMountPath: environment.UI4A_KUBERNETES_WORKSPACE_MOUNT ?? '/workspaces',
    runnerServiceAccountName: environment.UI4A_KUBERNETES_RUNNER_SERVICE_ACCOUNT ?? 'ui4a-runner',
    pollIntervalMs: Number(environment.UI4A_KUBERNETES_POLL_INTERVAL_MS ?? '1000'),
    forbiddenSecretValues: [...forbiddenSecretValues],
  });
}
