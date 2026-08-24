import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = 'deploy/compose/stack-contract.json';
const rendererPath = 'deploy/compose/render-stack.ts';

const coreServices = [
  'postgres',
  'postgres-bootstrap',
  'temporal-schema',
  'temporal',
  'temporal-namespace',
  'temporal-ui',
  'keycloak',
  'realm-bootstrap',
  'migration',
  'web',
  'worker',
  'runner',
  'host-runner',
  'pki-init',
  'edge',
] as const;

const longRunningServices = [
  'postgres',
  'temporal',
  'temporal-ui',
  'keycloak',
  'web',
  'worker',
  'runner',
  'host-runner',
  'edge',
] as const;

const initServices = [
  'postgres-bootstrap',
  'temporal-schema',
  'temporal-namespace',
  'realm-bootstrap',
  'migration',
  'pki-init',
] as const;

const volumeNames = [
  'postgres-data',
  'backup-data',
  'realm-data',
  'experiment-ca',
  'runner-workspaces',
  'runner-artifacts',
] as const;

interface StackContract {
  schemaVersion: 1;
  topology: {
    replicas: 1;
    highAvailability: false;
    keycloak: {
      instances: 1;
      realms: ['ui4a'];
      clients: ['ui4a-web', 'ui4a-agent', 'ui4a-api'];
    };
  };
  references: {
    composeFile: string;
    renderer: string;
    productionConfig: string;
    imageContract: string;
    postgresStateful: string;
    postgresBindings: string;
    postgresBackup: string;
    temporal: string;
    keycloakRealm: string;
    keycloakBootstrap: string;
  };
  services: string[];
  volumes: Array<{ name: string; retainOnOrdinaryDown: boolean }>;
  lifecycle: {
    up: string[];
    down: string[];
    clean: { command: string[]; confirmation: string; removesVolumes: true };
    backupHook: { contractRef: string; command: string[] };
    restoreHook: { isolatedTargetRequired: true; command: string[] };
  };
}

interface ComposeDependency {
  condition: 'service_healthy' | 'service_completed_successfully';
}

interface ComposeService {
  image: string;
  pull_policy: 'missing';
  profiles?: string[];
  restart?: 'no' | 'unless-stopped';
  depends_on?: Record<string, ComposeDependency>;
  healthcheck?: { test: string[]; interval: string; timeout: string; retries: number };
  environment?: Record<string, string>;
  secrets?: Array<string | { source: string; target?: string; mode?: number }>;
  configs?: Array<string | { source: string; target?: string; mode?: number }>;
  volumes?: string[];
  ports?: string[];
  user?: string;
  read_only?: boolean;
  tmpfs?: string[];
  command?: string[];
  networks?: Record<string, { aliases?: string[] }>;
}

interface ComposeStack {
  name: string;
  services: Record<string, ComposeService>;
  volumes: Record<string, Record<string, unknown> | null>;
  configs: Record<string, { file: string }>;
  secrets: Record<string, { file: string }>;
  'x-ui4a-contract': {
    schemaVersion: 1;
    replicas: 1;
    highAvailability: false;
    realmLifecycle: 'import-or-check-and-skip';
  };
}

interface ComposeRenderInput {
  projectName: 'ui4a';
  settingsFile: string;
  secretsFile: string;
  realmFile: string;
  images: Record<
    | 'postgres'
    | 'temporal'
    | 'temporalAdminTools'
    | 'temporalUi'
    | 'keycloak'
    | 'web'
    | 'worker'
    | 'runner'
    | 'edge',
    string
  >;
}

interface ComposeRenderer {
  renderComposeStack(input: ComposeRenderInput): ComposeStack;
}

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing planned T22 Compose artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

function requiredJson<T>(path: string): T {
  return JSON.parse(requiredSource(path)) as T;
}

