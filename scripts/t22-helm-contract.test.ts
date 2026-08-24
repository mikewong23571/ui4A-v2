import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const chartRoot = resolve(repositoryRoot, 'deploy/helm/ui4a');
const plannedFiles = ['Chart.yaml', 'values.yaml', 'values.schema.json', 'render.ts'] as const;
const missingFiles = plannedFiles.filter((file) => !existsSync(resolve(chartRoot, file)));

function helmTemplateSource(): string {
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
  secrets: { existingSecretName: string };
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

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function genericValues(): GenericHelmValues {
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
    secrets: { existingSecretName: 'ui4a-runtime-secrets' },
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

function staticValues(): GenericHelmValues {
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

async function renderer(): Promise<RendererModule> {
  const module = (await import(
    pathToFileURL(resolve(chartRoot, 'render.ts')).href
  )) as Partial<RendererModule>;
  if (typeof module.renderUi4aChart !== 'function') {
    throw new Error('deploy/helm/ui4a/render.ts must export renderUi4aChart(values)');
  }
  return module as RendererModule;
}

function workload(resources: KubernetesObject[], kind: string, name: string): KubernetesObject {
  const resource = resources.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) throw new Error(`missing ${kind}/${name}`);
  return resource;
}

function record(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function podSpec(resource: KubernetesObject): Record<string, unknown> {
  const spec = record(resource.spec);
  if (resource.kind === 'CronJob') {
    const jobSpec = record(record(spec.jobTemplate).spec);
    return record(record(jobSpec.template).spec);
  }
  if (resource.kind === 'Job') return record(record(spec.template).spec);
  return record(record(spec.template).spec);
}

function containers(resource: KubernetesObject): Record<string, unknown>[] {
  const pod = podSpec(resource);
  return [...list(pod.initContainers ?? []), ...list(pod.containers)].map(record);
}

function primaryContainer(resource: KubernetesObject): Record<string, unknown> {
  const candidate = containers(resource).at(-1);
  if (candidate === undefined)
    throw new Error(`${resource.kind}/${resource.metadata.name} has no container`);
  return candidate;
}

function environment(container: Record<string, unknown>): Record<string, string> {
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

function mountPaths(container: Record<string, unknown>): string[] {
  return list(container.volumeMounts ?? []).map((entry) => String(record(entry).mountPath));
}

function templateDocument(name: string): string {
  const document = helmTemplateSource()
    .split(/^---$/m)
    .find((candidate) => new RegExp(`^  name:\\s+["']?${name}["']?$`, 'm').test(candidate));
  if (document === undefined) throw new Error(`missing Helm template document ${name}`);
  return document;
}

describe('T22 generic Helm/Kubernetes render contract', () => {
  it('provides the planned chart metadata, schema, values and pure renderer', () => {
    expect(
      missingFiles,
      'Phase H Green must create the generic deploy/helm/ui4a chart and pure TypeScript renderer',
    ).toEqual([]);
  });

  it('backs the pure renderer with installable Helm templates for the same core inventory', () => {
    const source = helmTemplateSource();

    for (const kind of [
      'Deployment',
      'StatefulSet',
      'Job',
      'CronJob',
      'Service',
      'PersistentVolume',
      'PersistentVolumeClaim',
      'Gateway',
      'VirtualService',
      'RequestAuthentication',
      'AuthorizationPolicy',
    ]) {
      expect(source, `templates must render ${kind}`).toMatch(
        new RegExp(`^kind:\\s+${kind}$`, 'm'),
      );
    }
    for (const name of [
      'postgres',
      'temporal',
      'temporal-ui',
      'keycloak',
      'web',
      'worker',
      'runner',
      'postgres-bootstrap',
      'temporal-schema',
      'temporal-namespace',
      'pki-init',
      'migration',
      'realm-bootstrap',
      'backup',
    ]) {
      expect(source, `templates must render ${name}`).toMatch(
        new RegExp(`^  name:\\s+["']?${name}["']?$`, 'm'),
      );
    }
  });

  describe.runIf(missingFiles.length === 0)('rendered generic chart', () => {
    it('renders deterministically without mothership host, path or IP facts', async () => {
      const render = (await renderer()).renderUi4aChart;
      const values = genericValues();
      const first = render(values);
      const second = render(structuredClone(values));
      const serializedValues = JSON.stringify(values);

      expect(second).toEqual(first);
      expect(first.evidence.valuesHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(serializedValues).not.toMatch(/mothership|\/home\/|\/data\d*\//i);
      expect(serializedValues).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      expect(readFileSync(resolve(chartRoot, 'values.yaml'), 'utf8')).not.toMatch(
        /mothership|\/home\/|\/data\d*\/|\b(?:\d{1,3}\.){3}\d{1,3}\b/i,
      );
    });

    it('creates an Istio-injected namespace and bounded namespaced RBAC identities', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      const namespace = workload(resources, 'Namespace', 'ui4a-system');
      const serviceAccounts = resources
        .filter(({ kind }) => kind === 'ServiceAccount')
        .map(({ metadata }) => metadata.name)
        .sort();
      const rbac = resources.filter(({ kind }) => ['Role', 'RoleBinding'].includes(kind));

      expect(namespace.metadata.labels).toMatchObject({ 'istio-injection': 'enabled' });
      expect(serviceAccounts).toEqual(
        [
          'ui4a-admin-jobs',
          'ui4a-backup',
          'ui4a-keycloak',
          'ui4a-postgres',
          'ui4a-runner',
          'ui4a-temporal',
          'ui4a-web',
          'ui4a-worker',
        ].sort(),
      );
      expect(rbac.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['Role', 'RoleBinding']));
      expect(resources.some(({ kind }) => kind.startsWith('ClusterRole'))).toBe(false);
      expect(JSON.stringify(rbac)).not.toMatch(/"\*"/);
      for (const resource of resources.filter(({ kind }) => kind !== 'Namespace')) {
        if (['PersistentVolume'].includes(resource.kind)) continue;
        expect(resource.metadata.namespace, `${resource.kind}/${resource.metadata.name}`).toBe(
          'ui4a-system',
        );
      }
    });

    it('wires the Worker Kubernetes delivery source and callback Secrets with least privilege', async () => {
      const values = genericValues();
      const { resources } = (await renderer()).renderUi4aChart(values);
      const worker = workload(resources, 'Deployment', 'worker');
      const web = workload(resources, 'Deployment', 'web');
      const workerContainer = primaryContainer(worker);
      const workerEnv = environment(workerContainer);
      const role = workload(resources, 'Role', 'ui4a-runtime-jobs');
      const binding = workload(resources, 'RoleBinding', 'ui4a-runtime-jobs');

      expect(workerEnv).toMatchObject({
        UI4A_KUBERNETES_SETTINGS_CONFIGMAP: 'ui4a-deployment-settings',
        UI4A_KUBERNETES_SECRETS_SECRET: values.secrets.existingSecretName,
        UI4A_KUBERNETES_WORKSPACE_CLAIM: 'runtime-data',
        UI4A_KUBERNETES_RUNNER_SERVICE_ACCOUNT: values.serviceAccounts.runner,
      });
      for (const resource of [web, worker]) {
        const callback = list(primaryContainer(resource).env)
          .map(record)
          .find((variable) => variable.name === 'UI4A_CAPABILITY_CALLBACK_TOKEN');
        expect(callback, resource.metadata.name).toEqual({
          name: 'UI4A_CAPABILITY_CALLBACK_TOKEN',
          valueFrom: {
            secretKeyRef: {
              name: values.secrets.existingSecretName,
              key: 'capability-callback-token',
            },
          },
        });
      }
      expect(record(role).rules).toEqual([
        { apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'delete'] },
        { apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'create', 'delete'] },
        { apiGroups: [''], resources: ['pods'], verbs: ['list'] },
        { apiGroups: [''], resources: ['pods/log'], verbs: ['get'] },
      ]);
      expect(record(binding).subjects).toEqual([
        {
          kind: 'ServiceAccount',
          name: values.serviceAccounts.worker,
          namespace: values.namespace.name,
        },
      ]);
      expect(JSON.stringify({ workerEnv, role, binding })).not.toContain(
        '__callback_token_material__',
      );
    });

    it('strictly projects optional hostAliases only to external-origin consumers', async () => {
      const values = genericValues();
      values.network.hostAliases = [
        {
          ip: '192.0.2.10',
          hostnames: [values.hosts.web, values.hosts.keycloak],
        },
      ];
      const { resources } = (await renderer()).renderUi4aChart(values);

      for (const [kind, name] of [
        ['Deployment', 'web'],
        ['Deployment', 'worker'],
        ['Job', 'migration'],
        ['Job', 'realm-bootstrap'],
      ] as const) {
        expect(podSpec(workload(resources, kind, name)).hostAliases, `${kind}/${name}`).toEqual(
          values.network.hostAliases,
        );
      }
      expect(helmTemplateSource()).toContain('.Values.network.hostAliases');
      expect(readFileSync(resolve(chartRoot, 'values.yaml'), 'utf8')).toMatch(
        /network:\s*\n\s+hostAliases:\s*\[\]/,
      );
    });

    it('rejects malformed or request-shaped host aliases before rendering', async () => {
      const render = (await renderer()).renderUi4aChart;
      const malformed = genericValues();
      malformed.network.hostAliases = [{ ip: 'not-an-ip', hostnames: ['issuer.internal'] }];
      expect(() => render(malformed)).toThrow(/network\.hostAliases|IP/i);

      const unexpected = genericValues() as GenericHelmValues & {
        network: { hostAliases: Array<Record<string, unknown>> };
      };
      unexpected.network.hostAliases = [
        { ip: '192.0.2.10', hostnames: ['issuer.internal'], token: 'request-override' },
      ];
      expect(() => render(unexpected)).toThrow(/unknown|field|network\.hostAliases/i);
    });

    it('keeps every experimental component single-replica and renders the complete stack', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      const expectedWorkloads: Array<[string, string]> = [
        ['StatefulSet', 'postgres'],
        ['Deployment', 'temporal'],
        ['Deployment', 'temporal-ui'],
        ['Deployment', 'keycloak'],
        ['Deployment', 'web'],
        ['Deployment', 'worker'],
        ['Deployment', 'runner'],
        ['Job', 'postgres-bootstrap'],
        ['Job', 'temporal-schema'],
        ['Job', 'temporal-namespace'],
        ['Job', 'pki-init'],
        ['Job', 'migration'],
        ['Job', 'realm-bootstrap'],
        ['CronJob', 'backup'],
      ];

      for (const [kind, name] of expectedWorkloads) workload(resources, kind, name);
      for (const resource of resources.filter(({ kind }) =>
        ['Deployment', 'StatefulSet'].includes(kind),
      )) {
        expect(record(resource.spec).replicas, `${resource.kind}/${resource.metadata.name}`).toBe(
          1,
        );
      }
      expect(JSON.stringify(resources)).not.toMatch(/highAvailability["']?\s*:\s*true/i);
    });

    it('disables Istio sidecars on exactly the six finite admin Jobs', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      const jobs = resources.filter(({ kind }) => kind === 'Job');
      expect(jobs.map(({ metadata }) => metadata.name).sort()).toEqual(
        [
          'postgres-bootstrap',
          'temporal-schema',
          'temporal-namespace',
          'pki-init',
          'migration',
          'realm-bootstrap',
        ].sort(),
      );
      for (const job of jobs) {
        expect(record(record(job.spec).template).metadata).toMatchObject({
          annotations: { 'sidecar.istio.io/inject': 'false' },
        });
      }
      for (const workloadResource of resources.filter(({ kind }) =>
        ['Deployment', 'StatefulSet'].includes(kind),
      )) {
        const annotations = record(record(workloadResource.spec).template).metadata;
        expect(
          JSON.stringify(annotations),
          `${workloadResource.kind}/${workloadResource.metadata.name}`,
        ).not.toContain('sidecar.istio.io/inject');
      }
      expect(helmTemplateSource().match(/sidecar\.istio\.io\/inject:/g)).toHaveLength(6);
    });

    it('pins every workload image by digest with the offline-compatible pull policy', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      const workloads = resources.filter(({ kind }) =>
        ['Deployment', 'StatefulSet', 'Job', 'CronJob'].includes(kind),
      );

      for (const resource of workloads) {
        for (const container of containers(resource)) {
          expect(container.image, `${resource.kind}/${resource.metadata.name}`).toMatch(
            /^\S+@sha256:[a-f0-9]{64}$/,
          );
          expect(container.imagePullPolicy, `${resource.kind}/${resource.metadata.name}`).toBe(
            'IfNotPresent',
          );
        }
      }
    });

    it('sets resources on all containers and independent probes on long-running services', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      const workloads = resources.filter(({ kind }) =>
        ['Deployment', 'StatefulSet', 'Job', 'CronJob'].includes(kind),
      );
      for (const resource of workloads) {
        for (const container of containers(resource)) {
          const resourceBudget = record(container.resources);
          expect(record(resourceBudget.requests)).not.toEqual({});
          expect(record(resourceBudget.limits)).not.toEqual({});
        }
      }
      for (const [kind, name] of [
        ['StatefulSet', 'postgres'],
        ['Deployment', 'keycloak'],
        ['Deployment', 'web'],
        ['Deployment', 'worker'],
        ['Deployment', 'runner'],
      ] as const) {
        const primary = containers(workload(resources, kind, name)).at(-1);
        expect(primary?.livenessProbe, `${kind}/${name}`).toBeTruthy();
        expect(primary?.readinessProbe, `${kind}/${name}`).toBeTruthy();
        expect(primary?.livenessProbe).not.toEqual(primary?.readinessProbe);
      }
    });

    it('pins verified vendor-image numeric identities without assigning Keycloak speculatively', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      for (const [kind, name] of [
        ['Deployment', 'temporal'],
        ['Deployment', 'temporal-ui'],
        ['Job', 'temporal-schema'],
        ['Job', 'temporal-namespace'],
      ] as const) {
        expect(
          record(primaryContainer(workload(resources, kind, name)).securityContext),
        ).toMatchObject({ runAsUser: 1000, runAsGroup: 1000 });
      }
      for (const [kind, name] of [
        ['Job', 'postgres-bootstrap'],
        ['CronJob', 'backup'],
      ] as const) {
        expect(
          record(primaryContainer(workload(resources, kind, name)).securityContext),
        ).toMatchObject({ runAsUser: 70, runAsGroup: 70 });
      }
      expect(
        record(primaryContainer(workload(resources, 'Deployment', 'keycloak')).securityContext)
          .runAsUser,
      ).toBeUndefined();
    });

    it('pins every UI4A Node container to the image numeric uid and leaves external images alone', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      for (const [kind, name] of [
        ['Deployment', 'web'],
        ['Deployment', 'worker'],
        ['Deployment', 'runner'],
        ['Job', 'migration'],
        ['Job', 'realm-bootstrap'],
      ] as const) {
        expect(
          record(primaryContainer(workload(resources, kind, name)).securityContext),
        ).toMatchObject({ runAsUser: 1000, runAsGroup: 1000 });
      }
      for (const resource of resources.filter(({ kind }) =>
        ['Deployment', 'StatefulSet', 'Job'].includes(kind),
      )) {
        for (const init of list(podSpec(resource).initContainers ?? []).map(record)) {
          if (String(init.name).startsWith('wait-for-') || init.name === 'trust-init') {
            expect(
              record(init.securityContext),
              `${resource.kind}/${resource.metadata.name}/${String(init.name)}`,
            ).toMatchObject({ runAsUser: 1000, runAsGroup: 1000 });
          }
        }
      }
      for (const [kind, name] of [
        ['StatefulSet', 'postgres'],
        ['Deployment', 'keycloak'],
      ] as const) {
        expect(
          record(primaryContainer(workload(resources, kind, name)).securityContext).runAsUser,
        ).not.toBe(1000);
      }
    });

    it('applies one server-owned nodeSelector to every state, UI4A and admin workload', async () => {
      const values = genericValues();
      values.scheduling.nodeSelector = { 'node-role.kubernetes.io/ui4a': 'true' };
      const { resources } = (await renderer()).renderUi4aChart(values);
      const workloads = resources.filter(({ kind }) =>
        ['Deployment', 'StatefulSet', 'Job', 'CronJob'].includes(kind),
      );

      for (const resource of workloads) {
        expect(
          podSpec(resource).nodeSelector,
          `${resource.kind}/${resource.metadata.name}`,
        ).toEqual(values.scheduling.nodeSelector);
      }
      const templates = helmTemplateSource();
      expect(templates).toMatch(/nodeSelector:/);
      expect(templates).toMatch(/Values\.scheduling\.nodeSelector/);
      expect(readFileSync(resolve(chartRoot, 'values.yaml'), 'utf8')).toMatch(
        /scheduling:\s*\n\s+nodeSelector:\s*\{\}/,
      );
    });

    it('supports replaceable StorageClass claims and explicit static retained volumes', async () => {
      const render = (await renderer()).renderUi4aChart;
      const dynamic = render(genericValues()).resources;
      const staticResources = render(staticValues()).resources;
      const dynamicClaims = dynamic.filter(({ kind }) => kind === 'PersistentVolumeClaim');
      const staticVolumes = staticResources.filter(({ kind }) => kind === 'PersistentVolume');
      const staticClaims = staticResources.filter(({ kind }) => kind === 'PersistentVolumeClaim');

      expect(dynamicClaims).toHaveLength(4);
      expect(dynamic.some(({ kind }) => kind === 'PersistentVolume')).toBe(false);
      for (const claim of dynamicClaims) {
        expect(record(claim.spec).storageClassName).toBe('replaceable-storage');
      }
      expect(staticVolumes).toHaveLength(4);
      expect(staticClaims).toHaveLength(4);
      for (const volume of staticVolumes) {
        expect(record(volume.spec).persistentVolumeReclaimPolicy).toBe('Retain');
        expect(record(volume.spec).storageClassName).toBe('');
        expect(record(record(volume.spec).nodeAffinity)).toBeTruthy();
      }
      for (const claim of staticClaims) {
        expect(record(claim.spec).volumeName).toMatch(/^ui4a-.+-static$/);
      }
    });

    it('renders a bounded, non-overlapping PostgreSQL backup CronJob', async () => {
      const { resources } = (await renderer()).renderUi4aChart(genericValues());
      const backup = workload(resources, 'CronJob', 'backup');
      const spec = record(backup.spec);
      const jobSpec = record(record(spec.jobTemplate).spec);
      const backupPod = record(record(jobSpec.template).spec);

      expect(spec.schedule).toBe('17 2 * * *');
      expect(spec.concurrencyPolicy).toBe('Forbid');
      expect(spec.suspend).toBe(false);
      expect(spec.successfulJobsHistoryLimit).toBeGreaterThan(0);
      expect(spec.failedJobsHistoryLimit).toBeGreaterThan(0);
      expect(jobSpec.backoffLimit).toBeGreaterThanOrEqual(0);
      expect(backupPod.restartPolicy).toBe('Never');
      expect(backupPod.serviceAccountName).toBe('ui4a-backup');
    });

    it('renders TLS routing plus JWT and callback-aware Istio authorization', async () => {
      const values = genericValues();
      const { resources } = (await renderer()).renderUi4aChart(values);
      const gateway = workload(resources, 'Gateway', 'ui4a-internal');
      const virtualServices = resources.filter(({ kind }) => kind === 'VirtualService');
      const authentication = workload(resources, 'RequestAuthentication', 'ui4a-web-jwt');
      const authorization = workload(resources, 'AuthorizationPolicy', 'ui4a-web');
      const gatewayText = JSON.stringify(gateway);
      const authnText = JSON.stringify(authentication);
      const authzText = JSON.stringify(authorization);

      expect(gateway.apiVersion).toBe('networking.istio.io/v1beta1');
      expect(gatewayText).toContain(values.hosts.web);
      expect(gatewayText).toContain(values.hosts.keycloak);
      expect(gatewayText).toContain(values.istio.tlsCredentialName);
      expect(gatewayText).toMatch(/HTTPS/);
      expect(virtualServices).toHaveLength(2);
      expect(JSON.stringify(virtualServices)).toContain(values.istio.gateway);
      expect(authnText).toContain(values.istio.oidcIssuer);
      expect(authnText).toContain(values.istio.oidcAudience);
      expect(authnText).toContain(values.istio.jwksUri);
      expect(authzText).not.toContain('requestPrincipals');
      expect(authzText).toContain('/api/internal/*');
      expect(authzText).toContain(
        `cluster.local/ns/${values.namespace.name}/sa/${values.serviceAccounts.worker}`,
      );
      expect(JSON.stringify(virtualServices)).toContain('directResponse');
      expect(JSON.stringify(virtualServices)).toContain('/api/internal/');
      const templates = helmTemplateSource();
      expect(templates).toMatch(/jwksUri:\s*\{\{\s*\.Values\.istio\.jwksUri/);
      expect(templates).not.toMatch(/requestPrincipals/);
      expect(templates).toMatch(/notPaths:\s*\[['"]\/api\/internal\/\*['"]\]/);
    });

    it('keeps Secret material outside manifests and reduced render evidence', async () => {
      const result = (await renderer()).renderUi4aChart(genericValues());
      const evidenceText = JSON.stringify(result.evidence);

      expect(result.resources.some(({ kind }) => kind === 'Secret')).toBe(false);
      expect(result.evidence.schemaVersion).toBe(1);
      expect(result.evidence.resourceRefs).toHaveLength(result.resources.length);
      expect(evidenceText).not.toMatch(
        /stringData|secretKeyRef|envFrom|privateKey|password|token/i,
      );
      for (const reference of result.evidence.resourceRefs) {
        expect(Object.keys(reference).sort()).toEqual(
          [
            'apiVersion',
            'kind',
            'name',
            ...(reference.namespace === undefined ? [] : ['namespace']),
          ].sort(),
        );
      }
      const schema = JSON.parse(readFileSync(resolve(chartRoot, 'values.schema.json'), 'utf8')) as {
        properties?: { secrets?: { additionalProperties?: boolean; properties?: object } };
      };
      expect(schema.properties?.secrets?.additionalProperties).toBe(false);
      expect(schema.properties?.secrets?.properties).toEqual({
        existingSecretName: expect.any(Object),
      });
    });

    describe('executable production parity', () => {
      it.each([
        [
          'postgres-bootstrap',
          [
            'PGHOST',
            'PGDATABASE',
            'PGUSER',
            'postgres-bootstrap-password',
            'ui4a_migration_password',
            'ui4a_runtime_password',
            'keycloak_runtime_password',
            'temporal_schema_password',
            'temporal_runtime_password',
            'postgres_backup_password',
          ],
        ],
        [
          'temporal-schema',
          [
            '--ep postgres',
            '--db temporal setup-schema',
            '--db temporal update-schema',
            '--db temporal_visibility setup-schema',
            '--db temporal_visibility update-schema',
            'temporal-schema-password',
          ],
        ],
        [
          'temporal-namespace',
          ['namespace describe', 'namespace create', '--address temporal:7233', '--retention 72h'],
        ],
        [
          'pki-init',
          [
            'command: [node, dist/main.js, pki-init]',
            'UI4A_PKI_ROOT',
            'UI4A_HOST',
            'KEYCLOAK_HOST',
          ],
        ],
        ['migration', ['command: [node, dist/t22-migrate.js]']],
        [
          'realm-bootstrap',
          [
            'command: [node, dist/t22-keycloak-realm-bootstrap.js, --apply]',
            'UI4A_REALM_IMPORT_FILE',
          ],
        ],
      ] as const)('keeps the verified %s admin execution contract', (name, requiredTokens) => {
        const document = templateDocument(name);
        const missing = requiredTokens.filter((token) => !document.includes(token));

        expect(missing, `${name} is not executable-equivalent to Compose`).toEqual([]);
      });

      it.each([
        ['Deployment', 'web', ['/tmp', '/app/apps/web/.next/cache']],
        ['Deployment', 'worker', ['/tmp', '/var/lib/ui4a']],
        ['Deployment', 'runner', ['/tmp', '/workspaces', '/artifacts']],
        ['Job', 'migration', ['/tmp']],
        ['Job', 'realm-bootstrap', ['/tmp', '/opt/ui4a/realm-import.json']],
      ] as const)(
        'mounts production config, CA and writable paths for %s/%s',
        async (kind, name, writablePaths) => {
          const { resources } = (await renderer()).renderUi4aChart(genericValues());
          const resource = workload(resources, kind, name);
          const container = primaryContainer(resource);
          const env = environment(container);
          const paths = mountPaths(container);

          expect(env).toMatchObject({
            UI4A_DEPLOYMENT_PROFILE: 'production',
            UI4A_DEPLOYMENT_SETTINGS_FILE: '/run/ui4a/settings.json',
            UI4A_DEPLOYMENT_SECRETS_FILE: '/run/secrets/ui4a-deployment-secrets',
            NODE_EXTRA_CA_CERTS: '/var/run/ui4a/trust/ca-bundle.crt',
          });
          expect(paths).toEqual(
            expect.arrayContaining([
              '/run/ui4a/settings.json',
              '/run/secrets/ui4a-deployment-secrets',
              '/var/lib/ui4a/ca',
              ...writablePaths,
            ]),
          );
        },
      );

      it('renders an executable TLS PostgreSQL state service', async () => {
        const { resources } = (await renderer()).renderUi4aChart(genericValues());
        const postgres = workload(resources, 'StatefulSet', 'postgres');
        const serialized = JSON.stringify(postgres);

        expect(serialized).toContain('POSTGRES_PASSWORD_FILE');
        expect(serialized).toContain('postgres-bootstrap-password');
        expect(serialized).toContain('ssl=on');
        expect(serialized).toContain('server.crt');
        expect(serialized).toContain('server.key');
        expect(mountPaths(primaryContainer(postgres))).toEqual(
          expect.arrayContaining([
            '/var/lib/postgresql/data',
            '/backups',
            '/run/postgresql',
            '/tmp',
          ]),
        );
      });

      it('mounts the verified Temporal server config and UI address', async () => {
        const { resources } = (await renderer()).renderUi4aChart(genericValues());
        const temporal = workload(resources, 'Deployment', 'temporal');
        const temporalUi = workload(resources, 'Deployment', 'temporal-ui');
        const serverText = JSON.stringify(temporal);

        expect(serverText).toContain('/etc/temporal/config/docker.yaml');
        expect(serverText).toContain('/etc/temporal/dynamicconfig/docker.yaml');
        expect(serverText).toContain('temporal-server');
        expect(serverText).toContain('TEMPORAL_RUNTIME_PASSWORD');
        expect(environment(primaryContainer(temporalUi))).toMatchObject({
          TEMPORAL_ADDRESS: 'temporal:7233',
        });
      });

      it('renders the verified Keycloak database and bootstrap environment', async () => {
        const { resources } = (await renderer()).renderUi4aChart(genericValues());
        const keycloak = workload(resources, 'Deployment', 'keycloak');
        const env = environment(primaryContainer(keycloak));

        expect(env).toMatchObject({
          KC_DB: 'postgres',
          KC_DB_URL_HOST: 'postgres',
          KC_DB_URL_DATABASE: 'keycloak',
          KC_DB_USERNAME: 'keycloak_runtime',
          KC_HEALTH_ENABLED: 'true',
          KC_HTTP_ENABLED: 'true',
          KC_PROXY_HEADERS: 'xforwarded',
        });
        expect(JSON.stringify(keycloak)).toContain('keycloak-bootstrap-admin-password');
        expect(JSON.stringify(keycloak)).toContain('keycloak-database-password');
        expect(primaryContainer(keycloak).args).toEqual(['start', '--optimized']);
      });

      it.each([
        ['Job', 'postgres-bootstrap', ['postgres']],
        ['Job', 'temporal-schema', ['postgres-bootstrap']],
        ['Deployment', 'temporal', ['temporal-schema']],
        ['Job', 'temporal-namespace', ['temporal']],
        ['Deployment', 'keycloak', ['postgres-bootstrap', 'pki-init']],
        ['Job', 'realm-bootstrap', ['keycloak', 'pki-init']],
        ['Job', 'migration', ['postgres-bootstrap', 'pki-init']],
        ['Deployment', 'web', ['migration', 'realm-bootstrap', 'temporal-namespace', 'pki-init']],
        ['Deployment', 'worker', ['migration', 'realm-bootstrap', 'temporal-namespace']],
        ['Deployment', 'runner', ['pki-init']],
      ] as const)(
        'gates %s/%s on executable dependency checks',
        async (kind, name, dependencies) => {
          const { resources } = (await renderer()).renderUi4aChart(genericValues());
          const resource = workload(resources, kind, name);
          const initContainers = list(podSpec(resource).initContainers ?? []).map(record);
          const checkedDependencies = initContainers.flatMap((container) =>
            list(container.env ?? [])
              .map(record)
              .filter((variable) => variable.name === 'UI4A_WAIT_FOR')
              .map((variable) => String(variable.value)),
          );

          expect(checkedDependencies.sort(), `${kind}/${name} can race its dependencies`).toEqual(
            [...dependencies].sort(),
          );
        },
      );
    });
  });
});
