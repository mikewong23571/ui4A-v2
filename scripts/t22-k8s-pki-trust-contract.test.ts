import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const chartRoot = resolve(repositoryRoot, 'deploy/helm/ui4a');

type KubernetesObject = Record<string, unknown> & {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string };
};

interface RenderModule {
  renderUi4aChart(values: Record<string, unknown>): {
    resources: KubernetesObject[];
    evidence: unknown;
  };
}

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function values(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    namespace: { create: true, name: 'ui4a-system', istioInjection: true },
    experimental: { highAvailability: false, replicas: 1 },
    scheduling: { nodeSelector: {} },
    hosts: { web: 'ui4a.internal.test', keycloak: 'auth.ui4a.internal.test' },
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
      oidcIssuer: 'https://auth.ui4a.internal.test/realms/ui4a',
      oidcAudience: 'ui4a-api',
      jwksUri:
        'http://keycloak.ui4a-system.svc.cluster.local:8080/realms/ui4a/protocol/openid-connect/certs',
    },
  };
}

async function render() {
  const module = (await import(
    pathToFileURL(resolve(chartRoot, 'render.ts')).href
  )) as RenderModule;
  return module.renderUi4aChart(values());
}

function object(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function resource(resources: KubernetesObject[], kind: string, name: string): KubernetesObject {
  const candidate = resources.find((item) => item.kind === kind && item.metadata.name === name);
  if (candidate === undefined) throw new Error(`missing ${kind}/${name}`);
  return candidate;
}

function podSpec(item: KubernetesObject): Record<string, unknown> {
  const spec = object(item.spec);
  if (item.kind === 'Job') return object(object(spec.template).spec);
  return object(object(spec.template).spec);
}

function namedContainer(item: KubernetesObject, name: string): Record<string, unknown> {
  const pod = podSpec(item);
  const candidates = [...array(pod.initContainers ?? []), ...array(pod.containers)].map(object);
  const candidate = candidates.find((container) => container.name === name);
  if (candidate === undefined) throw new Error(`${item.kind}/${item.metadata.name} lacks ${name}`);
  return candidate;
}

function primaryContainer(item: KubernetesObject): Record<string, unknown> {
  const candidate = array(podSpec(item).containers).map(object).at(-1);
  if (candidate === undefined)
    throw new Error(`${item.kind}/${item.metadata.name} lacks container`);
  return candidate;
}

function environment(container: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    array(container.env ?? [])
      .map(object)
      .filter(
        (entry): entry is Record<string, unknown> & { name: string; value: string } =>
          typeof entry.name === 'string' && typeof entry.value === 'string',
      )
      .map((entry) => [entry.name, entry.value]),
  );
}

function mounts(container: Record<string, unknown>): Record<string, unknown>[] {
  return array(container.volumeMounts ?? []).map(object);
}

