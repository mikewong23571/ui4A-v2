import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preflightProductionDeploymentFromEnvironment } from '../../../packages/shared/src/production-deployment-config';
import { createKeycloakAdminClient } from '../../../deploy/keycloak/realm-admin';
import { reconcileKeycloakRealmBrowserOrigins } from '../../../deploy/keycloak/realm-bindings';
import {
  KeycloakBootstrapError,
  type RealmImportRepresentation,
} from '../../../deploy/keycloak/realm-contract';
import { migrateKeycloakRealmV1ToV2 } from '../../../deploy/keycloak/realm-migration';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultRealmImportPath = resolve(repositoryRoot, 'deploy/keycloak/realm-import.json');
const backupRoot = '/var/lib/ui4a/realm/backups';
const maximumRealmImportBytes = 1024 * 1024;

function readRealmImport(environment: NodeJS.ProcessEnv): RealmImportRepresentation {
  const path = environment.UI4A_REALM_IMPORT_FILE ?? defaultRealmImportPath;
  if (!isAbsolute(path) || path.includes('\0')) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'UI4A_REALM_IMPORT_FILE must identify an absolute regular file.',
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
      'UI4A_REALM_IMPORT_FILE does not identify a readable, bounded regular file.',
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function backupPath(arguments_: string[]): string {
  if (arguments_.length !== 2 || arguments_[0] !== '--backup-file') {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'Usage: t22-keycloak-realm-migration.ts --backup-file /var/lib/ui4a/realm/backups/<name>.json',
    );
  }
  const path = arguments_[1]!;
  if (
    !path.startsWith(`${backupRoot}/`) ||
    dirname(path) !== backupRoot ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(path.slice(backupRoot.length + 1))
  ) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'Realm migration backup path is invalid.',
    );
  }
  return path;
}

function redactSensitive(value: unknown, key = ''): unknown {
  if (/secret|password|credentials/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
      childKey,
      redactSensitive(child, childKey),
    ]),
  );
}

function writeBackup(path: string, snapshot: unknown): void {
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, `${JSON.stringify(redactSensitive(snapshot), null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } catch {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_BACKUP_FAILED',
      'Keycloak realm backup failed.',
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function main(): Promise<void> {
  const path = backupPath(process.argv.slice(2));
  const config = preflightProductionDeploymentFromEnvironment(process.env, (file) =>
    readFileSync(file, 'utf8'),
  );
  if (config === undefined) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The Keycloak realm migration requires the production deployment profile.',
    );
  }
  const issuer = new URL(config.settings.auth.oidc.issuer);
  const adminOrigin = new URL(process.env.UI4A_KEYCLOAK_ADMIN_ORIGIN ?? issuer.origin);
  if (
    adminOrigin.protocol !== 'https:' ||
    adminOrigin.hostname !== config.settings.tls.keycloakHost ||
    adminOrigin.pathname !== '/' ||
    adminOrigin.search !== '' ||
    adminOrigin.hash !== ''
  ) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The Keycloak Admin origin is invalid.',
    );
  }
  const adminPassword = config.secrets[config.settings.keycloak.bootstrapAdminPasswordRef];
  if (adminPassword === undefined) {
    throw new KeycloakBootstrapError(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'The configured bootstrap credential is unavailable.',
    );
  }
  const admin = createKeycloakAdminClient({
    baseUrl: adminOrigin.origin,
    adminUsername: config.settings.keycloak.bootstrapAdminUser,
    adminPassword,
    fetch,
    timeoutMs: 10_000,
  });
  let backupWritten = false;
  const backup = async (snapshot: unknown) => {
    if (backupWritten) return;
    writeBackup(path, snapshot);
    backupWritten = true;
  };
  const migration = await migrateKeycloakRealmV1ToV2({
    admin,
    realmImport: readRealmImport(process.env),
    publicOrigin: config.settings.service.publicOrigin,
    backup,
  });
  const origins = await reconcileKeycloakRealmBrowserOrigins({
    admin,
    realmImport: readRealmImport(process.env),
    publicOrigin: config.settings.service.publicOrigin,
    trustedRequestOrigins: config.settings.service.trustedRequestOrigins,
    backup,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, backupFile: path, migration, origins })}\n`);
}

main().catch((error: unknown) => {
  const failure =
    error instanceof KeycloakBootstrapError
      ? { ok: false, code: error.code, message: error.message }
      : {
          ok: false,
          code: 'KEYCLOAK_REALM_MIGRATION_FAILED',
          message: 'Keycloak realm migration failed.',
        };
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
});
