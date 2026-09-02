import { assertMigrationAdmin, type KeycloakRealmMigrationAdmin } from './realm-admin';
import {
  accountConsoleClientScopeName,
  fail,
  object,
  type RealmClientScopeRepresentation,
  type RealmImportRepresentation,
} from './realm-contract';

interface AccountConsoleInput {
  admin: unknown;
  realmImport: RealmImportRepresentation;
}

interface ReconcileAccountConsoleInput extends AccountConsoleInput {
  backup(snapshot: AccountConsoleBackup): Promise<void>;
}

interface AccountConsoleBackup {
  schemaVersion: 1;
  accountConsoleClient: Record<string, unknown>;
  clientScopes: Array<Record<string, unknown>>;
}

interface AccountConsoleState {
  client: Record<string, unknown>;
  scopes: Array<Record<string, unknown>>;
  expectedScope: RealmClientScopeRepresentation;
  installedScope?: Record<string, unknown>;
  assigned: boolean;
}

function expectedScope(realmImport: RealmImportRepresentation): RealmClientScopeRepresentation {
  return (
    realmImport.clientScopes.find(({ name }) => name === accountConsoleClientScopeName) ??
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'Realm import is missing the Account Console scope')
  );
}

function canonical(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(canonical);
  const value = object(input);
  if (value === undefined) return input;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function sameScope(actual: Record<string, unknown>, expected: RealmClientScopeRepresentation) {
  const shape = (scope: Record<string, unknown>) => ({
    name: scope.name,
    protocol: scope.protocol,
    attributes: scope.attributes,
    protocolMappers: Array.isArray(scope.protocolMappers)
      ? scope.protocolMappers
          .map((candidate) => {
            const mapper = object(candidate);
            return {
              name: mapper?.name,
              protocol: mapper?.protocol,
              protocolMapper: mapper?.protocolMapper,
              config: mapper?.config,
            };
          })
          .sort((left, right) => String(left.name).localeCompare(String(right.name)))
      : scope.protocolMappers,
  });
  return JSON.stringify(canonical(shape(actual))) === JSON.stringify(canonical(shape(expected)));
}

async function state(
  admin: KeycloakRealmMigrationAdmin,
  realmImport: RealmImportRepresentation,
): Promise<AccountConsoleState> {
  const clients = await admin.getClients('ui4a');
  const client = clients.find(({ clientId }) => clientId === 'account-console');
  if (
    client === undefined ||
    typeof client.id !== 'string' ||
    client.id === '' ||
    client.enabled !== true ||
    client.publicClient !== true ||
    client.standardFlowEnabled !== true
  ) {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak Account Console client is incompatible');
  }
  const scopes = await admin.getClientScopes('ui4a');
  const expected = expectedScope(realmImport);
  const installedScope = scopes.find(({ name }) => name === accountConsoleClientScopeName);
  if (installedScope !== undefined && !sameScope(installedScope, expected)) {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak Account Console scope is incompatible');
  }
  const defaults = client.defaultClientScopes;
  if (!Array.isArray(defaults) || defaults.some((value) => typeof value !== 'string')) {
    return fail('KEYCLOAK_REALM_INCOMPATIBLE', 'Keycloak Account Console client is incompatible');
  }
  return {
    client,
    scopes,
    expectedScope: expected,
    installedScope,
    assigned: defaults.includes(accountConsoleClientScopeName),
  };
}

export async function verifyKeycloakAccountConsole(
  input: AccountConsoleInput,
): Promise<{ outcome: 'ready' }> {
  assertMigrationAdmin(input.admin);
  const current = await state(input.admin, input.realmImport);
  if (current.installedScope === undefined || !current.assigned) {
    return fail('KEYCLOAK_REALM_POSTCHECK_FAILED', 'Keycloak Account Console binding is absent');
  }
  return { outcome: 'ready' };
}

export async function reconcileKeycloakAccountConsole(
  input: ReconcileAccountConsoleInput,
): Promise<{ outcome: 'updated' | 'already-applied' }> {
  assertMigrationAdmin(input.admin);
  const current = await state(input.admin, input.realmImport);
  if (current.installedScope !== undefined && current.assigned) {
    return { outcome: 'already-applied' };
  }
  try {
    await input.backup({
      schemaVersion: 1,
      accountConsoleClient: current.client,
      clientScopes: current.scopes,
    });
  } catch {
    return fail('KEYCLOAK_REALM_BACKUP_FAILED', 'Keycloak realm backup failed');
  }

  if (current.installedScope === undefined) {
    await input.admin.createClientScope('ui4a', current.expectedScope);
  }
  const scopes = await input.admin.getClientScopes('ui4a');
  const installedScope = scopes.find(({ name }) => name === accountConsoleClientScopeName);
  if (
    installedScope === undefined ||
    typeof installedScope.id !== 'string' ||
    installedScope.id === ''
  ) {
    return fail(
      'KEYCLOAK_REALM_POSTCHECK_FAILED',
      'Keycloak Account Console scope was not created',
    );
  }
  if (!current.assigned) {
    await input.admin.addClientDefaultScope('ui4a', current.client.id as string, installedScope.id);
  }
  try {
    await verifyKeycloakAccountConsole({ admin: input.admin, realmImport: input.realmImport });
  } catch {
    return fail('KEYCLOAK_REALM_POSTCHECK_FAILED', 'Keycloak Account Console post-check failed');
  }
  return { outcome: 'updated' };
}