describe('T22 Kubernetes PKI handoff and combined trust contract', () => {
  it('pins the PostgreSQL certificate SAN to its canonical Service FQDN at pki-init', async () => {
    const { resources } = await render();
    const pkiInit = resource(resources, 'Job', 'pki-init');

    expect(environment(primaryContainer(pkiInit))).toMatchObject({
      UI4A_POSTGRES_HOST: 'postgres.ui4a-system.svc.cluster.local',
    });
  });

  it('hands verified PostgreSQL TLS material to a PostgreSQL-owned read-only runtime directory', async () => {
    const { resources } = await render();
    const postgres = resource(resources, 'StatefulSet', 'postgres');
    const handoff = namedContainer(postgres, 'postgres-tls-handoff');
    const handoffText = JSON.stringify(handoff);
    const primary = primaryContainer(postgres);
    const primaryText = JSON.stringify(primary);
    const podText = JSON.stringify(podSpec(postgres));

    expect(handoffText).toContain('/var/lib/ui4a/ca/postgres/server.crt');
    expect(handoffText).toContain('/var/lib/ui4a/ca/postgres/server.key');
    expect(handoffText).toContain('/var/lib/ui4a/ca/root-ca.crt');
    expect(handoffText).toContain('/var/run/ui4a/postgres-tls/server.crt');
    expect(handoffText).toContain('/var/run/ui4a/postgres-tls/server.key');
    expect(handoffText).toMatch(/chmod[^]*0600/);
    expect(handoffText).toContain('openssl');
    expect(handoffText).toContain('-checkhost');
    expect(handoffText).toContain('openssl verify');
    expect(handoffText).toMatch(/install[^]*-o 70[^]*-g 70[^]*-m 0600/);
    expect(object(handoff.securityContext)).toMatchObject({
      runAsUser: 0,
      capabilities: {
        drop: ['ALL'],
        add: expect.arrayContaining(['CHOWN', 'DAC_READ_SEARCH', 'FOWNER']),
      },
    });
    expect(primaryText).toContain('ssl_cert_file=/var/run/ui4a/postgres-tls/server.crt');
    expect(primaryText).toContain('ssl_key_file=/var/run/ui4a/postgres-tls/server.key');
    expect(primaryText).toContain('ssl_ca_file=/var/run/ui4a/postgres-tls/root-ca.crt');
    expect(primaryText).not.toContain('/var/lib/ui4a/ca');
    expect(mounts(primary)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'postgres-tls',
          mountPath: '/var/run/ui4a/postgres-tls',
          readOnly: true,
        }),
      ]),
    );
    expect(podText).toContain('emptyDir');
    expect(object(podSpec(postgres).securityContext).runAsNonRoot).not.toBe(true);
  });

  it.each([
    ['Deployment', 'web'],
    ['Deployment', 'worker'],
    ['Deployment', 'runner'],
    ['Job', 'migration'],
    ['Job', 'realm-bootstrap'],
  ] as const)(
    'verifies and deterministically combines runtime and Panel trust for %s/%s',
    async (kind, name) => {
      const { resources } = await render();
      const workload = resource(resources, kind, name);
      const trustInit = namedContainer(workload, 'trust-init');
      const initText = JSON.stringify(trustInit);
      const commandText = JSON.stringify([trustInit.command, trustInit.args]);
      const primary = primaryContainer(workload);

      expect(initText).toContain('/var/lib/ui4a/ca/root-ca.crt');
      expect(initText).toContain('/var/run/ui4a/panel-ca/ca.crt');
      expect(commandText.match(/openssl verify/g)).toHaveLength(2);
      expect(initText).toContain('/var/run/ui4a/trust/ca-bundle.crt');
      expect(commandText).toMatch(
        /cat[^]*\/var\/lib\/ui4a\/ca\/root-ca\.crt[^]*\/var\/run\/ui4a\/panel-ca\/ca\.crt[^]*\/var\/run\/ui4a\/trust\/ca-bundle\.crt/,
      );
      expect(environment(primary)).toMatchObject({
        NODE_EXTRA_CA_CERTS: '/var/run/ui4a/trust/ca-bundle.crt',
      });
      expect(mounts(primary)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'combined-trust',
            mountPath: '/var/run/ui4a/trust',
            readOnly: true,
          }),
        ]),
      );
    },
  );

  it('uses external Panel CA and canonical settings ConfigMaps without rendering certificate data', async () => {
    const { resources, evidence } = await render();
    const workloadKinds = new Set(['Deployment', 'Job']);
    const consumers = resources.filter(
      (item) =>
        workloadKinds.has(item.kind) &&
        ['web', 'worker', 'runner', 'migration', 'realm-bootstrap'].includes(item.metadata.name),
    );
    const notesPath = resolve(chartRoot, 'templates/NOTES.txt');
    expect(existsSync(notesPath)).toBe(true);
    const notes = readFileSync(notesPath, 'utf8');

    for (const consumer of consumers) {
      const podText = JSON.stringify(podSpec(consumer));
      expect(podText).toContain('ui4a-panel-ca');
      expect(podText).toContain('ui4a-deployment-settings');
    }
    expect(
      resources.some((item) => item.kind === 'ConfigMap' && item.metadata.name === 'ui4a-panel-ca'),
    ).toBe(false);
    expect(resources.some((item) => item.kind === 'Secret')).toBe(false);
    expect(notes).toContain('ui4a-panel-ca');
    expect(notes).toContain('ui4a-deployment-settings');
    expect(JSON.stringify({ resources, evidence })).not.toMatch(
      /-----BEGIN (?:CERTIFICATE|PRIVATE KEY)-----/,
    );
    expect(JSON.stringify(evidence)).not.toMatch(/pem|certificate|privateKey|secret/i);
  });
});
