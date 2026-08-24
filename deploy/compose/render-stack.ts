export const composeImageKeys = [
  'postgres',
  'temporal',
  'temporalAdminTools',
  'temporalUi',
  'keycloak',
  'web',
  'worker',
  'runner',
  'edge',
] as const;

export type ComposeImageKey = (typeof composeImageKeys)[number];

export interface ComposeRenderInput {
  projectName: 'ui4a';
  settingsFile: string;
  secretsFile: string;
  realmFile: string;
  images: Record<ComposeImageKey, string>;
}

export type ComposeDependencyCondition = 'service_healthy' | 'service_completed_successfully';

export interface ComposeService {
  image: string;
  pull_policy: 'missing';
  profiles?: string[];
  restart: 'no' | 'unless-stopped';
  depends_on?: Record<string, { condition: ComposeDependencyCondition }>;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
  environment?: Record<string, string>;
  secrets?: Array<{ source: string; target: string; mode: number }>;
  configs?: Array<{ source: string; target: string; mode: number }>;
  volumes?: string[];
  ports?: string[];
  user?: string;
  read_only?: boolean;
  tmpfs?: string[];
  command?: string[];
}

export interface ComposeStack {
  name: 'ui4a';
  services: Record<string, ComposeService>;
  volumes: Record<string, { labels: Record<string, string> }>;
  configs: Record<string, { file: string } | { content: string }>;
  secrets: Record<string, { file: string }>;
  'x-ui4a-contract': {
    schemaVersion: 1;
    replicas: 1;
    highAvailability: false;
    realmLifecycle: 'import-or-check-and-skip';
  };
}

const digestImagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._/:~-]*@sha256:[0-9a-f]{64}$/;
const canonicalRuntimeEnvironment = Object.freeze({
  UI4A_DEPLOYMENT_PROFILE: 'production',
  UI4A_DEPLOYMENT_SETTINGS_FILE: '/run/ui4a/settings.json',
  UI4A_DEPLOYMENT_SECRETS_FILE: '/run/secrets/ui4a-deployment-secrets',
});
const canonicalConfigMount = Object.freeze({
  source: 'ui4a-deployment-settings',
  target: '/run/ui4a/settings.json',
  mode: 0o444,
});
const canonicalSecretMount = Object.freeze({
  source: 'ui4a-deployment-secrets',
  target: 'ui4a-deployment-secrets',
  mode: 0o400,
});
const runtimeTmpfs = '/tmp:rw,noexec,nosuid,size=64m';
const edgeRouting = `{
  auto_https off
  admin off
}

https://{$UI4A_HOST}:8443 {
  tls /var/lib/ui4a/ca/ui4a/tls.crt /var/lib/ui4a/ca/ui4a/tls.key
  reverse_proxy web:3100
}

https://{$KEYCLOAK_HOST}:8443 {
  tls /var/lib/ui4a/ca/keycloak/tls.crt /var/lib/ui4a/ca/keycloak/tls.key
  reverse_proxy keycloak:8080
}

https://127.0.0.1:8443 {
  tls /var/lib/ui4a/ca/ui4a/tls.crt /var/lib/ui4a/ca/ui4a/tls.key
  respond /_edge_live 200
}
`;

function fail(message: string): never {
  throw new TypeError(`Invalid T22 Compose input: ${message}`);
}

