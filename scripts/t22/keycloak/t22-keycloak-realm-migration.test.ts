import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { renderCompatibilityRealmImport } from '../../../deploy/keycloak/realm-contract';
import { reconcileKeycloakRealmBrowserOrigins } from '../../../deploy/keycloak/realm-bindings';
import {
  migrateKeycloakRealmV1ToV2,
  type KeycloakRealmMigrationAdmin,
} from '../../../deploy/keycloak/realm-migration';

const publicOrigin = 'https://ui4a.example';
const expected = renderCompatibilityRealmImport(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../deploy/keycloak/realm-import.json'),
      'utf8',
    ),
  ),
  publicOrigin,
  [publicOrigin],
);

function sourceClient(clientId: string): Record<string, unknown> {
  const source = expected.clients.find((candidate) => candidate.clientId === clientId)!;
  return {
    ...structuredClone(source),
    id: `${clientId}-id`,
    bearerOnly: source.bearerOnly ?? false,
    secret: undefined,
  };
}

class FakeMigrationAdmin implements KeycloakRealmMigrationAdmin {
  readonly mutations: string[] = [];
  realm: Record<string, unknown> = {
    realm: 'ui4a',
    enabled: true,
    attributes: { 'ui4a.experimental.contract.version': '1' },
    offlineSessionIdleTimeout: 2_592_000,
    offlineSessionMaxLifespanEnabled: false,
    offlineSessionMaxLifespan: 5_184_000,
    defaultRole: { id: 'default-role-id', name: 'default-roles-ui4a' },
  };
  clients = ['ui4a-web', 'ui4a-agent', 'ui4a-api'].map(sourceClient);
  offlineRole = { id: 'offline-role-id', name: 'offline_access' };
  composites: Array<Record<string, unknown>> = [];
  corruptAfterUpdate = false;

  async getRealm() {
    return structuredClone(this.realm);
  }

  async getClients() {
    return structuredClone(this.clients);
  }

  async importRealm() {
    throw new Error('not used by migration');
  }

  async createClient(_realm: string, client: Record<string, unknown>) {
    this.mutations.push('create-client');
    this.clients.push({ ...structuredClone(client), id: 'ui4a-cli-id', bearerOnly: false });
  }

  async updateClient(_realm: string, clientId: string, client: Record<string, unknown>) {
    this.mutations.push('update-client');
    const index = this.clients.findIndex((candidate) => candidate.id === clientId);
    if (index >= 0) this.clients[index] = structuredClone(client);
  }

  async getClientScopes() {
    return [];
  }

  async createClientScope() {
    throw new Error('not used by the v1 to v2 migration');
  }

  async addClientDefaultScope() {
    throw new Error('not used by the v1 to v2 migration');
  }

  async updateRealm(_realm: string, changes: Record<string, unknown>) {
    this.mutations.push('update-realm');
    this.realm = { ...this.realm, ...structuredClone(changes) };
    if (this.corruptAfterUpdate) this.realm.offlineSessionIdleTimeout = 1;
  }

  async getRealmRole() {
    return structuredClone(this.offlineRole);
  }

  async getRoleComposites() {
    return structuredClone(this.composites);
  }

  async addRoleComposites(_realm: string, _roleId: string, roles: Record<string, unknown>[]) {
    this.mutations.push('add-offline-role');
    this.composites.push(...structuredClone(roles));
  }
}

