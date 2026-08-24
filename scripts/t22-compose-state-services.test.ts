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
    });
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

    expect(schema?.secrets).toContainEqual({
      source: 'temporal-schema-password',
      target: 'temporal-schema-password',
      mode: 0o400,
    });
    expect(command).toContain('temporal_schema');
    expect(command).toContain('/run/secrets/temporal-schema-password');
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
    expect(temporal?.secrets).toContainEqual({
      source: 'temporal-runtime-password',
      target: 'temporal-runtime-password',
      mode: 0o400,
    });
    expect(command).toContain('/run/secrets/temporal-runtime-password');
    expect(command).toContain('temporal-server');
    expect(command).toContain('--env docker');
    expect(config).toContain('pluginName: postgres12');
    expect(config).toContain('databaseName: temporal');
    expect(config).toContain('databaseName: temporal_visibility');
    expect(config.match(/user: temporal_runtime/g)).toHaveLength(2);
    expect(config).toContain('.Env.TEMPORAL_RUNTIME_PASSWORD');
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
    });
    expect(keycloak?.secrets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'keycloak-database-password' }),
        expect.objectContaining({ source: 'keycloak-bootstrap-admin-password' }),
      ]),
    );
    expect(keycloak?.command?.join(' ')).toContain('/run/secrets/keycloak-database-password');
    expect(compose).toMatch(/quay\.io\/keycloak\/keycloak:26\.7\.1@sha256:/);
    expect(keycloak?.healthcheck?.test.join(' ')).toContain('/health/ready');
    expect(JSON.stringify(keycloak)).not.toContain('temporal-runtime-password');
    expect(JSON.stringify(keycloak)).not.toContain('ui4a-runtime-password');
  });
});