function assertExactKeys(
  input: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(input).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label} must contain exactly ${canonical.join(', ')}`);
  }
}

function assertPath(value: unknown, label: string, absolute: boolean): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value === '' ||
    value.includes('\0') ||
    (absolute && !value.startsWith('/'))
  ) {
    fail(`${label} must be a ${absolute ? 'non-empty absolute' : 'non-empty'} path`);
  }
}

function validateInput(input: ComposeRenderInput): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('input must be an object');
  }
  assertExactKeys(
    input as unknown as Record<string, unknown>,
    ['projectName', 'settingsFile', 'secretsFile', 'realmFile', 'images'],
    'input',
  );
  if (input.projectName !== 'ui4a') fail('projectName must be ui4a');
  assertPath(input.settingsFile, 'settingsFile', true);
  assertPath(input.secretsFile, 'secretsFile', true);
  assertPath(input.realmFile, 'realmFile', false);
  if (input.realmFile !== 'deploy/keycloak/realm-import.json') {
    fail('realmFile must reuse deploy/keycloak/realm-import.json');
  }
  if (typeof input.images !== 'object' || input.images === null || Array.isArray(input.images)) {
    fail('images must be an object');
  }
  assertExactKeys(input.images as unknown as Record<string, unknown>, composeImageKeys, 'images');
  for (const key of composeImageKeys) {
    if (!digestImagePattern.test(input.images[key])) {
      fail(`images.${key} must be pinned by sha256 digest`);
    }
  }
}

function health(test: string[]): NonNullable<ComposeService['healthcheck']> {
  return { test: [...test], interval: '10s', timeout: '3s', retries: 12 };
}

function dependencies(
  input: Record<string, ComposeDependencyCondition>,
): Record<string, { condition: ComposeDependencyCondition }> {
  return Object.fromEntries(
    Object.entries(input).map(([name, condition]) => [name, { condition }]),
  );
}

function runtimeService(
  image: string,
  restart: ComposeService['restart'],
  overrides: Partial<ComposeService> = {},
): ComposeService {
  return {
    image,
    pull_policy: 'missing',
    restart,
    user: '1000:1000',
    read_only: true,
    tmpfs: [runtimeTmpfs],
    environment: { ...canonicalRuntimeEnvironment },
    configs: [{ ...canonicalConfigMount }],
    secrets: [{ ...canonicalSecretMount }],
    ...overrides,
  };
}

function retainedVolume(name: string): { labels: Record<string, string> } {
  return {
    labels: {
      'io.ui4a.volume': name,
      'io.ui4a.retention': 'retain-on-ordinary-down',
    },
  };
}

/**
 * Render the deterministic Compose object shared by the static artifact generator and contract
 * tests. It accepts paths and immutable image identities only; Secret material is never an input.
 */
export function renderComposeStack(input: ComposeRenderInput): ComposeStack {
  validateInput(input);
  const { images } = input;

  return {
    name: 'ui4a',
    services: {
      postgres: {
        image: images.postgres,
        pull_policy: 'missing',
        restart: 'unless-stopped',
        healthcheck: health(['CMD-SHELL', 'pg_isready -U postgres -d postgres']),
        volumes: ['postgres-data:/var/lib/postgresql/data', 'backup-data:/backups'],
      },
      'postgres-bootstrap': {
        image: images.postgres,
        pull_policy: 'missing',
        restart: 'no',
        depends_on: dependencies({ postgres: 'service_healthy' }),
        command: ['psql', '-v', 'ON_ERROR_STOP=1', '-f', '/opt/ui4a/bootstrap-roles.sql'],
        volumes: ['../postgres/bootstrap-roles.sql:/opt/ui4a/bootstrap-roles.sql:ro'],
      },
      'temporal-schema': {
        image: images.temporalAdminTools,
        pull_policy: 'missing',
        restart: 'no',
        depends_on: dependencies({ 'postgres-bootstrap': 'service_completed_successfully' }),
        command: ['temporal-sql-tool', 'setup-and-update-schema'],
      },
      temporal: {
        image: images.temporal,
        pull_policy: 'missing',
        restart: 'unless-stopped',
        depends_on: dependencies({ 'temporal-schema': 'service_completed_successfully' }),
        healthcheck: health(['CMD', 'temporal', 'operator', 'cluster', 'health']),
      },
      'temporal-namespace': {
        image: images.temporalAdminTools,
        pull_policy: 'missing',
        restart: 'no',
        depends_on: dependencies({ temporal: 'service_healthy' }),
        command: ['temporal', 'operator', 'namespace', 'create-or-check', 'ui4a'],
      },
      'temporal-ui': {
        image: images.temporalUi,
        pull_policy: 'missing',
        restart: 'unless-stopped',
        depends_on: dependencies({ temporal: 'service_healthy' }),
        healthcheck: health(['CMD', 'wget', '-q', '--spider', 'http://127.0.0.1:8080/']),
      },
      keycloak: {
        image: images.keycloak,
        pull_policy: 'missing',
        restart: 'unless-stopped',
        depends_on: dependencies({
          'postgres-bootstrap': 'service_completed_successfully',
          'pki-init': 'service_completed_successfully',
        }),
        healthcheck: health([
          'CMD-SHELL',
          "exec 3<>/dev/tcp/127.0.0.1/9000; printf 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3; grep -q '200 OK' <&3",
        ]),
      },
      'realm-bootstrap': runtimeService(images.worker, 'no', {
        depends_on: dependencies({ keycloak: 'service_healthy' }),
        command: ['node', 'dist/t22-keycloak-realm-bootstrap.js', '--apply'],
        volumes: [
          'realm-data:/var/lib/ui4a/realm',
          'experiment-ca:/var/lib/ui4a/ca:ro',
          `${input.realmFile}:/opt/ui4a/realm-import.json:ro`,
        ],
      }),
      migration: runtimeService(images.worker, 'no', {
        depends_on: dependencies({ 'postgres-bootstrap': 'service_completed_successfully' }),
        command: ['node', 'dist/t22-migrate.js'],
      }),
      'pki-init': runtimeService(images.runner, 'no', {
        user: '0:0',
        environment: {
          ...canonicalRuntimeEnvironment,
          UI4A_PKI_ROOT: '/var/lib/ui4a/ca',
          UI4A_HOST: 'ui4a.mothership.internal',
          KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
        },
        command: ['node', 'dist/main.js', 'pki-init'],
        volumes: ['experiment-ca:/var/lib/ui4a/ca'],
      }),
      web: runtimeService(images.web, 'unless-stopped', {
        depends_on: dependencies({
          'pki-init': 'service_completed_successfully',
          migration: 'service_completed_successfully',
          'realm-bootstrap': 'service_completed_successfully',
          'temporal-namespace': 'service_completed_successfully',
        }),
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3100/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        volumes: ['experiment-ca:/var/lib/ui4a/ca:ro'],
      }),
      worker: runtimeService(images.worker, 'unless-stopped', {
        depends_on: dependencies({
          migration: 'service_completed_successfully',
          'realm-bootstrap': 'service_completed_successfully',
          'temporal-namespace': 'service_completed_successfully',
        }),
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3101/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        volumes: ['experiment-ca:/var/lib/ui4a/ca:ro'],
      }),
      runner: runtimeService(images.runner, 'unless-stopped', {
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3102/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        command: ['node', 'dist/main.js', 'daemon'],
        volumes: ['runner-workspaces:/workspaces', 'runner-artifacts:/artifacts'],
      }),
      'host-runner': runtimeService(images.runner, 'unless-stopped', {
        profiles: ['host-runner'],
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3102/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        command: ['node', 'dist/main.js', 'daemon'],
        volumes: ['runner-workspaces:/workspaces', 'runner-artifacts:/artifacts'],
      }),
      edge: {
        image: images.edge,
        pull_policy: 'missing',
        restart: 'unless-stopped',
        user: '1000:1000',
        read_only: true,
        tmpfs: [runtimeTmpfs],
        depends_on: dependencies({
          'pki-init': 'service_completed_successfully',
          web: 'service_healthy',
          keycloak: 'service_healthy',
        }),
        healthcheck: health([
          'CMD',
          'wget',
          '-q',
          '--no-check-certificate',
          '--spider',
          'https://127.0.0.1:8443/_edge_live',
        ]),
        environment: {
          UI4A_HOST: 'ui4a.mothership.internal',
          KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
          HOME: '/tmp',
          XDG_CONFIG_HOME: '/tmp/caddy-config',
          XDG_DATA_HOME: '/tmp/caddy-data',
        },
        configs: [
          {
            source: 'ui4a-edge-routing',
            target: '/etc/caddy/Caddyfile',
            mode: 0o444,
          },
        ],
        volumes: ['experiment-ca:/var/lib/ui4a/ca:ro'],
        ports: ['127.0.0.1:8443:8443'],
        command: ['caddy', 'run', '--config', '/etc/caddy/Caddyfile'],
      },
    },
    volumes: Object.fromEntries(
      [
        'postgres-data',
        'backup-data',
        'realm-data',
        'experiment-ca',
        'runner-workspaces',
        'runner-artifacts',
      ].map((name) => [name, retainedVolume(name)]),
    ),
    configs: {
      'ui4a-deployment-settings': { file: input.settingsFile },
      'ui4a-edge-routing': { content: edgeRouting },
    },
    secrets: {
      'ui4a-deployment-secrets': { file: input.secretsFile },
    },
    'x-ui4a-contract': {
      schemaVersion: 1,
      replicas: 1,
      highAvailability: false,
      realmLifecycle: 'import-or-check-and-skip',
    },
  };
}
