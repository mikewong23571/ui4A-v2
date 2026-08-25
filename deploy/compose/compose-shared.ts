import {
  composeImageKeys,
  type ComposeDependencyCondition,
  type ComposeRenderInput,
  type ComposeService,
} from './compose-types';

const digestImagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._/:~-]*@sha256:[0-9a-f]{64}$/;
export const canonicalRuntimeEnvironment = Object.freeze({
  UI4A_DEPLOYMENT_PROFILE: 'production',
  UI4A_DEPLOYMENT_SETTINGS_FILE: '/var/run/ui4a/runtime-config/settings.json',
  UI4A_DEPLOYMENT_SECRETS_FILE: '/var/run/ui4a/runtime-config/deployment-secrets.json',
  NODE_EXTRA_CA_CERTS: '/var/lib/ui4a/ca/root-ca.crt',
});
export const canonicalConfigMount = Object.freeze({
  source: 'ui4a-deployment-settings',
  target: '/run/ui4a/settings.json',
  mode: 0o400,
});
export const canonicalSecretMount = Object.freeze({
  source: 'ui4a-deployment-secrets',
  target: 'ui4a-deployment-secrets',
  mode: 0o400,
});
export const runtimeTmpfs = '/tmp:rw,noexec,nosuid,size=64m';
export const runtimeConfigRoot = '/var/run/ui4a/runtime-config';
export const runtimeConfigReadOnlyVolume = `runtime-config:${runtimeConfigRoot}:ro`;
export const runnerConfigRoot = '/var/run/ui4a/runner-config';
export const hostRunnerConfigRoot = '/var/run/ui4a/host-runner-config';
export const stateSecretNames = [
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

export function stateSecretMount(name: (typeof stateSecretNames)[number]) {
  return { source: name, target: name, mode: 0o400 };
}

export function siblingSecretFile(deploymentSecretsFile: string, name: string): string {
  const separator = deploymentSecretsFile.lastIndexOf('/');
  return `${deploymentSecretsFile.slice(0, separator + 1)}${name}`;
}

export const postgresBootstrapCommand = [
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

export const temporalSchemaCommand = [
  'TEMPORAL_SCHEMA_PASSWORD="$$(cat /var/run/ui4a/runtime-config/temporal-schema-password)";',
  'temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal setup-schema -v 0.0 &&',
  'temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned &&',
  'temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility setup-schema -v 0.0 &&',
  'exec temporal-sql-tool --ep postgres -p 5432 -u temporal_schema --pw "$$TEMPORAL_SCHEMA_PASSWORD" --pl postgres12 --db temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned',
].join(' ');

export const temporalServerCommand =
  'exec temporal-server --root /etc/temporal --config config --env docker start';
const temporalCli = 'temporal --client-connect-timeout 3s --command-timeout 10s --output none';
export const temporalNamespaceCommand = [
  'set -eu;',
  'for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do',
  `if ${temporalCli} operator namespace describe --namespace temporal-system --address 127.0.0.1:7233; then break; fi;`,
  'if [ "$$attempt" = 12 ]; then exit 1; fi;',
  'sleep 2;',
  'done;',
  `${temporalCli} operator namespace describe --namespace ui4a --address 127.0.0.1:7233 || exec ${temporalCli} operator namespace create --namespace ui4a --address 127.0.0.1:7233 --retention 72h`,
].join(' ');
export const postgresTlsCommand = [
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
export const edgeRoutingFile = 'deploy/compose/edge-routing.caddy';

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

export function validateInput(input: ComposeRenderInput): void {
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

export function health(test: string[]): NonNullable<ComposeService['healthcheck']> {
  return { test: [...test], interval: '10s', timeout: '3s', retries: 12 };
}

export function dependencies(
  input: Record<string, ComposeDependencyCondition>,
): Record<string, { condition: ComposeDependencyCondition }> {
  return Object.fromEntries(
    Object.entries(input).map(([name, condition]) => [name, { condition }]),
  );
}

export function runtimeService(
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
    ...overrides,
  };
}

export function retainedVolume(name: string): { labels: Record<string, string> } {
  return {
    labels: {
      'io.ui4a.volume': name,
      'io.ui4a.retention': 'retain-on-ordinary-down',
    },
  };
}
