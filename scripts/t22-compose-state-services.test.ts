import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderComposeStack } from '../deploy/compose/render-stack';

const root = resolve(import.meta.dirname, '..');
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const digest = (digit: string): string => `sha256:${digit.repeat(64)}`;

function stack() {
  return renderComposeStack({
    projectName: 'ui4a',
    settingsFile: '/srv/ui4a/config/settings.json',
    secretsFile: '/srv/ui4a/secrets/deployment-secrets.json',
    realmFile: 'deploy/keycloak/realm-import.json',
    images: {
      postgres: `registry.internal/postgres@${digest('1')}`,
      temporal: `registry.internal/temporal@${digest('2')}`,
      temporalAdminTools: `registry.internal/temporal-admin@${digest('3')}`,
      temporalUi: `registry.internal/temporal-ui@${digest('4')}`,
      keycloak: `registry.internal/keycloak@${digest('5')}`,
      web: `registry.internal/web@${digest('6')}`,
      worker: `registry.internal/worker@${digest('7')}`,
      runner: `registry.internal/runner@${digest('8')}`,
      edge: `registry.internal/edge@${digest('9')}`,
    },
  });
}

const roleSecrets = [
  ['ui4a_migration_password', 'ui4a-migration-password'],
  ['ui4a_runtime_password', 'ui4a-runtime-password'],
  ['keycloak_runtime_password', 'keycloak-database-password'],
  ['temporal_schema_password', 'temporal-schema-password'],
  ['temporal_runtime_password', 'temporal-runtime-password'],
  ['postgres_backup_password', 'postgres-backup-password'],
] as const;

