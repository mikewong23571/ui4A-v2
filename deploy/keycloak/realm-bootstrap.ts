import { assertAdmin, createKeycloakAdminClient } from './realm-admin';
import { realmMatches } from './realm-match';
import {
  fail,
  KeycloakBootstrapError,
  renderCompatibilityRealmImport,
  resolveRealmImportSecrets,
  type BootstrapResult,
  type RealmImportRepresentation,
} from './realm-contract';

export { createKeycloakAdminClient, KeycloakBootstrapError };
export type {
  BootstrapResult,
  KeycloakBootstrapErrorCode,
  RealmClientRepresentation,
  RealmImportRepresentation,
} from './realm-contract';

interface BootstrapInput {
  admin: unknown;
  realmImport: RealmImportRepresentation;
  publicOrigin: string;
  resolveSecret: (reference: string) => string;
  mode: 'check' | 'apply';
}

export async function bootstrapKeycloakRealm(input: BootstrapInput): Promise<BootstrapResult> {
  assertAdmin(input.admin);
  if (input.mode !== 'check' && input.mode !== 'apply') {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'bootstrap mode must be check or apply');
  }
  const compatibilityView = renderCompatibilityRealmImport(input.realmImport, input.publicOrigin);
  const existingRealm = await input.admin.getRealm(compatibilityView.realm);
  if (existingRealm === undefined) {
    if (input.mode === 'check') {
      return { outcome: 'absent', summary: 'The ui4a realm is absent.' };
    }
    const importRepresentation = resolveRealmImportSecrets(compatibilityView, input.resolveSecret);
    await input.admin.importRealm(importRepresentation);
    return { outcome: 'imported', summary: 'The ui4a realm was imported.' };
  }

  const clients = await input.admin.getClients(compatibilityView.realm);
  if (!realmMatches(existingRealm, clients, compatibilityView)) {
    fail(
      'KEYCLOAK_REALM_INCOMPATIBLE',
      'The existing ui4a realm is incompatible; back it up and replace or rebuild it.',
    );
  }
  return { outcome: 'skip', summary: 'The existing ui4a realm already matches; no changes made.' };
}
