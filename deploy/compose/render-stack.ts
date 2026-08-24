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
  networks?: Record<string, { aliases?: string[] }>;
  user?: string;
  read_only?: boolean;
  tmpfs?: string[];
  entrypoint?: string[];
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
  NODE_EXTRA_CA_CERTS: '/var/lib/ui4a/ca/root-ca.crt',
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
const stateSecretNames = [
  'postgres-bootstrap-password',
  'ui4a-migration-password',
  'ui4a-runtime-password',
  'keycloak-database-password',
  'keycloak-bootstrap-admin-password',
  'temporal-schema-password',
  'temporal-runtime-password',
  'postgres-backup-password',
  'capability-callback-token',
] as const;

function stateSecretMount(name: (typeof stateSecretNames)[number]) {
  return { source: name, target: name, mode: 0o400 };
}

function siblingSecretFile(deploymentSecretsFile: string, name: string): string {
  const separator = deploymentSecretsFile.lastIndexOf('/');
  return `${deploymentSecretsFile.slice(0, separator + 1)}${name}`;
}

const postgresBootstrapCommand = [
  'export PGPASSWORD="$$(cat /run/secrets/postgres-bootstrap-password)";',
  'exec psql -v ON_ERROR_STOP=1',
  '-v ui4a_migration_password="$$(cat /run/secrets/ui4a-migration-password)"',
  '-v ui4a_runtime_password="$$(cat /run/secrets/ui4a-runtime-password)"',
  '-v keycloak_runtime_password="$$(cat /run/secrets/keycloak-database-password)"',
  '-v temporal_schema_password="$$(cat /run/secrets/temporal-schema-password)"',
  '-v temporal_runtime_password="$$(cat /run/secrets/temporal-runtime-password)"',
  '-v postgres_backup_password="$$(cat /run/secrets/postgres-backup-password)"',
  '-f /opt/ui4a/bootstrap-roles.sql',
].join(' ');

const temporalSchemaCommand = [
  'TEMPORAL_SCHEMA_PASSWORD="$$(cat /run/secrets/temporal-schema-password)";',
  'temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal setup-schema -v 0.0 &&',
  'temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned &&',
  'temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility setup-schema -v 0.0 &&',
  'exec temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned',
].join(' ');

const temporalServerCommand =
  'exec temporal-server --root /etc/temporal --config config --env docker start';
const temporalNamespaceCommand =
  'temporal operator namespace describe --namespace ui4a --address temporal:7233 >/dev/null 2>&1 || exec temporal operator namespace create --namespace ui4a --address temporal:7233 --retention 72h';
