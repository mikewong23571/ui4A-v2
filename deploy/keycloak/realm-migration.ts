import { compatibleRealm } from './realm-compatibility';
import { assertMigrationAdmin, type KeycloakRealmMigrationAdmin } from './realm-admin';
import {
  fail,
  object,
  renderCompatibilityRealmImport,
  type RealmImportRepresentation,
} from './realm-contract';

export type { KeycloakRealmMigrationAdmin } from './realm-admin';

interface MigrationBackup {
  schemaVersion: 1;
  realm: Record<string, unknown>;
  clients: Array<Record<string, unknown>>;
  defaultRole: Record<string, unknown>;
  offlineRole: Record<string, unknown>;
  defaultRoleComposites: Array<Record<string, unknown>>;
}

interface MigrationInput {
  admin: unknown;
  realmImport: RealmImportRepresentation;
  publicOrigin: string;
  backup(snapshot: MigrationBackup): Promise<void>;
}

export interface MigrationResult {
  outcome: 'migrated' | 'already-applied';
  fromVersion: '1' | '2';
  toVersion: '2';
}

function versionOf(realm: Record<string, unknown>): string | undefined {
  return object(realm.attributes)?.['ui4a.experimental.contract.version'] as string | undefined;
}

function clientById(
  clients: Array<Record<string, unknown>>,
  clientId: string,
): Record<string, unknown> | undefined {
  return clients.find((candidate) => candidate.clientId === clientId);
}

function roleId(role: Record<string, unknown>): string {
  if (typeof role.id !== 'string' || role.id === '') {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak default role is incompatible');
  }
  return role.id;
}

function hasOfflineRole(
  composites: Array<Record<string, unknown>>,
  offlineRole: Record<string, unknown>,
): boolean {
  return composites.some(
    (candidate) =>
      (typeof offlineRole.id === 'string' && candidate.id === offlineRole.id) ||
      candidate.name === 'offline_access',
  );
}

async function roleState(
  admin: KeycloakRealmMigrationAdmin,
  realm: Record<string, unknown>,
): Promise<{
  defaultRole: Record<string, unknown>;
  offlineRole: Record<string, unknown>;
  composites: Array<Record<string, unknown>>;
}> {
  const defaultRole = object(realm.defaultRole);
  if (defaultRole === undefined || defaultRole.name !== 'default-roles-ui4a') {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak default role is incompatible');
  }
  const offlineRole = await admin.getRealmRole('ui4a', 'offline_access');
  if (offlineRole.name !== 'offline_access') {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak offline role is incompatible');
  }
  const composites = await admin.getRoleComposites('ui4a', roleId(defaultRole));
  return { defaultRole, offlineRole, composites };
}

function normalizedSource(
  realm: Record<string, unknown>,
  clients: Array<Record<string, unknown>>,
  expected: RealmImportRepresentation,
): { realm: Record<string, unknown>; clients: Array<Record<string, unknown>> } {
  const cli = expected.clients.find(({ clientId }) => clientId === 'ui4a-cli');
  if (cli === undefined) {
    return fail('KEYCLOAK_REALM_IMPORT_INVALID', 'Realm import is missing ui4a-cli');
  }
  return {
    realm: {
      ...realm,
      offlineSessionIdleTimeout: expected.offlineSessionIdleTimeout,
      offlineSessionMaxLifespanEnabled: expected.offlineSessionMaxLifespanEnabled,
      offlineSessionMaxLifespan: expected.offlineSessionMaxLifespan,
      attributes: {
        ...object(realm.attributes),
        'ui4a.experimental.contract.version': '2',
      },
    },
    clients: clientById(clients, 'ui4a-cli') === undefined ? [...clients, cli] : [...clients],
  };
}

export async function migrateKeycloakRealmV1ToV2(input: MigrationInput): Promise<MigrationResult> {
  assertMigrationAdmin(input.admin);
  const expected = renderCompatibilityRealmImport(input.realmImport, input.publicOrigin);
  const realm = await input.admin.getRealm('ui4a');
  if (realm === undefined) {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'The ui4a realm is absent');
  }
  const clients = await input.admin.getClients('ui4a');
  const currentVersion = versionOf(realm);
  const roles = await roleState(input.admin, realm);

  if (currentVersion === '2') {
    if (
      !compatibleRealm(realm, clients, expected) ||
      !hasOfflineRole(roles.composites, roles.offlineRole)
    ) {
      return fail('KEYCLOAK_REALM_POSTCHECK_FAILED', 'Keycloak realm v2 post-check failed');
    }
    return { outcome: 'already-applied', fromVersion: '2', toVersion: '2' };
  }
  if (currentVersion !== '1') {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak realm migration source is incompatible');
  }
  const normalized = normalizedSource(realm, clients, expected);
  if (!compatibleRealm(normalized.realm, normalized.clients, expected)) {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak realm migration source is incompatible');
  }

  try {
    await input.backup({
      schemaVersion: 1,
      realm,
      clients,
      defaultRole: roles.defaultRole,
      offlineRole: roles.offlineRole,
      defaultRoleComposites: roles.composites,
    });
  } catch {
    return fail('KEYCLOAK_REALM_BACKUP_FAILED', 'Keycloak realm backup failed');
  }

  const cli = expected.clients.find(({ clientId }) => clientId === 'ui4a-cli')!;
  if (clientById(clients, 'ui4a-cli') === undefined) {
    await input.admin.createClient('ui4a', cli);
  }
  if (!hasOfflineRole(roles.composites, roles.offlineRole)) {
    await input.admin.addRoleComposites('ui4a', roleId(roles.defaultRole), [roles.offlineRole]);
  }
  await input.admin.updateRealm('ui4a', {
    offlineSessionIdleTimeout: expected.offlineSessionIdleTimeout,
    offlineSessionMaxLifespanEnabled: expected.offlineSessionMaxLifespanEnabled,
    offlineSessionMaxLifespan: expected.offlineSessionMaxLifespan,
    attributes: {
      ...object(realm.attributes),
      'ui4a.experimental.contract.version': '2',
    },
  });

  const migratedRealm = await input.admin.getRealm('ui4a');
  const migratedClients = await input.admin.getClients('ui4a');
  if (migratedRealm === undefined) {
    return fail('KEYCLOAK_REALM_POSTCHECK_FAILED', 'Keycloak realm v2 post-check failed');
  }
  const migratedRoles = await roleState(input.admin, migratedRealm);
  if (
    !compatibleRealm(migratedRealm, migratedClients, expected) ||
    !hasOfflineRole(migratedRoles.composites, migratedRoles.offlineRole)
  ) {
    return fail('KEYCLOAK_REALM_POSTCHECK_FAILED', 'Keycloak realm v2 post-check failed');
  }
  return { outcome: 'migrated', fromVersion: '1', toVersion: '2' };
}
