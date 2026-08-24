import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const chartRoot = resolve(repositoryRoot, 'deploy/helm/ui4a');
const rendererPath = resolve(chartRoot, 'render.ts');

type KubernetesObject = Record<string, unknown> & {
  kind: string;
  metadata: { name: string };
};

interface RendererModule {
  renderUi4aChart(values: Record<string, unknown>): { resources: KubernetesObject[] };
}

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function values(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    namespace: { create: true, name: 'ui4a-system', istioInjection: true },
    experimental: { highAvailability: false, replicas: 1 },
    scheduling: { nodeSelector: {} },
    network: { hostAliases: [] },
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
      oidcIssuer: 'https://auth.ui4a.internal.test/realms/ui4a',
      oidcAudience: 'ui4a-api',
      jwksUri:
        'http://keycloak.ui4a-system.svc.cluster.local:8080/realms/ui4a/protocol/openid-connect/certs',
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected record');
  }
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('expected list');
  return value;
}

async function resources(): Promise<KubernetesObject[]> {
  const renderer = (await import(pathToFileURL(rendererPath).href)) as RendererModule;
  return renderer.renderUi4aChart(values()).resources;
}

function resource(input: KubernetesObject[], kind: string, name: string): Record<string, unknown> {
  const candidate = input.find((entry) => entry.kind === kind && entry.metadata.name === name);
  if (candidate === undefined) throw new Error(`missing ${kind}/${name}`);
  return candidate;
}

function routeMatches(input: Record<string, unknown>): string[] {
  const http = list(record(input.spec).http).map(record);
  return http
    .filter((entry) => entry.route !== undefined)
    .flatMap((entry) => list(entry.match ?? []).map(record))
    .map((match) => {
      const method = String(record(match.method).exact);
      const uri = record(match.uri);
      const type = uri.exact === undefined ? 'prefix' : 'exact';
      return `${method}:${type}:${String(uri[type])}`;
    })
    .sort();
}

function defaultDeny(input: Record<string, unknown>): Record<string, unknown> {
  const http = list(record(input.spec).http).map(record);
  return http.at(-1) ?? {};
}

function templateDocument(name: string): string {
  const template = readFileSync(resolve(chartRoot, 'templates/istio.yaml'), 'utf8');
  const document = template
    .split(/^---$/m)
    .find((candidate) => new RegExp(`^  name:\\s+${name}$`, 'm').test(candidate));
  if (document === undefined) throw new Error(`missing Helm template document ${name}`);
  return document;
}

function staticRouteMatches(name: string): string[] {
  const document = templateDocument(name);
  const routeIndex = document.indexOf('      route:');
  const routeHead = document.slice(0, routeIndex);
  const matchIndex = routeHead.lastIndexOf('    - match:');
  return [
    ...routeHead
      .slice(matchIndex)
      .matchAll(/method: \{ exact: (GET|POST) \}\s+uri: \{ (exact|prefix): ([^ }]+) \}/g),
  ]
    .map(([, method, kind, path]) => `${method}:${kind}:${path}`)
    .sort();
}

const webGetExact = [
  '/',
  '/canvas',
  '/chat',
  '/delegations',
  '/entity',
  '/events',
  '/meta',
  '/favicon.ico',
  '/file.svg',
  '/globe.svg',
  '/next.svg',
  '/vercel.svg',
  '/window.svg',
  '/live',
  '/version',
  '/api/health',
  '/api/render/catalog',
  '/auth/login',
  '/api/auth/callback',
  '/.well-known/ui4a.json',
  '/api/entity',
  '/_meta/api/entity',
] as const;
const webGetPrefix = ['/meta/', '/_next/'] as const;
const webPostExact = [
  '/auth/logout',
  '/api/exec',
  '/api/exec-plan',
  '/api/chat',
  '/_meta/api/exec',
] as const;

const expectedWebMatches = [
  ...webGetExact.map((path) => `GET:exact:${path}`),
  ...webGetPrefix.map((path) => `GET:prefix:${path}`),
  ...webPostExact.map((path) => `POST:exact:${path}`),
].sort();