async function loadRenderer(): Promise<ComposeRenderer> {
  const absolutePath = resolve(repositoryRoot, rendererPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing planned T22 Compose renderer: ${rendererPath}`);
  }
  return import(pathToFileURL(absolutePath).href) as Promise<ComposeRenderer>;
}

const digest = (digit: string): string => `sha256:${digit.repeat(64)}`;

function renderInput(): ComposeRenderInput {
  return {
    projectName: 'ui4a',
    settingsFile: '/srv/ui4a/config/settings.json',
    secretsFile: '/srv/ui4a/secrets/deployment-secrets.json',
    realmFile: 'deploy/keycloak/realm-import.json',
    images: {
      postgres: `nexus.internal/ui4a/postgres@${digest('1')}`,
      temporal: `nexus.internal/ui4a/temporal@${digest('2')}`,
      temporalAdminTools: `nexus.internal/ui4a/temporal-admin-tools@${digest('3')}`,
      temporalUi: `nexus.internal/ui4a/temporal-ui@${digest('4')}`,
      keycloak: `nexus.internal/ui4a/keycloak@${digest('5')}`,
      web: `nexus.internal/ui4a/web@${digest('6')}`,
      worker: `nexus.internal/ui4a/worker@${digest('7')}`,
      runner: `nexus.internal/ui4a/runner@${digest('8')}`,
      edge: `nexus.internal/ui4a/edge@${digest('9')}`,
    },
  };
}

async function renderedStack(): Promise<ComposeStack> {
  const renderer = await loadRenderer();
  return renderer.renderComposeStack(renderInput());
}

function dependency(
  stack: ComposeStack,
  service: string,
  dependencyName: string,
): string | undefined {
  return stack.services[service]?.depends_on?.[dependencyName]?.condition;
}

function publishedContainerPorts(service: ComposeService): number[] {
  return (service.ports ?? []).flatMap((binding) => {
    const withoutProtocol = binding.split('/')[0] ?? '';
    const containerPort = Number(withoutProtocol.split(':').at(-1));
    return Number.isSafeInteger(containerPort) ? [containerPort] : [];
  });
}

describe('T22 Docker Compose all-in-one contract', () => {
  it('declares the experimental single-replica topology and exact service inventory', () => {
    const contract = requiredJson<StackContract>(contractPath);

    expect(contract.schemaVersion).toBe(1);
    expect(contract.topology).toEqual({
      replicas: 1,
      highAvailability: false,
      keycloak: {
        instances: 1,
        realms: ['ui4a'],
        clients: ['ui4a-web', 'ui4a-agent', 'ui4a-api'],
      },
    });
    expect([...contract.services].sort()).toEqual([...coreServices].sort());
  });

  it('reuses canonical settings, OCI, PostgreSQL, Temporal, Keycloak, and backup semantics', () => {
    const contract = requiredJson<StackContract>(contractPath);

    expect(contract.references).toEqual({
      composeFile: 'deploy/compose/compose.yaml',
      renderer: 'deploy/compose/render-stack.ts',
      productionConfig: 'packages/shared/src/production-deployment-config.ts',
      imageContract: 'deploy/oci/image-contract.json',
      postgresStateful: 'deploy/postgres/stateful-contract.json',
      postgresBindings: 'deploy/postgres/deployment-bindings.json',
      postgresBackup: 'deploy/postgres/backup-contract.json',
      temporal: 'deploy/temporal/production-contract.json',
      keycloakRealm: 'deploy/keycloak/realm-import.json',
      keycloakBootstrap: 'deploy/keycloak/realm-bootstrap.ts',
    });
    for (const path of Object.values(contract.references)) requiredSource(path);
  });

  it('renders every core and optional Host Runner service without hidden replicas', async () => {
    const stack = await renderedStack();

    expect(stack.name).toBe('ui4a');
    expect(Object.keys(stack.services).sort()).toEqual([...coreServices].sort());
    expect(stack.services['host-runner']?.profiles).toEqual(['host-runner']);
    expect(stack['x-ui4a-contract']).toEqual({
      schemaVersion: 1,
      replicas: 1,
      highAvailability: false,
      realmLifecycle: 'import-or-check-and-skip',
    });
  });

  it('pins every service image by digest and uses the IfNotPresent-equivalent pull policy', async () => {
    const stack = await renderedStack();

    for (const [name, service] of Object.entries(stack.services)) {
      expect(service.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
      expect(service.image, name).not.toMatch(/:latest(?:@|$)/);
      expect(service.pull_policy, name).toBe('missing');
    }
  });

  it('rejects mutable image tags before rendering an executable stack', async () => {
    const renderer = await loadRenderer();
    const input = renderInput();
    input.images.web = 'nexus.internal/ui4a/web:latest';

    expect(() => renderer.renderComposeStack(input)).toThrow(/image|digest|sha256/i);
  });

  it('renders deterministically for idempotent restart from the same sealed inputs', async () => {
    const renderer = await loadRenderer();
    const input = renderInput();

    expect(renderer.renderComposeStack(input)).toEqual(
      renderer.renderComposeStack(structuredClone(input)),
    );
  });

  it('starts stateful dependencies, schema jobs, realm check, and migration in a safe order', async () => {
    const stack = await renderedStack();

    expect(dependency(stack, 'postgres-bootstrap', 'postgres')).toBe('service_healthy');
    expect(dependency(stack, 'temporal-schema', 'postgres-bootstrap')).toBe(
      'service_completed_successfully',
    );
    expect(dependency(stack, 'temporal', 'temporal-schema')).toBe('service_completed_successfully');
    expect(dependency(stack, 'temporal-namespace', 'temporal')).toBe('service_healthy');
    expect(dependency(stack, 'keycloak', 'postgres-bootstrap')).toBe(
      'service_completed_successfully',
    );
    expect(dependency(stack, 'realm-bootstrap', 'keycloak')).toBe('service_healthy');
    expect(dependency(stack, 'migration', 'postgres-bootstrap')).toBe(
      'service_completed_successfully',
    );
    for (const service of ['web', 'worker']) {
      expect(dependency(stack, service, 'migration')).toBe('service_completed_successfully');
      expect(dependency(stack, service, 'realm-bootstrap')).toBe('service_completed_successfully');
      expect(dependency(stack, service, 'temporal-namespace')).toBe(
        'service_completed_successfully',
      );
    }
  });

  it('gives every long-running dependency a bounded healthcheck and restart policy', async () => {
    const stack = await renderedStack();

    for (const name of longRunningServices) {
      const service = stack.services[name];
      expect(service?.restart, name).toBe('unless-stopped');
      expect(service?.healthcheck?.test.length, name).toBeGreaterThan(0);
      expect(service?.healthcheck?.interval, name).toMatch(/^\d+s$/);
      expect(service?.healthcheck?.timeout, name).toMatch(/^\d+s$/);
      expect(service?.healthcheck?.retries, name).toBeGreaterThan(0);
    }
    for (const name of initServices) expect(stack.services[name]?.restart, name).toBe('no');
  });

  it('mounts canonical settings as config and deployment Secrets as Compose Secrets', async () => {
    const stack = await renderedStack();

    expect(stack.configs['ui4a-deployment-settings']).toEqual({
      file: renderInput().settingsFile,
    });
    expect(stack.secrets['ui4a-deployment-secrets']).toEqual({
      file: renderInput().secretsFile,
    });
    for (const name of ['migration', 'realm-bootstrap', 'web', 'worker', 'runner', 'host-runner']) {
      const service = stack.services[name];
      expect(service?.environment).toMatchObject({
        UI4A_DEPLOYMENT_PROFILE: 'production',
        UI4A_DEPLOYMENT_SETTINGS_FILE: '/run/ui4a/settings.json',
        UI4A_DEPLOYMENT_SECRETS_FILE: '/run/secrets/ui4a-deployment-secrets',
      });
      expect(service?.configs).toContainEqual({
        source: 'ui4a-deployment-settings',
        target: '/run/ui4a/settings.json',
        mode: 0o444,
      });
      expect(service?.secrets).toContainEqual({
        source: 'ui4a-deployment-secrets',
        target: 'ui4a-deployment-secrets',
        mode: 0o400,
      });
    }
  });

  it('does not serialize Secret material or request-selected Runtime overrides', async () => {
    const stackSource = JSON.stringify(await renderedStack());

    for (const forbidden of [
      'correct-horse-battery-staple',
      'LLM_API_KEY=',
      'POSTGRES_PASSWORD=',
      'KEYCLOAK_ADMIN_PASSWORD=',
      'UI4A_RUNTIME_BACKEND=',
      'UI4A_RUNTIME_IMAGE=',
      'UI4A_RUNTIME_CWD=',
      'UI4A_RUNTIME_PROVIDER=',
      'UI4A_RUNTIME_MODEL=',
    ]) {
      expect(stackSource).not.toContain(forbidden);
    }
  });

  it('reuses the bounded realm import-or-check and migration commands without drift repair', async () => {
    const stack = await renderedStack();
    const realmCommand = stack.services['realm-bootstrap']?.command?.join(' ') ?? '';
    const migrationCommand = stack.services.migration?.command?.join(' ') ?? '';

    expect(realmCommand).toMatch(/t22-keycloak-realm-bootstrap.+--apply/);
    expect(realmCommand).not.toMatch(/reconcile|drift|repair/i);
    expect(migrationCommand).toMatch(/t22-migrate/);
    expect(stack.services['host-runner']?.image).toBe(stack.services.runner?.image);
  });

  it('initializes persisted PKI before exposing the rootless local HTTPS edge', async () => {
    const stack = await renderedStack();
    const pki = stack.services['pki-init'];
    const edge = stack.services.edge;

    expect(pki).toMatchObject({
      image: renderInput().images.runner,
      restart: 'no',
      user: '0:0',
      read_only: true,
      command: ['node', 'dist/main.js', 'pki-init'],
    });
    expect(pki?.volumes).toContain('experiment-ca:/var/lib/ui4a/ca');
    expect(pki?.environment).toMatchObject({
      UI4A_PKI_ROOT: '/var/lib/ui4a/ca',
      UI4A_HOST: 'ui4a.mothership.internal',
      KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
    });

    expect(edge).toMatchObject({
      image: renderInput().images.edge,
      restart: 'unless-stopped',
      user: '1000:1000',
      read_only: true,
      ports: ['127.0.0.1:8443:8443'],
    });
    expect(edge?.volumes).toContain('experiment-ca:/var/lib/ui4a/ca:ro');
    expect(dependency(stack, 'edge', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'edge', 'web')).toBe('service_healthy');
    expect(dependency(stack, 'edge', 'keycloak')).toBe('service_healthy');
    expect(dependency(stack, 'web', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'keycloak', 'pki-init')).toBe('service_completed_successfully');
    expect(stack.services.web?.ports ?? []).toEqual([]);
  });

  it('routes both canonical internal hosts over persisted leaf certificates', async () => {
    const stack = await renderedStack();
    const edgeConfig = stack.configs['ui4a-edge-routing'] as
      { file?: string; content?: string } | undefined;
    const routing = edgeConfig?.content ?? '';

    expect(routing).toContain('https://{$UI4A_HOST}:8443');
    expect(routing).toContain('tls /var/lib/ui4a/ca/ui4a/tls.crt /var/lib/ui4a/ca/ui4a/tls.key');
    expect(routing).toContain('reverse_proxy web:3100');
    expect(routing).toContain('https://{$KEYCLOAK_HOST}:8443');
    expect(routing).toContain(
      'tls /var/lib/ui4a/ca/keycloak/tls.crt /var/lib/ui4a/ca/keycloak/tls.key',
    );
    expect(routing).toContain('reverse_proxy keycloak:8080');
    expect(stack.services.edge?.environment).toMatchObject({
      UI4A_HOST: 'ui4a.mothership.internal',
      KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
    });
  });

  it('wires the server-owned Compose Runner identity and HTTPS origin without token material', async () => {
    const stack = await renderedStack();
    const worker = stack.services.worker;
    const runner = stack.services.runner;

    expect(worker?.environment).toMatchObject({
      UI4A_RUNNER_IMAGE: renderInput().images.runner,
      UI4A_HOST_RUNNER_ORIGINS:
        '{"compose-runner":"https://ui4a.mothership.internal:8443"}',
    });
    expect(runner?.environment).toMatchObject({
      UI4A_RUNNER_ID: 'compose-runner',
      UI4A_RUNNER_IMAGE: renderInput().images.runner,
    });
    expect(dependency(stack, 'worker', 'edge')).toBe('service_healthy');
    expect(dependency(stack, 'edge', 'runner')).toBe('service_healthy');
    expect(JSON.stringify({ worker: worker?.environment, runner: runner?.environment })).not.toMatch(
      /Bearer |runner-token|authorization/i,
    );
  });

  it('routes only exact /deliver through the Runner and retains Web as the UI4A fallback', async () => {
    const stack = await renderedStack();
    const routing = (stack.configs['ui4a-edge-routing'] as { content?: string }).content ?? '';
    const delivery = routing.indexOf('handle /deliver');
    const runner = routing.indexOf('reverse_proxy runner:3102');
    const fallback = routing.indexOf('handle {', runner + 1);
    const web = routing.indexOf('reverse_proxy web:3100', fallback);

    expect(delivery).toBeGreaterThan(0);
    expect(runner).toBeGreaterThan(delivery);
    expect(fallback).toBeGreaterThan(runner);
    expect(web).toBeGreaterThan(fallback);
    expect(routing).not.toContain('handle_path /deliver*');
    expect(stack.services.edge?.networks?.default?.aliases).toContain(
      'ui4a.mothership.internal',
    );
  });

  it('records the Compose TLS origin that operator settings must use', () => {
    const contract = requiredJson<StackContract & { runnerDelivery: Record<string, unknown> }>(
      contractPath,
    );

    expect(contract.runnerDelivery).toEqual({
      runnerId: 'compose-runner',
      route: '/deliver',
      workerOrigin: 'https://ui4a.mothership.internal:8443',
      edgeNetworkAlias: 'ui4a.mothership.internal',
      requiredServicePublicOrigin: 'https://ui4a.mothership.internal:8443',
    });
  });

  it('keeps PostgreSQL, Temporal gRPC, and Keycloak database ports internal', async () => {
    const stack = await renderedStack();

    expect(publishedContainerPorts(stack.services.postgres!)).not.toContain(5432);
    expect(publishedContainerPorts(stack.services.temporal!)).not.toContain(7233);
    expect(publishedContainerPorts(stack.services.keycloak!)).not.toContain(5432);
  });

  it('uses read-only, non-root UI4A and one-shot containers with bounded writable paths', async () => {
    const stack = await renderedStack();

    for (const name of ['migration', 'realm-bootstrap', 'web', 'worker', 'runner', 'host-runner']) {
      const service = stack.services[name];
      expect(service?.read_only, name).toBe(true);
      expect(service?.user, name).toMatch(/^(?!0(?::0)?$)\d+(?::\d+)?$/);
      expect(service?.tmpfs, name).toEqual(
        expect.arrayContaining([expect.stringMatching(/^\/tmp:/)]),
      );
    }
  });

  it('declares retained named volumes for data, backups, realm, CA, and Runner evidence', async () => {
    const contract = requiredJson<StackContract>(contractPath);
    const stack = await renderedStack();

    expect(Object.keys(stack.volumes).sort()).toEqual([...volumeNames].sort());
    expect(contract.volumes).toEqual(
      volumeNames.map((name) => ({ name, retainOnOrdinaryDown: true })),
    );
    expect(stack.services.postgres?.volumes).toContain('postgres-data:/var/lib/postgresql/data');
    expect(stack.services['realm-bootstrap']?.volumes).toEqual(
      expect.arrayContaining([
        'realm-data:/var/lib/ui4a/realm',
        'experiment-ca:/var/lib/ui4a/ca:ro',
        `${renderInput().realmFile}:/opt/ui4a/realm-import.json:ro`,
      ]),
    );
    expect(stack.services.runner?.volumes).toEqual(
      expect.arrayContaining(['runner-workspaces:/workspaces', 'runner-artifacts:/artifacts']),
    );
  });

  it('makes ordinary down non-destructive and isolates confirmed volume cleanup', () => {
    const { lifecycle } = requiredJson<StackContract>(contractPath);
    const down = lifecycle.down.join(' ');
    const clean = lifecycle.clean.command.join(' ');

    expect(lifecycle.up).toEqual([
      'docker',
      'compose',
      '-f',
      'deploy/compose/compose.yaml',
      'up',
      '-d',
      '--wait',
    ]);
    expect(down).toMatch(/^docker compose .+ down$/);
    expect(down).not.toMatch(/(?:^|\s)(?:-v|--volumes)(?:\s|$)/);
    expect(clean).toMatch(/(?:^|\s)--volumes(?:\s|$)/);
    expect(lifecycle.clean.confirmation).toBe('DELETE UI4A COMPOSE DATA');
    expect(lifecycle.clean.removesVolumes).toBe(true);
  });

  it('binds backup and isolated restore hooks to the existing direct recovery contracts', () => {
    const { lifecycle } = requiredJson<StackContract>(contractPath);

    expect(lifecycle.backupHook).toMatchObject({
      contractRef: 'deploy/postgres/backup-contract.json',
    });
    expect(lifecycle.backupHook.command.join(' ')).toMatch(/backup.+compose/i);
    expect(lifecycle.restoreHook.isolatedTargetRequired).toBe(true);
    expect(lifecycle.restoreHook.command.join(' ')).toMatch(/restore.+isolated/i);
    expect(lifecycle.restoreHook.command.join(' ')).not.toMatch(/compose-main/i);
  });
});
