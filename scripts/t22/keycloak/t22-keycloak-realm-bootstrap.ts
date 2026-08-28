import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preflightProductionDeploymentFromEnvironment } from '../../../packages/shared/src/production-deployment-config';

import {
  bootstrapKeycloakRealm,
  createKeycloakAdminClient,
  KeycloakBootstrapError,
  type RealmImportRepresentation,
} from '../../../deploy/keycloak/realm-bootstrap';

const realmImportPath = 'deploy/keycloak/realm-import.json';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const realmImportEnvironmentVariable = 'UI4A_REALM_IMPORT_FILE';
const adminOriginEnvironmentVariable = 'UI4A_KEYCLOAK_ADMIN_ORIGIN';
const maximumRealmImportBytes = 1024 * 1024;

function readRealmImport(environment: NodeJS.ProcessEnv): RealmImportRepresentation {
  const configuredPath = environment[realmImportEnvironmentVariable];
  const path =
    configuredPath === undefined ? resolve(repositoryRoot, realmImportPath) : configuredPath;
  if (!isAbsolute(path) || path.includes('\0')) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      `${realmImportEnvironmentVariable} must identify an absolute regular file.`,
    );
  }

  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.size === 0 || status.size > maximumRealmImportBytes) {
      throw new Error('unsafe realm import file');
    }
    return JSON.parse(readFileSync(descriptor, 'utf8')) as RealmImportRepresentation;
  } catch {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      `${realmImportEnvironmentVariable} does not identify a readable, bounded regular file.`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function modeFromArguments(arguments_: string[]): 'check' | 'apply' {
  if (arguments_.length === 1 && arguments_[0] === '--check') return 'check';
  if (arguments_.length === 1 && arguments_[0] === '--apply') return 'apply';
  throw new KeycloakBootstrapError(
    'KEYCLOAK_REALM_IMPORT_INVALID',
    'Usage: t22-keycloak-realm-bootstrap.ts --check|--apply',
  );
}

async function main(): Promise<void> {
  const mode = modeFromArguments(process.argv.slice(2));
  const config = preflightProductionDeploymentFromEnvironment(process.env, (path) =>
    readFileSync(path, 'utf8'),
  );
  if (config === undefined) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The Keycloak realm bootstrap requires the production deployment profile.',
    );
  }

  const { settings } = config;
  const issuer = new URL(settings.auth.oidc.issuer);
  if (issuer.pathname.replace(/\/$/, '') !== `/realms/${settings.keycloak.realm}`) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The configured issuer does not identify the configured realm.',
    );
  }
  let adminOrigin: URL;
  try {
    adminOrigin = new URL(process.env[adminOriginEnvironmentVariable] ?? issuer.origin);
  } catch {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The Keycloak Admin origin is invalid.',
    );
  }
  if (
    adminOrigin.protocol !== 'https:' ||
    adminOrigin.hostname !== settings.keycloak.host ||
    adminOrigin.pathname !== '/' ||
    adminOrigin.search !== '' ||
    adminOrigin.hash !== '' ||
    adminOrigin.username !== '' ||
    adminOrigin.password !== ''
  ) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The Keycloak Admin origin is invalid.',
    );
  }
  const adminPassword = config.secrets[settings.keycloak.bootstrapAdminPasswordRef];
  if (adminPassword === undefined) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The configured bootstrap credential is unavailable.',
    );
  }
  const realmSecretReferences: Readonly<Record<string, string>> = {
    'oidc-client-secret': settings.auth.oidc.clientSecretRef,
    'ui4a-agent-client-secret': settings.auth.oidc.agentClientSecretRef,
    'ui4a-experiment-human-password': settings.keycloak.experimentHumanPasswordRef,
  };

  const realmImport = readRealmImport(process.env);
  const admin = createKeycloakAdminClient({
    baseUrl: adminOrigin.origin,
    adminUsername: settings.keycloak.bootstrapAdminUser,
    adminPassword,
    fetch,
    timeoutMs: 10_000,
  });
  const result = await bootstrapKeycloakRealm({
    admin,
    realmImport,
    publicOrigin: settings.service.publicOrigin,
    resolveSecret(reference) {
      const configuredReference = realmSecretReferences[reference];
      const value =
        configuredReference === undefined ? undefined : config.secrets[configuredReference];
      if (value === undefined) {
        throw new KeycloakBootstrapError(
          'KEYCLOAK_REALM_IMPORT_INVALID',
          'The realm import references an unavailable configured secret.',
        );
      }
      return value;
    },
    mode,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, mode, ...result })}\n`);
}

main().catch((error: unknown) => {
  const failure =
    error instanceof KeycloakBootstrapError
      ? { ok: false, code: error.code, message: error.message }
      : { ok: false, code: 'KEYCLOAK_BOOTSTRAP_FAILED', message: 'Keycloak bootstrap failed.' };
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
});