describe('Keycloak realm v1 to v2 additive migration', () => {
  it('backs up before adding CLI/role/timeouts and passes an exact v2 post-check', async () => {
    const admin = new FakeMigrationAdmin();
    const backup = vi.fn(async () => {
      expect(admin.mutations).toEqual([]);
    });

    await expect(
      migrateKeycloakRealmV1ToV2({ admin, realmImport: expected, publicOrigin, backup }),
    ).resolves.toMatchObject({ outcome: 'migrated', fromVersion: '1', toVersion: '2' });

    expect(backup).toHaveBeenCalledTimes(1);
    expect(admin.mutations).toEqual(['create-client', 'add-offline-role', 'update-realm']);
    expect(admin.realm).toMatchObject({
      offlineSessionIdleTimeout: 7_776_000,
      offlineSessionMaxLifespanEnabled: true,
      offlineSessionMaxLifespan: 15_552_000,
      attributes: { 'ui4a.experimental.contract.version': '2' },
    });
  });

  it('is idempotent after v2 and resumes a bounded partial v1 apply', async () => {
    const admin = new FakeMigrationAdmin();
    admin.clients.push({ ...sourceClient('ui4a-cli'), id: 'ui4a-cli-id' });
    admin.composites.push(admin.offlineRole);

    await expect(
      migrateKeycloakRealmV1ToV2({
        admin,
        realmImport: expected,
        publicOrigin,
        backup: async () => {},
      }),
    ).resolves.toMatchObject({ outcome: 'migrated' });
    expect(admin.mutations).toEqual(['update-realm']);
    admin.mutations.length = 0;

    await expect(
      migrateKeycloakRealmV1ToV2({
        admin,
        realmImport: expected,
        publicOrigin,
        backup: async () => {
          throw new Error('must not back up an already-applied migration');
        },
      }),
    ).resolves.toMatchObject({ outcome: 'already-applied' });
    expect(admin.mutations).toEqual([]);
  });

  it('fails before backup/mutation on source drift or backup failure', async () => {
    const drifted = new FakeMigrationAdmin();
    const web = drifted.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
    web.standardFlowEnabled = false;
    const driftBackup = vi.fn(async () => {});
    await expect(
      migrateKeycloakRealmV1ToV2({
        admin: drifted,
        realmImport: expected,
        publicOrigin,
        backup: driftBackup,
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_REALM_INCOMPATIBLE' });
    expect(driftBackup).not.toHaveBeenCalled();
    expect(drifted.mutations).toEqual([]);

    const backupFailed = new FakeMigrationAdmin();
    await expect(
      migrateKeycloakRealmV1ToV2({
        admin: backupFailed,
        realmImport: expected,
        publicOrigin,
        backup: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_REALM_BACKUP_FAILED' });
    expect(backupFailed.mutations).toEqual([]);
  });

  it('fails closed when the post-check does not match v2', async () => {
    const admin = new FakeMigrationAdmin();
    admin.corruptAfterUpdate = true;
    await expect(
      migrateKeycloakRealmV1ToV2({
        admin,
        realmImport: expected,
        publicOrigin,
        backup: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_REALM_POSTCHECK_FAILED' });
  });
});

describe('Keycloak browser-origin binding reconciliation', () => {
  function v2Admin(): FakeMigrationAdmin {
    const admin = new FakeMigrationAdmin();
    admin.realm = {
      ...admin.realm,
      attributes: { 'ui4a.experimental.contract.version': '2' },
      offlineSessionIdleTimeout: 7_776_000,
      offlineSessionMaxLifespanEnabled: true,
      offlineSessionMaxLifespan: 15_552_000,
    };
    admin.clients.push({ ...sourceClient('ui4a-cli'), id: 'ui4a-cli-id' });
    admin.composites.push(admin.offlineRole);
    return admin;
  }

  it('backs up and adds the internal callback while retaining the public callback', async () => {
    const admin = v2Admin();
    const backup = vi.fn(async () => {
      expect(admin.mutations).toEqual([]);
    });
    const internalOrigin = 'https://ui4a.home-linux.tail.styleofwong.com';

    await expect(
      reconcileKeycloakRealmBrowserOrigins({
        admin,
        realmImport: expected,
        publicOrigin,
        trustedRequestOrigins: [publicOrigin, internalOrigin],
        backup,
      }),
    ).resolves.toEqual({ outcome: 'updated' });

    expect(backup).toHaveBeenCalledOnce();
    expect(admin.mutations).toEqual(['update-client']);
    const web = admin.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
    expect(web.redirectUris).toEqual([
      `${publicOrigin}/api/auth/callback`,
      `${internalOrigin}/api/auth/callback`,
    ]);
  });

  it('is idempotent and rejects unrelated client drift before mutation', async () => {
    const admin = v2Admin();
    const internalOrigin = 'https://ui4a.home-linux.tail.styleofwong.com';
    const input = {
      admin,
      realmImport: expected,
      publicOrigin,
      trustedRequestOrigins: [publicOrigin, internalOrigin],
      backup: async () => {},
    };
    await reconcileKeycloakRealmBrowserOrigins(input);
    admin.mutations.length = 0;
    await expect(reconcileKeycloakRealmBrowserOrigins(input)).resolves.toEqual({
      outcome: 'already-applied',
    });
    expect(admin.mutations).toEqual([]);

    const drifted = v2Admin();
    drifted.clients.find(({ clientId }) => clientId === 'ui4a-web')!.standardFlowEnabled = false;
    await expect(
      reconcileKeycloakRealmBrowserOrigins({ ...input, admin: drifted }),
    ).rejects.toMatchObject({ code: 'KEYCLOAK_REALM_INCOMPATIBLE' });
    expect(drifted.mutations).toEqual([]);
  });
});
