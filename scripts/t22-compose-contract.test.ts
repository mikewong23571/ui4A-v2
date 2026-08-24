import { execFileSync } from 'node:child_process';
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
  'config-init',
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
  'config-init',
] as const;

const volumeNames = [
  'postgres-data',
  'backup-data',
  'realm-data',
  'experiment-ca',
  'runner-workspaces',
  'runner-artifacts',
  'runtime-config',
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
    operatorInputs: string;
    storyAcceptance: string;
  };
  services: string[];
  volumes: Array<{ name: string; retainOnOrdinaryDown: boolean }>;
  lifecycle: {
    up: string[];
    down: string[];
    clean: { command: string[]; confirmation: string; removesVolumes: true };
    backupHook: { contractRef: string; command: string[]; privateArtifacts: string[] };
    restoreHook: { isolatedTargetRequired: true; command: string[] };
  };
  dualRuntime: {
    fallback: false;
    container: {
      service: 'runner';
      runnerId: 'compose-container-runner';
      tokenRef: 'compose-container-runner-token';
      origin: 'https://ui4a.mothership.internal:8443';
      route: '/deliver';
    };
    host: {
      service: 'host-runner';
      profile: 'host-runner';
      runnerId: 'compose-host-runner';
      tokenRef: 'compose-host-runner-token';
      origin: 'https://ui4a.mothership.internal:9444';
      route: '/deliver';
    };
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

function renderedConfigSource(stack: ComposeStack, name: string): string {
  const file = stack.configs[name]?.file;
  if (file === undefined) throw new Error(`Compose config ${name} must be file-backed`);
  return requiredSource(file);
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
      operatorInputs: 'scripts/t22-compose-inputs.ts',
      storyAcceptance: 'deploy/compose/acceptance-contract.json',
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
    expect(dependency(stack, 'realm-bootstrap', 'edge')).toBe('service_healthy');
    expect(dependency(stack, 'edge', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'edge', 'web')).toBeUndefined();
    expect(dependency(stack, 'edge', 'keycloak')).toBeUndefined();
    expect(dependency(stack, 'edge', 'runner')).toBeUndefined();
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

  it('uses dependency-aware readiness for Web and Worker without conflating process liveness', async () => {
    const stack = await renderedStack();

    for (const name of ['web', 'worker'] as const) {
      const probe = stack.services[name]?.healthcheck?.test.join(' ') ?? '';
      expect(probe, name).toContain(`/ready`);
      expect(probe, name).not.toContain(`/live`);
    }
    // Runner readiness remains owned by its deployment audit and is intentionally unchanged here.
    expect(stack.services.runner?.healthcheck?.test.join(' ')).toContain('/live');
  });

  it('mounts canonical sources only into root copy-init and PKI bootstrap', async () => {
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
        UI4A_DEPLOYMENT_SETTINGS_FILE: '/var/run/ui4a/runtime-config/settings.json',
        UI4A_DEPLOYMENT_SECRETS_FILE: '/var/run/ui4a/runtime-config/deployment-secrets.json',
      });
      expect(service?.configs ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'ui4a-deployment-settings' }),
      );
      expect(service?.secrets ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'ui4a-deployment-secrets' }),
      );
    }
    for (const name of ['config-init', 'pki-init']) {
      expect(stack.services[name]?.configs).toContainEqual({
        source: 'ui4a-deployment-settings',
        target: '/run/ui4a/settings.json',
        mode: 0o400,
      });
      expect(stack.services[name]?.secrets).toContainEqual({
        source: 'ui4a-deployment-secrets',
        target: 'ui4a-deployment-secrets',
        mode: 0o400,
      });
    }
  });

  it('mounts one callback credential file only into Web and Worker startup', async () => {
    const stack = await renderedStack();

    expect(stack.secrets['capability-callback-token']).toEqual({
      file: '/srv/ui4a/secrets/capability-callback-token',
    });
    for (const name of ['web', 'worker']) {
      expect(stack.services[name]?.environment).toMatchObject({
        UI4A_CAPABILITY_CALLBACK_TOKEN_FILE:
          '/var/run/ui4a/runtime-config/capability-callback-token',
      });
      expect(stack.services[name]?.secrets ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'capability-callback-token' }),
      );
    }
    for (const name of ['migration', 'realm-bootstrap', 'runner', 'host-runner']) {
      expect(stack.services[name]?.environment).not.toHaveProperty(
        'UI4A_CAPABILITY_CALLBACK_TOKEN_FILE',
      );
      expect(stack.services[name]?.secrets ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'capability-callback-token' }),
      );
    }
    expect(stack.services['config-init']?.secrets).toContainEqual({
      source: 'capability-callback-token',
      target: 'capability-callback-token',
      mode: 0o400,
    });
    expect(JSON.stringify(stack)).not.toContain('__private_callback_material__');
  });

  it('hands rootless bind-backed inputs to every Node consumer without widening source modes', async () => {
    const stack = await renderedStack();
    const init = stack.services['config-init'];
    const consumers = ['migration', 'realm-bootstrap', 'web', 'worker', 'runner', 'host-runner'];
    const runtimeRoot = '/var/run/ui4a/runtime-config';

    expect(init).toMatchObject({
      image: renderInput().images.worker,
      user: '0:0',
      restart: 'no',
      read_only: true,
      command: ['node', '/opt/ui4a/config-init.mjs'],
    });
    expect(init?.configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'ui4a-config-init',
          target: '/opt/ui4a/config-init.mjs',
        }),
        expect.objectContaining({ source: 'ui4a-deployment-settings' }),
      ]),
    );
    expect(init?.secrets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'ui4a-deployment-secrets' }),
        expect.objectContaining({ source: 'capability-callback-token' }),
      ]),
    );
    expect(init?.volumes).toContain(`runtime-config:${runtimeRoot}`);
    expect(stack.configs['ui4a-config-init']).toEqual({ file: 'deploy/compose/config-init.mjs' });

    for (const name of consumers) {
      const service = stack.services[name];
      expect(service?.user, name).toBe('1000:1000');
      expect(dependency(stack, name, 'config-init'), name).toBe('service_completed_successfully');
      expect(service?.environment, name).toMatchObject({
        UI4A_DEPLOYMENT_SETTINGS_FILE: `${runtimeRoot}/settings.json`,
        UI4A_DEPLOYMENT_SECRETS_FILE: `${runtimeRoot}/deployment-secrets.json`,
      });
      expect(service?.volumes, name).toContain(`runtime-config:${runtimeRoot}:ro`);
      expect(service?.configs ?? [], name).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ source: 'ui4a-deployment-settings' })]),
      );
      expect(service?.secrets ?? [], name).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ source: 'ui4a-deployment-secrets' })]),
      );
    }
    for (const name of ['web', 'worker']) {
      expect(stack.services[name]?.environment).toMatchObject({
        UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: `${runtimeRoot}/capability-callback-token`,
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
    expect(dependency(stack, 'edge', 'web')).toBeUndefined();
    expect(dependency(stack, 'edge', 'keycloak')).toBeUndefined();
    expect(dependency(stack, 'web', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'keycloak', 'pki-init')).toBe('service_completed_successfully');
    expect(stack.services.web?.ports ?? []).toEqual([]);
  });

  it('routes both canonical internal hosts over persisted leaf certificates', async () => {
    const stack = await renderedStack();
    const routing = renderedConfigSource(stack, 'ui4a-edge-routing');

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
        '{"compose-container-runner":"https://ui4a.mothership.internal:8443","compose-host-runner":"https://ui4a.mothership.internal:9444"}',
      NODE_EXTRA_CA_CERTS: '/var/lib/ui4a/ca/root-ca.crt',
    });
    expect(runner?.environment).toMatchObject({
      UI4A_RUNNER_ID: 'compose-container-runner',
      UI4A_RUNNER_IMAGE: renderInput().images.runner,
    });
    for (const serviceName of ['worker', 'runner', 'realm-bootstrap', 'migration']) {
      const service = stack.services[serviceName];
      expect(service?.environment?.NODE_EXTRA_CA_CERTS, serviceName).toBe(
        '/var/lib/ui4a/ca/root-ca.crt',
      );
      expect(service?.volumes, serviceName).toContain('experiment-ca:/var/lib/ui4a/ca:ro');
    }
    expect(dependency(stack, 'runner', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'migration', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'worker', 'edge')).toBe('service_healthy');
    expect(dependency(stack, 'edge', 'runner')).toBeUndefined();
    expect(
      JSON.stringify({ worker: worker?.environment, runner: runner?.environment }),
    ).not.toMatch(/Bearer |runner-token|authorization/i);
  });

  it('wires independent container and Host Runner identities, origins, and token refs without fallback', async () => {
    const contract = requiredJson<StackContract>(contractPath);
    const stack = await renderedStack();
    const worker = stack.services.worker;
    const containerRunner = stack.services.runner;
    const hostRunner = stack.services['host-runner'];
    const routing = renderedConfigSource(stack, 'ui4a-edge-routing');

    expect(contract.dualRuntime).toEqual({
      fallback: false,
      container: {
        service: 'runner',
        runnerId: 'compose-container-runner',
        tokenRef: 'compose-container-runner-token',
        origin: 'https://ui4a.mothership.internal:8443',
        route: '/deliver',
      },
      host: {
        service: 'host-runner',
        profile: 'host-runner',
        runnerId: 'compose-host-runner',
        tokenRef: 'compose-host-runner-token',
        origin: 'https://ui4a.mothership.internal:9444',
        route: '/deliver',
      },
    });
    expect(containerRunner?.environment).toMatchObject({
      UI4A_RUNNER_ID: contract.dualRuntime.container.runnerId,
    });
    expect(hostRunner?.environment).toMatchObject({
      UI4A_RUNNER_ID: contract.dualRuntime.host.runnerId,
    });
    expect(hostRunner?.profiles).toEqual([contract.dualRuntime.host.profile]);
    expect(JSON.parse(worker?.environment?.UI4A_HOST_RUNNER_ORIGINS ?? '{}')).toEqual({
      [contract.dualRuntime.container.runnerId]: contract.dualRuntime.container.origin,
      [contract.dualRuntime.host.runnerId]: contract.dualRuntime.host.origin,
    });
    expect(routing).toMatch(
      /https:\/\/\{\$UI4A_HOST\}:8443[\s\S]+handle \/deliver[\s\S]+reverse_proxy runner:3102/,
    );
    expect(routing).toMatch(
      /https:\/\/\{\$UI4A_HOST\}:9444[\s\S]+handle \/deliver[\s\S]+reverse_proxy host-runner:3102/,
    );
    expect(stack.services.edge?.ports).toEqual(['127.0.0.1:8443:8443']);
    expect(JSON.stringify({ worker, containerRunner, hostRunner })).not.toMatch(
      /FALLBACK|compose-(?:container|host)-runner-token/i,
    );
  });

  it('routes only the declared UI4A surface and rejects internal or deferred routes by default', async () => {
    const stack = await renderedStack();
    const routing = renderedConfigSource(stack, 'ui4a-edge-routing');
    const delivery = routing.indexOf('handle /deliver');
    const runner = routing.indexOf('reverse_proxy runner:3102');

    expect(delivery).toBeGreaterThan(0);
    expect(runner).toBeGreaterThan(delivery);
    expect(routing).not.toContain('handle_path /deliver*');
    expect(routing).toContain('@ui4aPublic');
    expect(routing).toContain('@ui4aAuthenticated');
    for (const path of [
      '/.well-known/ui4a.json',
      '/api/entity',
      '/api/exec',
      '/api/exec-plan',
      '/api/chat',
      '/_meta/api/entity',
      '/_meta/api/exec',
    ]) {
      expect(routing, path).toContain(path);
    }
    for (const path of [
      '/api/internal/',
      '/api/events',
      '/api/chat/history',
      '/api/chat/sessions',
      '/api/delegations',
      '/api/presentation',
      '/api/meta/',
      '/_meta/.well-known/ui4a.json',
    ]) {
      expect(routing, path).not.toContain(path);
    }
    expect(routing).not.toMatch(/handle\s*\{\s*reverse_proxy web:3100/s);
    expect(routing).toMatch(/handle\s*\{\s*respond 404\s*\}/s);
    expect(stack.services.edge?.networks?.default?.aliases).toEqual([
      'ui4a.mothership.internal',
      'auth.ui4a.mothership.internal',
    ]);
  });

  it('keeps Keycloak Admin bootstrap on an un-published internal TLS listener', async () => {
    const stack = await renderedStack();
    const routing = renderedConfigSource(stack, 'ui4a-edge-routing');
    const realmBootstrap = stack.services['realm-bootstrap'];
    const publicListener = routing.indexOf('https://{$KEYCLOAK_HOST}:8443');
    const internalListener = routing.indexOf('https://{$KEYCLOAK_HOST}:9443');
    const publicRouting = routing.slice(publicListener, internalListener);

    expect(realmBootstrap?.environment).toMatchObject({
      UI4A_KEYCLOAK_ADMIN_ORIGIN: 'https://auth.ui4a.mothership.internal:9443',
    });
    expect(publicListener).toBeGreaterThan(0);
    expect(internalListener).toBeGreaterThan(publicListener);
    expect(publicRouting).toContain('/realms/ui4a/protocol/openid-connect/token');
    expect(publicRouting).not.toContain('/realms/master/');
    expect(publicRouting).not.toContain('/admin/');
    expect(routing.slice(internalListener)).toContain(
      '/realms/master/protocol/openid-connect/token',
    );
    expect(routing.slice(internalListener)).toContain('/admin/realms*');
    expect(stack.services.edge?.ports).toEqual(['127.0.0.1:8443:8443']);
    expect(stack.services.edge?.ports?.join(' ')).not.toContain('9443');
  });

  it('records the Compose TLS origin that operator settings must use', () => {
    const contract = requiredJson<StackContract & { runnerDelivery: Record<string, unknown> }>(
      contractPath,
    );

    expect(contract.runnerDelivery).toEqual({
      runnerId: 'compose-container-runner',
      route: '/deliver',
      workerOrigin: 'https://ui4a.mothership.internal:8443',
      edgeNetworkAlias: 'ui4a.mothership.internal',
      requiredServicePublicOrigin: 'https://ui4a.mothership.internal:8443',
    });
  });

  it('keeps the static Compose projection equivalent for Runner delivery wiring', () => {
    const compose = requiredSource('deploy/compose/compose.yaml');
    const routing = requiredSource('deploy/compose/edge-routing.caddy');

    expect(compose).toContain('UI4A_RUNNER_ID: compose-container-runner');
    expect(compose).toContain('UI4A_RUNNER_ID: compose-host-runner');
    expect(compose).toContain('UI4A_HOST_RUNNER_ORIGINS:');
    expect(compose).toContain('NODE_EXTRA_CA_CERTS: /var/lib/ui4a/ca/root-ca.crt');
    expect(compose).toContain('file: ./edge-routing.caddy');
    expect(routing).toContain('handle /deliver {');
    expect(routing).toContain('reverse_proxy runner:3102');
    expect(compose).toContain('- ${UI4A_HOST:-ui4a.mothership.internal}');
    expect(compose).toContain('- ${KEYCLOAK_HOST:-auth.ui4a.mothership.internal}');
    expect(compose).toContain('UI4A_KEYCLOAK_ADMIN_ORIGIN:');
    expect(compose).not.toMatch(/fetch\('http:\/\/127\.0\.0\.1:310[01]\/live'/);
    expect(compose).not.toMatch(/Bearer |runner-token|authorization/i);
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

  it('renders each writable tmpfs as one absolute daemon mount specification', async () => {
    const expected = ['/tmp:rw,noexec,nosuid,size=64m'];
    const runtimeServices = [
      'migration',
      'realm-bootstrap',
      'pki-init',
      'web',
      'worker',
      'runner',
      'host-runner',
      'edge',
    ];
    const rendered = await renderedStack();
    for (const name of runtimeServices) {
      expect(rendered.services[name]?.tmpfs, `renderer:${name}`).toEqual(expected);
    }

    const staticConfig = JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          'ui4a',
          '-f',
          'deploy/compose/compose.yaml',
          '--profile',
          'host-runner',
          'config',
          '--format',
          'json',
        ],
        { encoding: 'utf8' },
      ),
    ) as ComposeStack;
    for (const name of runtimeServices) {
      const tmpfs = staticConfig.services[name]?.tmpfs ?? [];
      expect(tmpfs, `daemon:${name}`).toEqual(expected);
      expect(tmpfs.every((mount) => mount.startsWith('/'))).toBe(true);
    }
    expect(staticConfig.services.postgres?.tmpfs).toEqual([
      '/var/run/ui4a/postgres-tls:rw,noexec,nosuid,size=1m,mode=0700',
    ]);
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
      privateArtifacts: ['runtime-config'],
    });
    expect(lifecycle.backupHook.command.join(' ')).toMatch(/backup.+compose/i);
    expect(lifecycle.restoreHook.isolatedTargetRequired).toBe(true);
    expect(lifecycle.restoreHook.command.join(' ')).toMatch(/restore.+isolated/i);
    expect(lifecycle.restoreHook.command.join(' ')).not.toMatch(/compose-main/i);
  });
});