const realm = '/realms/ui4a';
const expectedKeycloakMatches = [
  `GET:exact:${realm}/.well-known/openid-configuration`,
  `GET:exact:${realm}/protocol/openid-connect/auth`,
  `GET:exact:${realm}/protocol/openid-connect/certs`,
  `GET:exact:${realm}/protocol/openid-connect/logout`,
  `GET:exact:${realm}/account`,
  `GET:prefix:${realm}/account/`,
  `GET:prefix:${realm}/login-actions/`,
  'GET:prefix:/resources/',
  `POST:exact:${realm}/protocol/openid-connect/token`,
  `POST:exact:${realm}/protocol/openid-connect/revoke`,
  `POST:exact:${realm}/protocol/openid-connect/logout`,
  `POST:exact:${realm}/account`,
  `POST:prefix:${realm}/account/`,
  `POST:prefix:${realm}/login-actions/`,
].sort();

describe('T22 Kubernetes exact authentication edge', () => {
  it('binds the fixed ui4a realm edge to the canonical issuer path', async () => {
    const input = values();
    const istio = record(input.istio);
    istio.oidcIssuer = 'https://auth.ui4a.internal.test/realms/other';
    const renderer = (await import(pathToFileURL(rendererPath).href)) as RendererModule;

    expect(() => renderer.renderUi4aChart(input)).toThrow(/values\.istio\.oidcIssuer/);
    expect(readFileSync(resolve(chartRoot, 'values.schema.json'), 'utf8')).toContain(
      '/realms/ui4a$',
    );
  });

  it('routes only public assets and credential-adjudicated Golden UI4A paths', async () => {
    const web = resource(await resources(), 'VirtualService', 'ui4a-web');
    const serialized = JSON.stringify(web);

    expect(routeMatches(web)).toEqual(expectedWebMatches);
    expect(staticRouteMatches('ui4a-web')).toEqual(expectedWebMatches);
    expect(defaultDeny(web)).toEqual({ directResponse: { status: 404 } });
    for (const deferred of [
      '/_meta/.well-known/ui4a.json',
      '/api/events',
      '/api/chat/history',
      '/api/chat/sessions',
      '/api/delegations',
      '/api/presentation',
      '/api/presentation/sidecar',
      '/api/meta/',
    ]) {
      expect(serialized, deferred).not.toContain(`\"exact\":\"${deferred}\"`);
      expect(serialized, deferred).not.toContain(`\"prefix\":\"${deferred}\"`);
    }
  });

  it('publishes only the fixed Keycloak realm protocol, login, logout and account surface', async () => {
    const keycloak = resource(await resources(), 'VirtualService', 'ui4a-keycloak');
    const serialized = JSON.stringify(keycloak);

    expect(routeMatches(keycloak)).toEqual(expectedKeycloakMatches);
    expect(staticRouteMatches('ui4a-keycloak')).toEqual(expectedKeycloakMatches);
    expect(defaultDeny(keycloak)).toEqual({ directResponse: { status: 404 } });
    expect(JSON.stringify(routeMatches(keycloak))).not.toMatch(
      /\/admin(?:\/|\")|\/realms\/master|\/metrics|\/health/,
    );
    for (const blocked of ['/admin/', '/realms/master/', '/metrics', '/health']) {
      expect(serialized).toContain(blocked);
    }
  });

  it('keeps browser cookies application-adjudicated and internal callbacks Worker-only', async () => {
    const authorization = resource(await resources(), 'AuthorizationPolicy', 'ui4a-web');
    const serialized = JSON.stringify(authorization);

    expect(serialized).not.toContain('requestPrincipals');
    expect(serialized).not.toContain('notPaths');
    for (const path of [...webGetExact, ...webPostExact]) expect(serialized).toContain(path);
    expect(serialized).toContain('/api/internal/capability-callback');
    expect(serialized).toContain('/api/internal/agent-run-callback');
    expect(serialized).toContain('cluster.local/ns/ui4a-system/sa/ui4a-worker');
    expect(serialized).not.toContain('/api/internal/*');
  });

  it('backs the renderer with static Helm default-deny templates and preserved JWT forwarding', () => {
    const template = readFileSync(resolve(chartRoot, 'templates/istio.yaml'), 'utf8');

    expect(template).not.toMatch(/^\s*- route:\s*$/m);
    expect(template).not.toContain('notPaths:');
    expect(template).toContain('forwardOriginalToken: true');
    expect(template).toContain('exact: /api/entity');
    expect(template).toContain('exact: /realms/ui4a/protocol/openid-connect/token');
    expect(template).toContain('exact: /api/internal/capability-callback');
    expect(template.match(/directResponse:\s*\{\s*status:\s*404\s*\}/g)).toHaveLength(4);
  });
});
