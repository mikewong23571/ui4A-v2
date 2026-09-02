import { describe, expect, it, vi } from 'vitest';

import { createKeycloakAdminClient } from '../../../deploy/keycloak/realm-admin';

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Keycloak migration Admin client', () => {
  it('uses authenticated bounded endpoints for client, realm, and role-composite changes', async () => {
    const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      requests.push({
        method,
        path: url.pathname,
        authorization: new Headers(init?.headers).get('authorization'),
      });
      if (url.pathname === '/realms/master/protocol/openid-connect/token') {
        return response({ access_token: 'admin-token', token_type: 'Bearer', expires_in: 60 });
      }
      if (url.pathname.endsWith('/roles/offline_access')) {
        return response({ id: 'offline-role-id', name: 'offline_access' });
      }
      if (method === 'GET' && url.pathname.endsWith('/client-scopes')) return response([]);
      if (method === 'GET' && url.pathname.endsWith('/composites')) return response([]);
      if (method === 'POST' && url.pathname.endsWith('/clients')) return response(null, 201);
      if (method === 'POST' && url.pathname.endsWith('/client-scopes')) {
        return response(null, 201);
      }
      return response(null, 204);
    });
    const admin = createKeycloakAdminClient({
      baseUrl: 'https://auth.ui4a.internal:9443',
      adminUsername: 'bootstrap-admin',
      adminPassword: 'bootstrap-password',
      fetch: fetcher,
      timeoutMs: 1_000,
    });

    await admin.createClient('ui4a', { clientId: 'ui4a-cli' });
    await expect(admin.getClientScopes('ui4a')).resolves.toEqual([]);
    await admin.createClientScope('ui4a', { name: 'ui4a:account-console' });
    await admin.addClientDefaultScope('ui4a', 'account-console-id', 'account-console-scope-id');
    await admin.updateRealm('ui4a', { offlineSessionIdleTimeout: 7_776_000 });
    await expect(admin.getRealmRole('ui4a', 'offline_access')).resolves.toMatchObject({
      name: 'offline_access',
    });
    await expect(admin.getRoleComposites('ui4a', 'default-role-id')).resolves.toEqual([]);
    await admin.addRoleComposites('ui4a', 'default-role-id', [
      { id: 'offline-role-id', name: 'offline_access' },
    ]);

    const adminRequests = requests.filter((request) => request.path.startsWith('/admin/'));
    expect(adminRequests).toHaveLength(8);
    expect(adminRequests.every(({ authorization }) => authorization === 'Bearer admin-token')).toBe(
      true,
    );
    expect(adminRequests.map(({ method, path }) => `${method}:${path}`)).toEqual([
      'POST:/admin/realms/ui4a/clients',
      'GET:/admin/realms/ui4a/client-scopes',
      'POST:/admin/realms/ui4a/client-scopes',
      'PUT:/admin/realms/ui4a/clients/account-console-id/default-client-scopes/account-console-scope-id',
      'PUT:/admin/realms/ui4a',
      'GET:/admin/realms/ui4a/roles/offline_access',
      'GET:/admin/realms/ui4a/roles-by-id/default-role-id/composites',
      'POST:/admin/realms/ui4a/roles-by-id/default-role-id/composites',
    ]);
    expect(requests.map(({ path }) => path).join(' ')).not.toMatch(
      /bootstrap-password|admin-token/,
    );
  });
});
