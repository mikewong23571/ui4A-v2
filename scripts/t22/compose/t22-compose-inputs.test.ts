import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  generateComposeProductionEnvironment,
  validateComposeProductionEnvironment,
  type ComposeInputDependencies,
} from './t22-compose-inputs';

const secretValue = (name: string): string => `__private_${name}__`;
const settingsFile = '/operator/ui4a/settings.json';
const secretsFile = '/operator/ui4a/deployment-secrets.json';
const ui4aGitSha = 'c'.repeat(40);
const secretFiles = {
  UI4A_POSTGRES_BOOTSTRAP_PASSWORD_FILE: '/operator/ui4a/postgres-bootstrap-password',
  UI4A_MIGRATION_PASSWORD_FILE: '/operator/ui4a/ui4a-migration-password',
  UI4A_RUNTIME_PASSWORD_FILE: '/operator/ui4a/ui4a-runtime-password',
  UI4A_KEYCLOAK_DATABASE_PASSWORD_FILE: '/operator/ui4a/keycloak-database-password',
  UI4A_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD_FILE: '/operator/ui4a/keycloak-bootstrap-admin-password',
  UI4A_TEMPORAL_SCHEMA_PASSWORD_FILE: '/operator/ui4a/temporal-schema-password',
  UI4A_TEMPORAL_RUNTIME_PASSWORD_FILE: '/operator/ui4a/temporal-runtime-password',
  UI4A_POSTGRES_BACKUP_PASSWORD_FILE: '/operator/ui4a/postgres-backup-password',
  UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: '/operator/ui4a/capability-callback-token',
} as const;
const images = {
  UI4A_POSTGRES_IMAGE: `registry.internal/postgres@sha256:${'1'.repeat(64)}`,
  UI4A_TEMPORAL_IMAGE: `registry.internal/temporal@sha256:${'2'.repeat(64)}`,
  UI4A_TEMPORAL_ADMIN_TOOLS_IMAGE: `registry.internal/temporal-admin@sha256:${'3'.repeat(64)}`,
  UI4A_TEMPORAL_UI_IMAGE: `registry.internal/temporal-ui@sha256:${'4'.repeat(64)}`,
  UI4A_KEYCLOAK_IMAGE: `registry.internal/keycloak@sha256:${'5'.repeat(64)}`,
  UI4A_WEB_IMAGE: `registry.internal/web@sha256:${'6'.repeat(64)}`,
  UI4A_WORKER_IMAGE: `registry.internal/worker@sha256:${'7'.repeat(64)}`,
  UI4A_RUNNER_IMAGE: `registry.internal/runner@sha256:${'8'.repeat(64)}`,
  UI4A_EDGE_IMAGE: `registry.internal/edge@sha256:${'9'.repeat(64)}`,
} as const;

function fixture() {
  const refs = {
    postgresBootstrap: 'postgres-bootstrap-password',
    migration: 'postgres-migration-password',
    runtime: 'postgres-runtime-password',
    keycloakDatabase: 'keycloak-database-password',
    keycloakAdmin: 'keycloak-bootstrap-admin-password',
    temporalSchema: 'temporal-schema-password',
    temporalRuntime: 'temporal-runtime-password',
    postgresBackup: 'postgres-backup-password',
    containerRunner: 'compose-container-runner-token',
    hostRunner: 'compose-host-runner-token',
    callback: 'capability-callback-token',
  };
  const secrets = Object.fromEntries(Object.values(refs).map((ref) => [ref, secretValue(ref)]));
  const files = new Map<string, string>([
    [settingsFile, '{"schemaVersion":1}'],
    [secretsFile, JSON.stringify(secrets)],
    [secretFiles.UI4A_POSTGRES_BOOTSTRAP_PASSWORD_FILE, secrets[refs.postgresBootstrap]!],
    [secretFiles.UI4A_MIGRATION_PASSWORD_FILE, secrets[refs.migration]!],
    [secretFiles.UI4A_RUNTIME_PASSWORD_FILE, secrets[refs.runtime]!],
    [secretFiles.UI4A_KEYCLOAK_DATABASE_PASSWORD_FILE, secrets[refs.keycloakDatabase]!],
    [secretFiles.UI4A_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD_FILE, secrets[refs.keycloakAdmin]!],
    [secretFiles.UI4A_TEMPORAL_SCHEMA_PASSWORD_FILE, secrets[refs.temporalSchema]!],
    [secretFiles.UI4A_TEMPORAL_RUNTIME_PASSWORD_FILE, secrets[refs.temporalRuntime]!],
    [secretFiles.UI4A_POSTGRES_BACKUP_PASSWORD_FILE, secrets[refs.postgresBackup]!],
    [secretFiles.UI4A_CAPABILITY_CALLBACK_TOKEN_FILE, secrets[refs.callback]!],
  ]);
  const dependencies: ComposeInputDependencies = {
    inspectFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error('missing');
      return { regular: true, symbolicLink: false, size: content.length, mode: 0o600 };
    },
    readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error('missing');
      return content;
    },
    loadCanonical() {
      return {
        settings: {
          postgres: {
            migrationPasswordRef: refs.migration,
            runtimePasswordRef: refs.runtime,
            backupPasswordRef: refs.postgresBackup,
          },
          temporal: {
            persistence: {
              defaultStore: {
                schemaPasswordRef: refs.temporalSchema,
                runtimePasswordRef: refs.temporalRuntime,
              },
              visibilityStore: {
                schemaPasswordRef: refs.temporalSchema,
                runtimePasswordRef: refs.temporalRuntime,
              },
            },
          },
          keycloak: {
            databasePasswordRef: refs.keycloakDatabase,
            bootstrapAdminPasswordRef: refs.keycloakAdmin,
          },
          runtime: {
            profiles: [
              {
                backend: 'host',
                runnerId: 'compose-container-runner',
                runnerTokenRef: refs.containerRunner,
              },
              {
                backend: 'host',
                runnerId: 'compose-host-runner',
                runnerTokenRef: refs.hostRunner,
              },
            ],
          },
        },
        secrets,
      };
    },
  };
  return { dependencies, files, secrets };
}

