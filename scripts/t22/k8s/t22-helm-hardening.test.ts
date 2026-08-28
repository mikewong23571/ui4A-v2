import { readFileSync } from 'node:fs';
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
  mountPaths,
  podSpec,
  primaryContainer,
  record,
  renderer,
  staticValues,
  templateDocument,
  workload,
} from './t22-helm-test-helpers';

describe('T22 generic Helm/Kubernetes workload hardening & production parity', () => {
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

  it('mounts Kubernetes API credentials only into Temporal wait init containers', async () => {
    const { resources } = (await renderer()).renderUi4aChart(genericValues());
    for (const [kind, name] of [
      ['Deployment', 'temporal'],
      ['Job', 'temporal-schema'],
    ] as const) {
      const workloadResource = workload(resources, kind, name);
      const pod = podSpec(workloadResource);
      const wait = list(pod.initContainers).map(record).at(0)!;
      const primary = primaryContainer(workloadResource);
      expect(pod.automountServiceAccountToken, `${kind}/${name}`).toBe(false);
      expect(list(wait.volumeMounts).map((entry) => record(entry).name)).toContain(
        'dependency-api-token',
      );
      expect(list(primary.volumeMounts ?? []).map((entry) => record(entry).name)).not.toContain(
        'dependency-api-token',
      );
      expect(list(pod.volumes).map(record)).toContainEqual(
        expect.objectContaining({
          name: 'dependency-api-token',
          projected: expect.objectContaining({ sources: expect.any(Array) }),
        }),
      );
    }
    for (const [kind, name] of [
      ['Deployment', 'temporal-ui'],
      ['Job', 'temporal-namespace'],
    ] as const) {
      const pod = podSpec(workload(resources, kind, name));
      expect(pod.automountServiceAccountToken, `${kind}/${name}`).toBe(false);
      expect(JSON.stringify(primaryContainer(workload(resources, kind, name)))).not.toContain(
        '/var/run/secrets/kubernetes.io/serviceaccount',
      );
    }
  });

  it('pins every UI4A Node container to the image numeric uid and leaves external images alone', async () => {
    const { resources } = (await renderer()).renderUi4aChart(genericValues());
    for (const [kind, name] of [
      ['Deployment', 'web'],
      ['Deployment', 'worker'],
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
      expect(podSpec(resource).nodeSelector, `${resource.kind}/${resource.metadata.name}`).toEqual(
        values.scheduling.nodeSelector,
      );
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

  it('keeps the incomplete automatic backup CronJob suspended and non-authoritative', async () => {
    const { resources } = (await renderer()).renderUi4aChart(genericValues());
    const backup = workload(resources, 'CronJob', 'backup');
    const spec = record(backup.spec);
    const jobSpec = record(record(spec.jobTemplate).spec);
    const backupPod = record(record(jobSpec.template).spec);
    const staticTemplate = readFileSync(resolve(chartRoot, 'templates/backup.yaml'), 'utf8');
    const notes = readFileSync(resolve(chartRoot, 'templates/NOTES.txt'), 'utf8');

    expect(spec.schedule).toBe('17 2 * * *');
    expect(spec.concurrencyPolicy).toBe('Forbid');
    expect(spec.suspend).toBe(true);
    expect(spec.successfulJobsHistoryLimit).toBeGreaterThan(0);
    expect(spec.failedJobsHistoryLimit).toBeGreaterThan(0);
    expect(jobSpec.backoffLimit).toBeGreaterThanOrEqual(0);
    expect(backupPod.restartPolicy).toBe('Never');
    expect(backupPod.serviceAccountName).toBe('ui4a-backup');
    expect(staticTemplate).toContain('suspend: true');
    expect(notes).toContain('automatic CronJob is suspended');
    expect(notes).toContain('non-authoritative');
    expect(notes).toContain('scripts/t22/recovery/t22-k8s-recovery-live.ts');
    expect(notes).toContain('ten-artifact');
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
    expect(record(list(record(authentication.spec).jwtRules)[0]).forwardOriginalToken).toBe(true);
    expect(authzText).not.toContain('requestPrincipals');
    expect(authzText).not.toContain('notPaths');
    expect(authzText).not.toContain('/api/internal/capability-callback');
    expect(authzText).toContain('/api/internal/agent-run-callback');
    expect(authzText).toContain(
      `cluster.local/ns/${values.namespace.name}/sa/${values.serviceAccounts.worker}`,
    );
    expect(JSON.stringify(virtualServices)).toContain('directResponse');
    expect(JSON.stringify(virtualServices)).not.toContain('/api/internal/capability-callback');
    expect(JSON.stringify(virtualServices)).toContain('/api/internal/agent-run-callback');
    const templates = helmTemplateSource();
    expect(templates).toMatch(/jwksUri:\s*\{\{\s*\.Values\.istio\.jwksUri/);
    expect(templates).toMatch(/forwardOriginalToken:\s*true/);
    expect(templates).not.toMatch(/requestPrincipals/);
    expect(templates).not.toMatch(/notPaths:/);
    expect(templates).not.toMatch(/exact:\s*\/api\/internal\/capability-callback/);
    expect(templates).toMatch(/exact:\s*\/api\/internal\/agent-run-callback/);
  });

  it('keeps Secret material outside manifests and reduced render evidence', async () => {
    const result = (await renderer()).renderUi4aChart(genericValues());
    const evidenceText = JSON.stringify(result.evidence);

    expect(result.resources.some(({ kind }) => kind === 'Secret')).toBe(false);
    expect(result.evidence.schemaVersion).toBe(1);
    expect(result.evidence.resourceRefs).toHaveLength(result.resources.length);
    expect(evidenceText).not.toMatch(/stringData|secretKeyRef|envFrom|privateKey|password|token/i);
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
      runnerExistingSecretName: expect.any(Object),
      runnerSecretsKey: expect.any(Object),
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
        ['command: [node, dist/main.js, pki-init]', 'UI4A_PKI_ROOT', 'UI4A_HOST', 'KEYCLOAK_HOST'],
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
        expect.arrayContaining(['/var/lib/postgresql/data', '/backups', '/run/postgresql', '/tmp']),
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
      expect(serverText).not.toContain('TEMPORAL_RUNTIME_PASSWORD');
      expect(serverText).toContain('/run/secrets/temporal-runtime-password');
      expect(primaryContainer(temporal).readinessProbe).toEqual({
        grpc: { port: 7233 },
        initialDelaySeconds: 5,
        periodSeconds: 10,
      });
      expect(primaryContainer(temporal).livenessProbe).toEqual({
        grpc: { port: 7233 },
        initialDelaySeconds: 20,
        periodSeconds: 10,
      });
      expect(temporal.spec.template.metadata.annotations).toEqual({
        'proxy.istio.io/config': '{"holdApplicationUntilProxyStarts":true}',
      });
      expect(temporalUi.spec.template.spec.enableServiceLinks).toBe(false);
      expect(environment(primaryContainer(temporalUi))).toMatchObject({
        TEMPORAL_ADDRESS: 'temporal:7233',
      });
    });

    it('renders the verified Keycloak database and bootstrap environment', async () => {
      const values = genericValues();
      values.istio.oidcIssuer = 'https://auth.ui4a.internal.test:32067/realms/ui4a';
      const { resources } = (await renderer()).renderUi4aChart(values);
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
        KC_HOSTNAME: 'https://auth.ui4a.internal.test:32067',
      });
      expect(JSON.stringify(keycloak)).not.toMatch(/hostname-strict[^]*false/i);
      expect(JSON.stringify(keycloak)).toContain('keycloak-bootstrap-admin-password');
      expect(JSON.stringify(keycloak)).toContain('keycloak-database-password');
      expect(primaryContainer(keycloak).args).toEqual(['start']);
      expect(primaryContainer(keycloak).securityContext).toMatchObject({
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
        capabilities: { drop: ['ALL'] },
      });
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
    ] as const)('gates %s/%s on executable dependency checks', async (kind, name, dependencies) => {
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
    });
  });
});
