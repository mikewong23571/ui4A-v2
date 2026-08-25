import { createHash } from 'node:crypto';

export type KubernetesObject = Record<string, unknown>;

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

export interface KubernetesRestResponse {
  status: number;
  body: string;
}

export interface InClusterRestDependencies {
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

export const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const dnsLabelPattern = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const absolutePathPattern = /^\/(?!$)/;
export const runnerResultFields = [
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

export class KubernetesRestError extends Error {
  constructor(readonly status: number) {
    super(`runtime_kubernetes_status:${status}`);
  }
}

export function object(value: unknown, code: string): KubernetesObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value as KubernetesObject;
}

export function exactFields(value: KubernetesObject, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

export function requiredName(value: string, code: string): string {
  if (!dnsLabelPattern.test(value)) throw new Error(code);
  return value;
}

export function requiredPath(value: string, code: string): string {
  if (!absolutePathPattern.test(value) || value.includes('..')) throw new Error(code);
  return value;
}

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function containsSecret(value: string, secrets: readonly string[]): boolean {
  return secrets.some((secret) => secret !== '' && value.includes(secret));
}

export function metadata(value: KubernetesObject, code: string): KubernetesObject {
  return object(value.metadata, code);
}

export function annotations(value: KubernetesObject): KubernetesObject {
  const candidate = metadata(value, 'runtime_kubernetes_object_invalid').annotations;
  return candidate === undefined ? {} : object(candidate, 'runtime_kubernetes_object_invalid');
}
