import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';

import type { ProductionRuntimeTransportPort } from '../production-wiring';
import { createInClusterKubernetesRuntimeTransport } from './runtime-transport';
import {
  KubernetesRestError,
  object,
  requiredPath,
  type InClusterRestDependencies,
  type KubernetesObject,
  type KubernetesRestResponse,
  type KubernetesRuntimeApi,
} from './runtime-transport-types';

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
    secretsSecretName: environment.UI4A_KUBERNETES_SECRETS_SECRET ?? 'ui4a-runner-secrets',
    secretsKey: environment.UI4A_KUBERNETES_SECRETS_KEY ?? 'runner-secrets.json',
    workspaceClaimName: environment.UI4A_KUBERNETES_WORKSPACE_CLAIM ?? 'runtime-data',
    workspaceMountPath: environment.UI4A_KUBERNETES_WORKSPACE_MOUNT ?? '/workspaces',
    runnerServiceAccountName: environment.UI4A_KUBERNETES_RUNNER_SERVICE_ACCOUNT ?? 'ui4a-runner',
    pollIntervalMs: Number(environment.UI4A_KUBERNETES_POLL_INTERVAL_MS ?? '1000'),
    forbiddenSecretValues: [...forbiddenSecretValues],
  });
}