const postgresTlsCommand = [
  'set -eu;',
  'mkdir -p /var/run/ui4a/postgres-tls;',
  'cp /var/lib/ui4a/ca/postgres/server.crt /var/run/ui4a/postgres-tls/server.crt;',
  'cp /var/lib/ui4a/ca/postgres/server.key /var/run/ui4a/postgres-tls/server.key;',
  'chown postgres:postgres /var/run/ui4a/postgres-tls /var/run/ui4a/postgres-tls/server.crt /var/run/ui4a/postgres-tls/server.key;',
  'chmod 0700 /var/run/ui4a/postgres-tls;',
  'chmod 0644 /var/run/ui4a/postgres-tls/server.crt;',
  'chmod 0600 /var/run/ui4a/postgres-tls/server.key;',
  'exec docker-entrypoint.sh postgres',
  '-c ssl=on',
  '-c ssl_cert_file=/var/run/ui4a/postgres-tls/server.crt',
  '-c ssl_key_file=/var/run/ui4a/postgres-tls/server.key',
  '-c ssl_ca_file=/var/lib/ui4a/ca/root-ca.crt',
].join(' ');
const edgeRouting = `{
  auto_https off
  admin off
}

https://{$UI4A_HOST}:8443 {
  tls /var/lib/ui4a/ca/ui4a/tls.crt /var/lib/ui4a/ca/ui4a/tls.key
  handle /deliver {
    reverse_proxy runner:3102
  }

  @ui4aPublic {
    method GET HEAD
    path / /canvas /chat /delegations /entity /events /meta /meta/* /_next/* /favicon.ico /file.svg /globe.svg /next.svg /vercel.svg /window.svg /live /version /api/health /api/render/catalog /auth/login /api/auth/callback
  }
  handle @ui4aPublic {
    reverse_proxy web:3100
  }

  @ui4aPublicWrite {
    method POST
    path /auth/logout
  }
  handle @ui4aPublicWrite {
    reverse_proxy web:3100
  }

  @ui4aAuthenticatedRead {
    method GET HEAD
    path /.well-known/ui4a.json /api/entity /_meta/api/entity
  }
  handle @ui4aAuthenticatedRead {
    reverse_proxy web:3100
  }

  @ui4aAuthenticatedWrite {
    method POST
    path /api/exec /api/exec-plan /api/chat /_meta/api/exec
  }
  handle @ui4aAuthenticatedWrite {
    reverse_proxy web:3100
  }

  handle {
    respond 404
  }
}

https://{$UI4A_HOST}:9444 {
  tls /var/lib/ui4a/ca/ui4a/tls.crt /var/lib/ui4a/ca/ui4a/tls.key
  handle /deliver {
    reverse_proxy host-runner:3102
  }
  handle {
    respond 404
  }
}

https://{$KEYCLOAK_HOST}:8443 {
  tls /var/lib/ui4a/ca/keycloak/tls.crt /var/lib/ui4a/ca/keycloak/tls.key

  @keycloakProtocolRead {
    method GET HEAD
    path /realms/ui4a/protocol/openid-connect/auth /realms/ui4a/protocol/openid-connect/certs /realms/ui4a/login-actions/* /resources/*
  }
  handle @keycloakProtocolRead {
    reverse_proxy keycloak:8080
  }

  @keycloakProtocolWrite {
    method POST
    path /realms/ui4a/protocol/openid-connect/token /realms/ui4a/protocol/openid-connect/revoke /realms/ui4a/login-actions/*
  }
  handle @keycloakProtocolWrite {
    reverse_proxy keycloak:8080
  }

  handle {
    respond 404
  }
}

https://{$KEYCLOAK_HOST}:9443 {
  tls /var/lib/ui4a/ca/keycloak/tls.crt /var/lib/ui4a/ca/keycloak/tls.key

  @keycloakAdmin {
    method GET POST
    path /realms/master/protocol/openid-connect/token /admin/realms*
  }
  handle @keycloakAdmin {
    reverse_proxy keycloak:8080
  }

  handle {
    respond 404
  }
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
        depends_on: dependencies({ 'pki-init': 'service_completed_successfully' }),
        healthcheck: health(['CMD-SHELL', 'pg_isready -U postgres -d postgres']),
        environment: {
          POSTGRES_USER: 'postgres',
          POSTGRES_DB: 'postgres',
          POSTGRES_PASSWORD_FILE: '/run/secrets/postgres-bootstrap-password',
        },
        secrets: [stateSecretMount('postgres-bootstrap-password')],
        entrypoint: ['/bin/sh', '-ec'],
        command: [postgresTlsCommand],
        tmpfs: ['/var/run/ui4a/postgres-tls:rw,noexec,nosuid,size=1m,mode=0700'],
        volumes: [
          'postgres-data:/var/lib/postgresql/data',
          'backup-data:/backups',
          'experiment-ca:/var/lib/ui4a/ca:ro',
        ],
      },
      'postgres-bootstrap': {
        image: images.postgres,
        pull_policy: 'missing',
        restart: 'no',
        depends_on: dependencies({ postgres: 'service_healthy' }),
        environment: {
          PGHOST: 'postgres',
          PGDATABASE: 'postgres',
          PGUSER: 'postgres',
          PGPASSWORD_FILE: '/run/secrets/postgres-bootstrap-password',
        },
        secrets: [
          stateSecretMount('postgres-bootstrap-password'),
          stateSecretMount('ui4a-migration-password'),
          stateSecretMount('ui4a-runtime-password'),
          stateSecretMount('keycloak-database-password'),
          stateSecretMount('temporal-schema-password'),
          stateSecretMount('temporal-runtime-password'),
          stateSecretMount('postgres-backup-password'),
        ],
        entrypoint: ['/bin/sh', '-ec'],
        command: [postgresBootstrapCommand],
        volumes: ['../postgres/bootstrap-roles.sql:/opt/ui4a/bootstrap-roles.sql:ro'],
      },
      'temporal-schema': {
        image: images.temporalAdminTools,
        pull_policy: 'missing',
        restart: 'no',
        depends_on: dependencies({ 'postgres-bootstrap': 'service_completed_successfully' }),
        secrets: [stateSecretMount('temporal-schema-password')],
        entrypoint: ['/bin/sh', '-ec'],
        command: [temporalSchemaCommand],
      },
      temporal: {
        image: images.temporal,
        pull_policy: 'missing',
        restart: 'unless-stopped',
        depends_on: dependencies({ 'temporal-schema': 'service_completed_successfully' }),
        configs: [
          {
            source: 'temporal-static-config',
            target: '/etc/temporal/config/docker.yaml',
            mode: 0o444,
          },
          {
            source: 'temporal-dynamic-config',
            target: '/etc/temporal/dynamicconfig/docker.yaml',
            mode: 0o444,
          },
        ],
        secrets: [stateSecretMount('temporal-runtime-password')],
        entrypoint: ['/bin/sh', '-ec'],
        command: [temporalServerCommand],
        healthcheck: health(['CMD', 'temporal', 'operator', 'cluster', 'health']),
      },
      'temporal-namespace': {
        image: images.temporalAdminTools,
        pull_policy: 'missing',
        restart: 'no',
        depends_on: dependencies({ temporal: 'service_healthy' }),
        entrypoint: ['/bin/sh', '-ec'],
        command: [temporalNamespaceCommand],
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
        environment: {
          KC_DB: 'postgres',
          KC_DB_URL_HOST: 'postgres',
          KC_DB_URL_DATABASE: 'keycloak',
          KC_DB_USERNAME: 'keycloak_runtime',
          KC_HEALTH_ENABLED: 'true',
          KC_HTTP_ENABLED: 'true',
          KC_PROXY_HEADERS: 'xforwarded',
          KC_HOSTNAME: 'https://auth.ui4a.mothership.internal:8443',
        },
        secrets: [
          stateSecretMount('keycloak-database-password'),
          stateSecretMount('keycloak-bootstrap-admin-password'),
        ],
        entrypoint: ['/bin/bash', '-ec'],
        command: [
          'export KC_DB_PASSWORD="$$(cat /run/secrets/keycloak-database-password)"; export KC_BOOTSTRAP_ADMIN_USERNAME=ui4a-bootstrap; export KC_BOOTSTRAP_ADMIN_PASSWORD="$$(cat /run/secrets/keycloak-bootstrap-admin-password)"; exec /opt/keycloak/bin/kc.sh start',
        ],
        healthcheck: health([
          'CMD-SHELL',
          "exec 3<>/dev/tcp/127.0.0.1/9000; printf 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3; grep -q '200 OK' <&3",
        ]),
      },
      'realm-bootstrap': runtimeService(images.worker, 'no', {
        depends_on: dependencies({ keycloak: 'service_healthy', edge: 'service_healthy' }),
        environment: {
          ...canonicalRuntimeEnvironment,
          UI4A_REALM_IMPORT_FILE: '/opt/ui4a/realm-import.json',
          UI4A_KEYCLOAK_ADMIN_ORIGIN: 'https://auth.ui4a.mothership.internal:9443',
        },
        command: ['node', 'dist/t22-keycloak-realm-bootstrap.js', '--apply'],
        volumes: [
          'realm-data:/var/lib/ui4a/realm',
          'experiment-ca:/var/lib/ui4a/ca:ro',
          `${input.realmFile}:/opt/ui4a/realm-import.json:ro`,
        ],
      }),
      migration: runtimeService(images.worker, 'no', {
        depends_on: dependencies({
          'postgres-bootstrap': 'service_completed_successfully',
          'pki-init': 'service_completed_successfully',
        }),
        command: ['node', 'dist/t22-migrate.js'],
        volumes: ['experiment-ca:/var/lib/ui4a/ca:ro'],
      }),
      'pki-init': runtimeService(images.runner, 'no', {
        user: '0:0',
        environment: {
          UI4A_DEPLOYMENT_PROFILE: 'production',
          UI4A_DEPLOYMENT_SETTINGS_FILE: '/run/ui4a/settings.json',
          UI4A_DEPLOYMENT_SECRETS_FILE: '/run/secrets/ui4a-deployment-secrets',
          UI4A_PKI_ROOT: '/var/lib/ui4a/ca',
          UI4A_HOST: 'ui4a.mothership.internal',
          KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
          UI4A_POSTGRES_HOST: 'postgres',
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
        environment: {
          ...canonicalRuntimeEnvironment,
          UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: '/run/secrets/capability-callback-token',
        },
        secrets: [{ ...canonicalSecretMount }, stateSecretMount('capability-callback-token')],
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3100/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        volumes: ['experiment-ca:/var/lib/ui4a/ca:ro'],
      }),
      worker: runtimeService(images.worker, 'unless-stopped', {
        depends_on: dependencies({
          migration: 'service_completed_successfully',
          'realm-bootstrap': 'service_completed_successfully',
          'temporal-namespace': 'service_completed_successfully',
          edge: 'service_healthy',
        }),
        environment: {
          ...canonicalRuntimeEnvironment,
          UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: '/run/secrets/capability-callback-token',
          UI4A_RUNNER_IMAGE: images.runner,
          UI4A_HOST_RUNNER_ORIGINS:
            '{"compose-container-runner":"https://ui4a.mothership.internal:8443","compose-host-runner":"https://ui4a.mothership.internal:9444"}',
        },
        secrets: [{ ...canonicalSecretMount }, stateSecretMount('capability-callback-token')],
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3101/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        volumes: ['experiment-ca:/var/lib/ui4a/ca:ro'],
      }),
      runner: runtimeService(images.runner, 'unless-stopped', {
        depends_on: dependencies({ 'pki-init': 'service_completed_successfully' }),
        environment: {
          ...canonicalRuntimeEnvironment,
          UI4A_RUNNER_ID: 'compose-container-runner',
          UI4A_RUNNER_IMAGE: images.runner,
        },
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3102/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        command: ['node', 'dist/main.js', 'daemon'],
        volumes: [
          'experiment-ca:/var/lib/ui4a/ca:ro',
          'runner-workspaces:/workspaces',
          'runner-artifacts:/artifacts',
        ],
      }),
      'host-runner': runtimeService(images.runner, 'unless-stopped', {
        profiles: ['host-runner'],
        depends_on: dependencies({ 'pki-init': 'service_completed_successfully' }),
        environment: {
          ...canonicalRuntimeEnvironment,
          UI4A_RUNNER_ID: 'compose-host-runner',
          UI4A_RUNNER_IMAGE: images.runner,
        },
        healthcheck: health([
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:3102/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]),
        command: ['node', 'dist/main.js', 'daemon'],
        volumes: [
          'experiment-ca:/var/lib/ui4a/ca:ro',
          'runner-workspaces:/workspaces',
          'runner-artifacts:/artifacts',
        ],
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
        networks: {
          default: {
            aliases: ['ui4a.mothership.internal', 'auth.ui4a.mothership.internal'],
          },
        },
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
      'temporal-static-config': { file: 'deploy/compose/temporal-config.yaml' },
      'temporal-dynamic-config': { file: 'deploy/compose/temporal-dynamicconfig.yaml' },
    },
    secrets: {
      'ui4a-deployment-secrets': { file: input.secretsFile },
      ...Object.fromEntries(
        stateSecretNames.map((name) => [
          name,
          { file: siblingSecretFile(input.secretsFile, name) },
        ]),
      ),
    },
    'x-ui4a-contract': {
      schemaVersion: 1,
      replicas: 1,
      highAvailability: false,
      realmLifecycle: 'import-or-check-and-skip',
    },
  };
}
