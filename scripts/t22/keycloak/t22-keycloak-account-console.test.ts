import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { KeycloakRealmMigrationAdmin } from '../../../deploy/keycloak/realm-admin';
import {
  reconcileKeycloakAccountConsole,
  verifyKeycloakAccountConsole,
} from '../../../deploy/keycloak/realm-account-console';
import type { RealmImportRepresentation } from '../../../deploy/keycloak/realm-contract';

const realmImport = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../deploy/keycloak/realm-import.json'), 'utf8'),
) as RealmImportRepresentation;
const expectedScope = realmImport.clientScopes.find(({ name }) => name === 'ui4a:account-console')!;

class FakeAccountConsoleAdmin implements KeycloakRealmMigrationAdmin {
  readonly mutations: string[] = [];
  readonly accountConsole = {
    id: 'account-console-id',
    clientId: 'account-console',
    enabled: true,
    publicClient: true,
    standardFlowEnabled: true,
    defaultClientScopes: [] as string[],
  };
  clientScopes: Array<Record<string, unknown>> = [];
  corruptAfterAssign = false;

  async getRealm() {
    return { realm: 'ui4a' };
  }

  async getClients() {
    return [structuredClone(this.accountConsole)];
  }

  async getClientScopes() {
    return structuredClone(this.clientScopes);
  }

  async importRealm() {
    throw new Error('not used');
  }

  async createClient() {
    throw new Error('not used');
  }

  async updateClient() {
    throw new Error('not used');
  }

  async createClientScope(_realm: string, scope: Record<string, unknown>) {
    this.mutations.push('create-client-scope');
    this.clientScopes.push({
      ...structuredClone(scope),
      id: 'account-console-scope-id',
      description: '',
      protocolMappers: (scope.protocolMappers as Array<Record<string, unknown>>).map(
        (mapper, index) => ({ ...mapper, id: `mapper-${index}`, consentRequired: false }),
      ),
    });
  }

  async addClientDefaultScope(_realm: string, _clientId: string, _scopeId: string) {
    this.mutations.push('add-default-scope');
    if (!this.corruptAfterAssign) this.accountConsole.defaultClientScopes.push(expectedScope.name);
  }

  async updateRealm() {
    throw new Error('not used');
  }

  async getRealmRole() {
    throw new Error('not used');
  }

  async getRoleComposites() {
    throw new Error('not used');
  }

  async addRoleComposites() {
    throw new Error('not used');
  }
}

describe('Keycloak Account Console binding', () => {
  it('backs up, creates the bounded scope, assigns it, and verifies the result', async () => {
    const admin = new FakeAccountConsoleAdmin();
    const backup = vi.fn(async () => {
      expect(admin.mutations).toEqual([]);
    });

    await expect(reconcileKeycloakAccountConsole({ admin, realmImport, backup })).resolves.toEqual({
      outcome: 'updated',
    });

    expect(backup).toHaveBeenCalledOnce();
    expect(admin.mutations).toEqual(['create-client-scope', 'add-default-scope']);
    await expect(verifyKeycloakAccountConsole({ admin, realmImport })).resolves.toEqual({
      outcome: 'ready',
    });
  });

  it('is idempotent and rejects an incompatible pre-existing scope before mutation', async () => {
    const admin = new FakeAccountConsoleAdmin();
    admin.clientScopes.push({ ...structuredClone(expectedScope), id: 'account-console-scope-id' });
    admin.accountConsole.defaultClientScopes.push(expectedScope.name);

    await expect(
      reconcileKeycloakAccountConsole({
        admin,
        realmImport,
        backup: async () => {
          throw new Error('must not back up an already-applied binding');
        },
      }),
    ).resolves.toEqual({ outcome: 'already-applied' });
    expect(admin.mutations).toEqual([]);

    const drifted = new FakeAccountConsoleAdmin();
    drifted.clientScopes.push({
      ...structuredClone(expectedScope),
      id: 'account-console-scope-id',
      protocolMappers: [],
    });
    await expect(
      reconcileKeycloakAccountConsole({
        admin: drifted,
        realmImport,
        backup: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_REALM_INCOMPATIBLE' });
    expect(drifted.mutations).toEqual([]);
  });

  it('fails closed when the post-check cannot observe the assignment', async () => {
    const admin = new FakeAccountConsoleAdmin();
    admin.corruptAfterAssign = true;

    await expect(
      reconcileKeycloakAccountConsole({
        admin,
        realmImport,
        backup: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_REALM_POSTCHECK_FAILED' });
  });
});