function environment(): Record<string, string> {
  return {
    UI4A_DEPLOYMENT_PROFILE: 'production',
    UI4A_RELEASE_GIT_SHA: ui4aGitSha,
    UI4A_DEPLOYMENT_SETTINGS_FILE: settingsFile,
    UI4A_DEPLOYMENT_SECRETS_FILE: secretsFile,
    ...secretFiles,
    ...images,
  };
}

describe('T22 Compose operator-owned production inputs', () => {
  it('generates only a sealed path/digest environment and verifies all eight Secret bindings', () => {
    const { dependencies, secrets } = fixture();
    const generated = generateComposeProductionEnvironment(
      { ui4aGitSha, settingsFile, secretsFile, secretFiles, images },
      dependencies,
    );

    expect(generated.environment).toEqual(environment());
    expect(generated.summary).toEqual({ files: 11, secretFiles: 9, images: 9, bindings: 9 });
    for (const material of Object.values(secrets)) {
      expect(JSON.stringify(generated)).not.toContain(material);
    }
  });

  it('rejects an independent Secret file that differs from canonical Secret JSON', () => {
    const { dependencies, files } = fixture();
    files.set(secretFiles.UI4A_RUNTIME_PASSWORD_FILE, '__different_private_value__');

    expect(() => validateComposeProductionEnvironment(environment(), dependencies)).toThrowError(
      'COMPOSE_SECRET_FILE_MISMATCH',
    );
  });

  it.each([
    ['relative', { regular: true, symbolicLink: false, size: 1, mode: 0o600 }, 'relative'],
    ['symlink', { regular: true, symbolicLink: true, size: 1, mode: 0o600 }, settingsFile],
    ['broad mode', { regular: true, symbolicLink: false, size: 1, mode: 0o640 }, settingsFile],
  ])('rejects a %s operator file before canonical parsing', (_case, facts, path) => {
    const { dependencies } = fixture();
    const invalid = { ...environment(), UI4A_DEPLOYMENT_SETTINGS_FILE: path };
    dependencies.inspectFile = () => facts;

    expect(() => validateComposeProductionEnvironment(invalid, dependencies)).toThrowError(
      'COMPOSE_INPUT_FILE_INVALID',
    );
  });

  it('rejects any of the nine mutable or missing image references', () => {
    const { dependencies } = fixture();
    const invalid = { ...environment(), UI4A_EDGE_IMAGE: 'registry.internal/edge:latest' };

    expect(() => validateComposeProductionEnvironment(invalid, dependencies)).toThrowError(
      'COMPOSE_IMAGE_REFERENCE_INVALID',
    );
  });

  it('rejects a missing or malformed operator-owned UI4A release SHA', () => {
    const { dependencies } = fixture();

    expect(() =>
      generateComposeProductionEnvironment(
        { ui4aGitSha: 'not-a-sha', settingsFile, secretsFile, secretFiles, images },
        dependencies,
      ),
    ).toThrowError('COMPOSE_RELEASE_REVISION_INVALID');
  });

  it('preflights two distinct server-owned Runner ids and token refs from canonical settings', () => {
    const source = readFileSync('scripts/t22/compose/t22-compose-inputs.ts', 'utf8');

    expect(source).toContain('settings.runtime.profiles');
    expect(source).toContain('compose-container-runner');
    expect(source).toContain('compose-container-runner-token');
    expect(source).toContain('compose-host-runner');
    expect(source).toContain('compose-host-runner-token');
    expect(source).toContain('COMPOSE_RUNTIME_BINDING_INVALID');
  });

  it('rejects a missing Host Runner binding or reused Runner credential material', () => {
    const missing = fixture();
    const loadCanonical = missing.dependencies.loadCanonical;
    missing.dependencies.loadCanonical = (...args) => {
      const canonical = loadCanonical(...args);
      canonical.settings.runtime.profiles = canonical.settings.runtime.profiles.filter(
        ({ runnerId }) => runnerId !== 'compose-host-runner',
      );
      return canonical;
    };
    expect(() =>
      validateComposeProductionEnvironment(environment(), missing.dependencies),
    ).toThrowError('COMPOSE_RUNTIME_BINDING_INVALID');

    const reused = fixture();
    reused.secrets['compose-host-runner-token'] = reused.secrets['compose-container-runner-token']!;
    expect(() =>
      validateComposeProductionEnvironment(environment(), reused.dependencies),
    ).toThrowError('COMPOSE_RUNTIME_BINDING_INVALID');
  });
});
