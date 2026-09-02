import { assertMigrationAdmin, type KeycloakRealmMigrationAdmin } from './realm-admin';
import {
  fail,
  renderCompatibilityRealmImport,
  type RealmImportRepresentation,
} from './realm-contract';
import { realmMatches } from './realm-match';

interface RealmBindingBackup {
  schemaVersion: 1;
  realm: Record<string, unknown>;
  clients: Array<Record<string, unknown>>;
}

interface RealmBindingInput {
  admin: unknown;
  realmImport: RealmImportRepresentation;
  publicOrigin: string;
  trustedRequestOrigins: readonly string[];
  backup(snapshot: RealmBindingBackup): Promise<void>;
}

export type RealmBindingResult = { outcome: 'updated' | 'already-applied' };

/** Reconcile only environment-specific browser callbacks after proving all other realm facts match. */
export async function reconcileKeycloakRealmBrowserOrigins(
  input: RealmBindingInput,
): Promise<RealmBindingResult> {
  assertMigrationAdmin(input.admin);
  const admin: KeycloakRealmMigrationAdmin = input.admin;
  const expected = renderCompatibilityRealmImport(
    input.realmImport,
    input.publicOrigin,
    input.trustedRequestOrigins,
  );
  const canonical = renderCompatibilityRealmImport(input.realmImport, input.publicOrigin, [
    input.publicOrigin,
  ]);
  const realm = await admin.getRealm('ui4a');
  if (realm === undefined) {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'The ui4a realm is absent');
  }
  const clients = await admin.getClients('ui4a');
  if (realmMatches(realm, clients, expected)) return { outcome: 'already-applied' };
  if (!realmMatches(realm, clients, canonical)) {
    return fail(
      'KEYCLOAK_REALM_INCOMPATIBLE',
      'The existing ui4a realm differs beyond browser origin bindings',
    );
  }
  const currentWeb = clients.find(({ clientId }) => clientId === 'ui4a-web');
  const expectedWeb = expected.clients.find(({ clientId }) => clientId === 'ui4a-web');
  if (currentWeb === undefined || expectedWeb === undefined || typeof currentWeb.id !== 'string') {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'The ui4a Web client is incompatible');
  }
  try {
    await input.backup({ schemaVersion: 1, realm, clients });
  } catch {
    return fail('KEYCLOAK_REALM_BACKUP_FAILED', 'Keycloak realm backup failed');
  }
  await admin.updateClient('ui4a', currentWeb.id, {
    ...currentWeb,
    redirectUris: expectedWeb.redirectUris,
    attributes: {
      ...(currentWeb.attributes as Record<string, unknown> | undefined),
      'post.logout.redirect.uris': expectedWeb.attributes?.['post.logout.redirect.uris'],
    },
  });
  const updatedRealm = await admin.getRealm('ui4a');
  const updatedClients = await admin.getClients('ui4a');
  if (updatedRealm === undefined || !realmMatches(updatedRealm, updatedClients, expected)) {
    return fail('KEYCLOAK_REALM_POSTCHECK_FAILED', 'Keycloak browser origin post-check failed');
  }
  return { outcome: 'updated' };
}
