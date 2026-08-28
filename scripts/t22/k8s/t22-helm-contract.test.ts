import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  chartRoot,
  containers,
  digest,
  environment,
  genericValues,
  helmTemplateSource,
  list,
  missingFiles,
  mountPaths,
  plannedFiles,
  podSpec,
  primaryContainer,
  record,
  renderer,
  staticValues,
  templateDocument,
  workload,
} from './t22-helm-test-helpers';

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
        UI4A_RUNNER_IMAGE: values.images.runner,
        UI4A_KUBERNETES_SETTINGS_CONFIGMAP: 'ui4a-deployment-settings',
        UI4A_KUBERNETES_SECRETS_SECRET: values.secrets.runnerExistingSecretName,
        UI4A_KUBERNETES_SECRETS_KEY: values.secrets.runnerSecretsKey,
        UI4A_KUBERNETES_WORKSPACE_CLAIM: 'runtime-data',
        UI4A_KUBERNETES_RUNNER_SERVICE_ACCOUNT: values.serviceAccounts.runner,
      });
      expect(
        resources.some(
          ({ kind, metadata }) =>
            ['Deployment', 'Service'].includes(kind) && metadata.name === 'runner',
        ),
      ).toBe(false);
      workload(resources, 'ServiceAccount', values.serviceAccounts.runner);
      workload(resources, 'PersistentVolumeClaim', 'runtime-data');
      expect(mountPaths(workerContainer)).toContain('/workspaces');
      expect(list(podSpec(worker).volumes).map(record)).toContainEqual({
        name: 'runtime-data',
        persistentVolumeClaim: { claimName: 'runtime-data' },
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

    it('pins finite Job bootstrap images independently from rolling Runtime images', async () => {
      const values = genericValues();
      const { resources } = (await renderer()).renderUi4aChart(values);
      const jobs = resources.filter(({ kind }) => kind === 'Job');

      for (const job of jobs) {
        for (const container of containers(job)) {
          if (String(container.name).startsWith('wait-for-')) {
            expect(container.image, `${job.metadata.name}/${String(container.name)}`).toBe(
              values.images.adminWorker,
            );
          }
          if (container.name === 'trust-init') {
            expect(container.image, `${job.metadata.name}/trust-init`).toBe(
              values.images.pkiRunner,
            );
          }
        }
      }
      expect(primaryContainer(workload(resources, 'Job', 'migration')).image).toBe(
        values.images.adminWorker,
      );
      expect(primaryContainer(workload(resources, 'Job', 'realm-bootstrap')).image).toBe(
        values.images.adminWorker,
      );
      expect(primaryContainer(workload(resources, 'Job', 'pki-init')).image).toBe(
        values.images.pkiRunner,
      );

      expect(primaryContainer(workload(resources, 'Deployment', 'web')).image).toBe(
        values.images.web,
      );
      expect(primaryContainer(workload(resources, 'Deployment', 'worker')).image).toBe(
        values.images.worker,
      );
      expect(JSON.stringify(podSpec(workload(resources, 'Deployment', 'worker')))).toContain(
        values.images.runner,
      );
      for (const name of ['temporal', 'temporal-ui', 'keycloak', 'web', 'worker']) {
        const pod = podSpec(workload(resources, 'Deployment', name));
        for (const init of list(pod.initContainers ?? []).map(record)) {
          if (String(init.name).startsWith('wait-for-')) {
            expect(init.image, `${name}/${String(init.name)}`).toBe(values.images.adminWorker);
          }
        }
      }
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

    it('pins every workload image by digest with the offline-safe pull policy', async () => {
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
      ] as const) {
        const primary = containers(workload(resources, kind, name)).at(-1);
        expect(primary?.livenessProbe, `${kind}/${name}`).toBeTruthy();
        expect(primary?.readinessProbe, `${kind}/${name}`).toBeTruthy();
        expect(primary?.livenessProbe).not.toEqual(primary?.readinessProbe);
      }
    });
  });
});
