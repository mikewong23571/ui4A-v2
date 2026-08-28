/**
 * T22 Helm/Kubernetes 合同测试共享装配(T36 D2 自 t22-helm-contract.test.ts 提取):
 * 图表路径、模板源读取、通用/静态 values、纯渲染器加载与 K8s 对象查询助手。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect } from 'vitest';

export const repositoryRoot = resolve(import.meta.dirname, '../../..');
export const chartRoot = resolve(repositoryRoot, 'deploy/helm/ui4a');
export const plannedFiles = [
  'Chart.yaml',
  'values.yaml',
  'values.schema.json',
  'render.ts',
] as const;
export const missingFiles = plannedFiles.filter((file) => !existsSync(resolve(chartRoot, file)));

export function helmTemplateSource(): string {
  const templatesRoot = resolve(chartRoot, 'templates');
  if (!existsSync(templatesRoot)) return '';
  return readdirSync(templatesRoot, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.tpl')),
    )
    .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), 'utf8'))
    .join('\n---\n');
}

type KubernetesObject = Record<string, unknown> & {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
};

interface GenericHelmValues {
  schemaVersion: 1;
  namespace: { create: true; name: string; istioInjection: true };
  experimental: { highAvailability: false; replicas: 1 };
  scheduling: { nodeSelector: Record<string, string> };
  network: { hostAliases: Array<{ ip: string; hostnames: string[] }> };
  hosts: { web: string; keycloak: string };
  images: Record<string, string>;
  imagePullPolicy: 'IfNotPresent';
  serviceAccounts: {
    postgres: string;
    temporal: string;
    keycloak: string;
    web: string;
    worker: string;
    runner: string;
    admin: string;
    backup: string;
  };
  secrets: {
    existingSecretName: string;
    runnerExistingSecretName: string;
    runnerSecretsKey: string;
  };
  storage:
    | {
        mode: 'dynamic';
        storageClassName: string;
        sizes: Record<'postgres' | 'runtime' | 'backup' | 'pki', string>;
      }
    | {
        mode: 'static';
        volumes: Record<
          'postgres' | 'runtime' | 'backup' | 'pki',
          { volumeName: string; capacity: string; hostPath: string; nodeName: string }
        >;
      };
  backup: { schedule: string };
  istio: {
    gateway: string;
    tlsCredentialName: string;
    oidcIssuer: string;
    oidcAudience: string;
    jwksUri: string;
  };
}

interface RenderEvidence {
  schemaVersion: number;
  resourceRefs: Array<{ apiVersion: string; kind: string; namespace?: string; name: string }>;
  valuesHash: string;
}

interface RenderResult {
  resources: KubernetesObject[];
  evidence: RenderEvidence;
}

interface RendererModule {
  renderUi4aChart(values: GenericHelmValues): RenderResult;
}

export const digest = (character: string) => `sha256:${character.repeat(64)}`;

export function genericValues(): GenericHelmValues {
  const webHost = 'ui4a.internal.test';
  const keycloakHost = 'auth.ui4a.internal.test';
  return {
    schemaVersion: 1,
    namespace: { create: true, name: 'ui4a-system', istioInjection: true },
    experimental: { highAvailability: false, replicas: 1 },
    scheduling: { nodeSelector: {} },
    network: { hostAliases: [] },
    hosts: { web: webHost, keycloak: keycloakHost },
    images: {
      postgres: `registry.internal.test/postgres@${digest('1')}`,
      temporal: `registry.internal.test/temporal@${digest('2')}`,
      temporalAdminTools: `registry.internal.test/temporal-admin-tools@${digest('3')}`,
      temporalUi: `registry.internal.test/temporal-ui@${digest('4')}`,
      keycloak: `registry.internal.test/keycloak@${digest('5')}`,
      web: `registry.internal.test/ui4a-web@${digest('6')}`,
      worker: `registry.internal.test/ui4a-worker@${digest('7')}`,
      runner: `registry.internal.test/ui4a-runner@${digest('8')}`,
      adminWorker: `registry.internal.test/ui4a-admin-worker@${digest('9')}`,
      pkiRunner: `registry.internal.test/ui4a-pki-runner@${digest('a')}`,
    },
    imagePullPolicy: 'IfNotPresent',
    serviceAccounts: {
      postgres: 'ui4a-postgres',
      temporal: 'ui4a-temporal',
      keycloak: 'ui4a-keycloak',
      web: 'ui4a-web',
      worker: 'ui4a-worker',
      runner: 'ui4a-runner',
      admin: 'ui4a-admin-jobs',
      backup: 'ui4a-backup',
    },
    secrets: {
      existingSecretName: 'ui4a-runtime-secrets',
      runnerExistingSecretName: 'ui4a-runner-secrets',
      runnerSecretsKey: 'runner-secrets.json',
    },
    storage: {
      mode: 'dynamic',
      storageClassName: 'replaceable-storage',
      sizes: { postgres: '20Gi', runtime: '20Gi', backup: '40Gi', pki: '1Gi' },
    },
    backup: { schedule: '17 2 * * *' },
    istio: {
      gateway: 'ui4a-internal',
      tlsCredentialName: 'ui4a-internal-tls',
      oidcIssuer: `https://${keycloakHost}/realms/ui4a`,
      oidcAudience: 'ui4a-api',
      jwksUri:
        'http://keycloak.ui4a-system.svc.cluster.local:8080/realms/ui4a/protocol/openid-connect/certs',
    },
  };
}

export function staticValues(): GenericHelmValues {
  const values = genericValues();
  return {
    ...values,
    storage: {
      mode: 'static',
      volumes: {
        postgres: {
          volumeName: 'ui4a-postgres-static',
          capacity: '20Gi',
          hostPath: '/var/lib/ui4a-static/postgres',
          nodeName: 'replace-with-storage-node',
        },
        runtime: {
          volumeName: 'ui4a-runtime-static',
          capacity: '20Gi',
          hostPath: '/var/lib/ui4a-static/runtime',
          nodeName: 'replace-with-storage-node',
        },
        backup: {
          volumeName: 'ui4a-backup-static',
          capacity: '40Gi',
          hostPath: '/var/lib/ui4a-static/backup',
          nodeName: 'replace-with-storage-node',
        },
        pki: {
          volumeName: 'ui4a-pki-static',
          capacity: '1Gi',
          hostPath: '/var/lib/ui4a-static/pki',
          nodeName: 'replace-with-storage-node',
        },
      },
    },
  };
}

export async function renderer(): Promise<RendererModule> {
  const module = (await import(
    pathToFileURL(resolve(chartRoot, 'render.ts')).href
  )) as Partial<RendererModule>;
  if (typeof module.renderUi4aChart !== 'function') {
    throw new Error('deploy/helm/ui4a/render.ts must export renderUi4aChart(values)');
  }
  return module as RendererModule;
}

export function workload(
  resources: KubernetesObject[],
  kind: string,
  name: string,
): KubernetesObject {
  const resource = resources.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) throw new Error(`missing ${kind}/${name}`);
  return resource;
}

export function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

export function list(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

export function podSpec(resource: KubernetesObject): Record<string, unknown> {
  const spec = record(resource.spec);
  if (resource.kind === 'CronJob') {
    const jobSpec = record(record(spec.jobTemplate).spec);
    return record(record(jobSpec.template).spec);
  }
  if (resource.kind === 'Job') return record(record(spec.template).spec);
  return record(record(spec.template).spec);
}

export function containers(resource: KubernetesObject): Record<string, unknown>[] {
  const pod = podSpec(resource);
  return [...list(pod.initContainers ?? []), ...list(pod.containers)].map(record);
}

export function primaryContainer(resource: KubernetesObject): Record<string, unknown> {
  const candidate = containers(resource).at(-1);
  if (candidate === undefined)
    throw new Error(`${resource.kind}/${resource.metadata.name} has no container`);
  return candidate;
}

export function environment(container: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    list(container.env ?? [])
      .map(record)
      .filter(
        (variable): variable is Record<string, unknown> & { name: string; value: string } =>
          typeof variable.name === 'string' && typeof variable.value === 'string',
      )
      .map((variable) => [variable.name, variable.value]),
  );
}

export function mountPaths(container: Record<string, unknown>): string[] {
  return list(container.volumeMounts ?? []).map((entry) => String(record(entry).mountPath));
}

export function templateDocument(name: string): string {
  const document = helmTemplateSource()
    .split(/^---$/m)
    .find((candidate) => new RegExp(`^  name:\\s+["']?${name}["']?$`, 'm').test(candidate));
  if (document === undefined) throw new Error(`missing Helm template document ${name}`);
  return document;
}