describe('T22 executable Compose state services', () => {
  it('pins state service versions and executable Temporal configuration artifacts', () => {
    const contract = JSON.parse(source('deploy/compose/stack-contract.json')) as {
      stateServices: Record<string, unknown>;
    };

    expect(contract.stateServices).toEqual({
      postgresMajor: 17,
      temporalServerVersion: '1.31.2',
      keycloakVersion: '26.7.1',
      temporalStaticConfig: 'deploy/compose/temporal-config.yaml',
      temporalDynamicConfig: 'deploy/compose/temporal-dynamicconfig.yaml',
      postgresTls: {
        serverEnabled: true,
        canonicalHost: 'postgres',
        caCertificatePath: '/var/lib/ui4a/ca/root-ca.crt',
        sourceCertificatePath: '/var/lib/ui4a/ca/postgres/server.crt',
        sourcePrivateKeyPath: '/var/lib/ui4a/ca/postgres/server.key',
        runtimeCertificatePath: '/var/run/ui4a/postgres-tls/server.crt',
        runtimePrivateKeyPath: '/var/run/ui4a/postgres-tls/server.key',
        certificateMode: 420,
        privateKeyMode: 384,
        canonicalSettings: {
          host: 'postgres',
          caCertificatePath: '/var/lib/ui4a/ca/root-ca.crt',
          serverCertificatePath: '/var/lib/ui4a/ca/postgres/server.crt',
          serverPrivateKeyPath: '/var/lib/ui4a/ca/postgres/server.key',
        },
      },
      databaseClientTransport: {
        ui4aRuntime: 'verify-full',
        ui4aMigration: 'verify-full',
        keycloak: 'plaintext-on-private-compose-network',
        temporal: 'plaintext-on-private-compose-network',
      },
    });
  });

  it('initializes PostgreSQL PKI before copying a private server handoff and enabling TLS', () => {
    const rendered = stack();
    const postgres = rendered.services.postgres;
    const pki = rendered.services['pki-init'];
    const command = postgres?.command?.join(' ') ?? '';

    expect(pki?.environment).toMatchObject({ UI4A_POSTGRES_HOST: 'postgres' });
    expect(postgres?.depends_on?.['pki-init']?.condition).toBe('service_completed_successfully');
    expect(postgres?.entrypoint).toEqual(['/bin/sh', '-ec']);
    expect(postgres?.volumes).toEqual(
      expect.arrayContaining(['experiment-ca:/var/lib/ui4a/ca:ro']),
    );
    expect(postgres?.tmpfs).toContain(
      '/var/run/ui4a/postgres-tls:rw,noexec,nosuid,size=1m,mode=0700',
    );
    expect(command).toContain('cp /var/lib/ui4a/ca/postgres/server.crt');
    expect(command).toContain('cp /var/lib/ui4a/ca/postgres/server.key');
    expect(command).toContain('chown postgres:postgres');
    expect(command).toContain('chmod 0700 /var/run/ui4a/postgres-tls');
    expect(command).toContain('chmod 0644 /var/run/ui4a/postgres-tls/server.crt');
    expect(command).toContain('chmod 0600 /var/run/ui4a/postgres-tls/server.key');
    expect(command).toContain('ssl=on');
    expect(command).toContain('ssl_cert_file=/var/run/ui4a/postgres-tls/server.crt');
    expect(command).toContain('ssl_key_file=/var/run/ui4a/postgres-tls/server.key');
    expect(command).toContain('ssl_ca_file=/var/lib/ui4a/ca/root-ca.crt');
    expect(command).not.toMatch(/keycloak.*verify-full|temporal.*verify-full/i);
    expect(postgres?.volumes).toContain('experiment-ca:/var/lib/ui4a/ca:ro');
  });

  it('keeps the static PostgreSQL TLS handoff equivalent without embedding key material', () => {
    const compose = source('deploy/compose/compose.yaml');

    expect(compose).toContain('UI4A_POSTGRES_HOST: ${UI4A_POSTGRES_HOST:-postgres}');
    expect(compose).toContain('experiment-ca:/var/lib/ui4a/ca:ro');
    expect(compose).toContain('cp /var/lib/ui4a/ca/postgres/server.key');
    expect(compose).toContain('ssl_cert_file=/var/run/ui4a/postgres-tls/server.crt');
    expect(compose).not.toMatch(/-----BEGIN (?:RSA )?PRIVATE KEY-----/);
  });

  it('injects all six PostgreSQL role passwords from independent Secret files', () => {
    const rendered = stack();
    const bootstrap = rendered.services['postgres-bootstrap'];
    const command = bootstrap?.command?.join(' ') ?? '';

    expect(bootstrap?.environment).toMatchObject({
      PGHOST: 'postgres',
      PGDATABASE: 'postgres',
      PGUSER: 'postgres',
      PGPASSWORD_FILE: '/run/secrets/postgres-bootstrap-password',
    });
    for (const [variable, secret] of roleSecrets) {
      expect(rendered.secrets[secret], secret).toBeDefined();
      expect(bootstrap?.secrets, secret).toContainEqual({
        source: secret,
        target: secret,
        mode: 0o400,
      });
      expect(command, variable).toContain(`-v ${variable}=`);
      expect(command, secret).toContain(`/run/secrets/${secret}`);
    }
    expect(command).toContain('-v ON_ERROR_STOP=1');
    expect(command).toContain('/opt/ui4a/bootstrap-roles.sql');
    expect(command).not.toMatch(/(?:password|secret)=(?:admin|postgres|temporal|keycloak|ui4a)\b/i);
  });

  it('sets up and updates both Temporal PostgreSQL schemas with the schema role', () => {
    const rendered = stack();
    const schema = rendered.services['temporal-schema'];
    const command = schema?.command?.join(' ') ?? '';

    expect(schema?.secrets ?? []).not.toContainEqual(
      expect.objectContaining({ source: 'temporal-schema-password' }),
    );
    expect(schema?.depends_on?.['config-init']?.condition).toBe('service_completed_successfully');
    expect(schema?.volumes).toContain('runtime-config:/var/run/ui4a/runtime-config:ro');
    expect(command).toContain('temporal_schema');
    expect(command).toContain('/var/run/ui4a/runtime-config/temporal-schema-password');
    expect(command.match(/setup-schema/g)).toHaveLength(2);
    expect(command.match(/update-schema/g)).toHaveLength(2);
    expect(command).toContain('--db temporal ');
    expect(command).toContain('--db temporal_visibility ');
    expect(command).toContain('/postgresql/v12/temporal/versioned');
    expect(command).toContain('/postgresql/v12/visibility/versioned');
    expect(command).not.toContain('temporal_runtime');
  });

  it('starts Temporal 1.31 from explicit static and dynamic configuration as runtime role', () => {
    const rendered = stack();
    const temporal = rendered.services.temporal;
    const config = source('deploy/compose/temporal-config.yaml');
    const dynamic = source('deploy/compose/temporal-dynamicconfig.yaml');
    const command = temporal?.command?.join(' ') ?? '';

    expect(rendered.configs['temporal-static-config']).toEqual({
      file: 'deploy/compose/temporal-config.yaml',
    });
    expect(rendered.configs['temporal-dynamic-config']).toEqual({
      file: 'deploy/compose/temporal-dynamicconfig.yaml',
    });
    expect(temporal?.configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: '/etc/temporal/config/docker.yaml' }),
        expect.objectContaining({ target: '/etc/temporal/dynamicconfig/docker.yaml' }),
      ]),
    );
    expect(temporal?.secrets ?? []).not.toContainEqual(
      expect.objectContaining({ source: 'temporal-runtime-password' }),
    );
    expect(temporal?.depends_on?.['config-init']?.condition).toBe('service_completed_successfully');
    expect(temporal?.volumes).toContain('runtime-config:/var/run/ui4a/runtime-config:ro');
    expect(command).not.toContain('TEMPORAL_RUNTIME_PASSWORD');
    expect(command).toContain('temporal-server');
    expect(command).toContain('--env docker');
    expect(temporal?.healthcheck?.test).toEqual(['CMD', 'nc', '-z', '127.0.0.1', '7233']);
    expect(temporal?.healthcheck?.test.join(' ')).not.toContain('temporal operator');
    expect(config).toContain('pluginName: postgres12');
    expect(config).toContain('databaseName: temporal');
    expect(config).toContain('databaseName: temporal_visibility');
    expect(config.match(/user: temporal_runtime/g)).toHaveLength(2);
    expect(config).not.toContain('.Env.TEMPORAL_RUNTIME_PASSWORD');
    expect(config.match(/passwordCommand:/g)).toHaveLength(2);
    expect(config.match(/command: \/bin\/cat/g)).toHaveLength(2);
    expect(
      config.match(/- \/var\/run\/ui4a\/runtime-config\/temporal-runtime-password/g),
    ).toHaveLength(2);
    expect(config).toContain('/etc/temporal/dynamicconfig/docker.yaml');
    expect(dynamic).toMatch(/frontend\.enableClientVersionCheck:/);
  });

  it('uses a real idempotent Temporal namespace describe-or-create command', () => {
    const command = stack().services['temporal-namespace']?.command?.join(' ') ?? '';

    expect(command).toContain('temporal operator namespace describe --namespace ui4a');
    expect(command).toContain('temporal operator namespace create --namespace ui4a');
    expect(command).toContain('--address temporal:7233');
    expect(command).not.toContain('create-or-check');
  });

  it('binds Keycloak 26.7.1 to only its database role and Secret', () => {
    const rendered = stack();
    const keycloak = rendered.services.keycloak;
    const compose = source('deploy/compose/compose.yaml');

    expect(keycloak?.environment).toMatchObject({
      KC_DB: 'postgres',
      KC_DB_URL_HOST: 'postgres',
      KC_DB_URL_DATABASE: 'keycloak',
      KC_DB_USERNAME: 'keycloak_runtime',
      KC_HEALTH_ENABLED: 'true',
      KC_HOSTNAME: 'https://auth.ui4a.mothership.internal:8443',
    });
    expect(JSON.stringify(keycloak)).not.toMatch(
      /hostname-strict=false|KC_HOSTNAME_STRICT.*false/i,
    );
    expect(keycloak?.secrets ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'keycloak-database-password' })]),
    );
    expect(keycloak?.depends_on?.['config-init']?.condition).toBe('service_completed_successfully');
    expect(keycloak?.volumes).toContain('runtime-config:/var/run/ui4a/runtime-config:ro');
    expect(keycloak?.command?.join(' ')).toContain(
      '/var/run/ui4a/runtime-config/keycloak-database-password',
    );
    expect(compose).toMatch(/quay\.io\/keycloak\/keycloak:26\.7\.1@sha256:/);
    expect(keycloak?.healthcheck?.test.join(' ')).toContain('/health/ready');
    expect(JSON.stringify(keycloak)).not.toContain('temporal-runtime-password');
    expect(JSON.stringify(keycloak)).not.toContain('ui4a-runtime-password');
  });
});
