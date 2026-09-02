import { fail, object, type RealmImportRepresentation } from './realm-contract';

export interface KeycloakAdmin {
  getRealm(realm: string): Promise<Record<string, unknown> | undefined>;
  getClients(realm: string): Promise<Array<Record<string, unknown>>>;
  importRealm(realm: RealmImportRepresentation): Promise<void>;
}

export interface KeycloakRealmMigrationAdmin extends KeycloakAdmin {
  createClient(realm: string, client: Record<string, unknown>): Promise<void>;
  updateClient(realm: string, clientId: string, client: Record<string, unknown>): Promise<void>;
  getClientScopes(realm: string): Promise<Array<Record<string, unknown>>>;
  createClientScope(realm: string, scope: Record<string, unknown>): Promise<void>;
  addClientDefaultScope(realm: string, clientId: string, scopeId: string): Promise<void>;
  updateRealm(realm: string, changes: Record<string, unknown>): Promise<void>;
  getRealmRole(realm: string, role: string): Promise<Record<string, unknown>>;
  getRoleComposites(realm: string, roleId: string): Promise<Array<Record<string, unknown>>>;
  addRoleComposites(
    realm: string,
    roleId: string,
    roles: Array<Record<string, unknown>>,
  ): Promise<void>;
}

interface AdminClientInput {
  baseUrl: string;
  adminUsername: string;
  adminPassword: string;
  fetch: typeof fetch;
  timeoutMs: number;
}

export function assertAdmin(input: unknown): asserts input is KeycloakAdmin {
  const candidate = object(input);
  if (
    candidate === undefined ||
    typeof candidate.getRealm !== 'function' ||
    typeof candidate.getClients !== 'function' ||
    typeof candidate.importRealm !== 'function'
  ) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'Keycloak Admin client is invalid');
  }
}

export function assertMigrationAdmin(input: unknown): asserts input is KeycloakRealmMigrationAdmin {
  assertAdmin(input);
  const candidate = input as Partial<KeycloakRealmMigrationAdmin>;
  if (
    typeof candidate.createClient !== 'function' ||
    typeof candidate.updateClient !== 'function' ||
    typeof candidate.getClientScopes !== 'function' ||
    typeof candidate.createClientScope !== 'function' ||
    typeof candidate.addClientDefaultScope !== 'function' ||
    typeof candidate.updateRealm !== 'function' ||
    typeof candidate.getRealmRole !== 'function' ||
    typeof candidate.getRoleComposites !== 'function' ||
    typeof candidate.addRoleComposites !== 'function'
  ) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'Keycloak migration Admin client is invalid');
  }
}

export function createKeycloakAdminClient(input: AdminClientInput): KeycloakRealmMigrationAdmin {
  let baseUrl: URL;
  try {
    baseUrl = new URL(input.baseUrl);
  } catch {
    return fail('KEYCLOAK_REALM_IMPORT_INVALID', 'Keycloak base URL must be absolute');
  }
  if (
    baseUrl.protocol !== 'https:' ||
    baseUrl.pathname !== '/' ||
    baseUrl.search !== '' ||
    baseUrl.hash !== '' ||
    baseUrl.username !== '' ||
    baseUrl.password !== '' ||
    input.timeoutMs <= 0
  ) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'Keycloak Admin client configuration is invalid');
  }
  const origin = baseUrl.origin;
  let accessToken: string | undefined;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/admin/realms')) {
      fail('KEYCLOAK_REALM_IMPORT_INVALID', 'Keycloak Admin path is invalid');
    }
    const signal = AbortSignal.timeout(input.timeoutMs);
    try {
      return await input.fetch(url, { ...init, redirect: 'error', signal });
    } catch {
      if (signal.aborted) fail('KEYCLOAK_BOOTSTRAP_TIMEOUT', 'Keycloak Admin request timed out');
      return fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
    }
  }

  async function json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid');
    }
  }

  async function authenticate(): Promise<string> {
    if (accessToken !== undefined) return accessToken;
    const signal = AbortSignal.timeout(input.timeoutMs);
    let response: Response;
    try {
      response = await input.fetch(
        new URL('/realms/master/protocol/openid-connect/token', origin),
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'password',
            client_id: 'admin-cli',
            username: input.adminUsername,
            password: input.adminPassword,
          }),
          redirect: 'error',
          signal,
        },
      );
    } catch {
      if (signal.aborted) fail('KEYCLOAK_BOOTSTRAP_TIMEOUT', 'Keycloak Admin request timed out');
      return fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
    }
    if (!response.ok) {
      fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
    }
    const body = object(await json(response));
    if (body === undefined || typeof body.access_token !== 'string' || body.access_token === '') {
      fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid');
    }
    accessToken = body.access_token;
    return accessToken;
  }

  async function authorized(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await authenticate();
    return request(path, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
  }

  return {
    async getRealm(realm) {
      const response = await authorized(`/admin/realms/${encodeURIComponent(realm)}`);
      if (response.status === 404) return undefined;
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
      const body = object(await json(response));
      return (
        body ?? fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid')
      );
    },
    async getClients(realm) {
      const response = await authorized(`/admin/realms/${encodeURIComponent(realm)}/clients`);
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
      const body = await json(response);
      if (!Array.isArray(body) || body.some((entry) => object(entry) === undefined)) {
        fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid');
      }
      // 列表视图省略默认值级 mapper 配置(如 userinfo.token.claim),兼容性判定必须
      // 基于完整表示:逐个取回详情(verified against Keycloak 26 list behavior)。
      const full: Array<Record<string, unknown>> = [];
      for (const entry of body as Array<Record<string, unknown>>) {
        if (typeof entry.id !== 'string' || entry.id === '') {
          fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid');
        }
        const detail = await authorized(
          `/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(entry.id)}`,
        );
        if (!detail.ok) {
          fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
        }
        const detailBody = object(await json(detail));
        full.push(
          detailBody ??
            fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid'),
        );
      }
      return full;
    },
    async importRealm(realm) {
      const response = await authorized('/admin/realms', {
        method: 'POST',
        body: JSON.stringify(realm),
      });
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
    },
    async createClient(realm, client) {
      const response = await authorized(`/admin/realms/${encodeURIComponent(realm)}/clients`, {
        method: 'POST',
        body: JSON.stringify(client),
      });
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
    },
    async updateClient(realm, clientId, client) {
      const response = await authorized(
        `/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientId)}`,
        { method: 'PUT', body: JSON.stringify(client) },
      );
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
    },
    async getClientScopes(realm) {
      const response = await authorized(`/admin/realms/${encodeURIComponent(realm)}/client-scopes`);
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
      const body = await json(response);
      if (!Array.isArray(body) || body.some((entry) => object(entry) === undefined)) {
        fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid');
      }
      return body as Array<Record<string, unknown>>;
    },
    async createClientScope(realm, scope) {
      const response = await authorized(
        `/admin/realms/${encodeURIComponent(realm)}/client-scopes`,
        { method: 'POST', body: JSON.stringify(scope) },
      );
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
    },
    async addClientDefaultScope(realm, clientId, scopeId) {
      const response = await authorized(
        `/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientId)}/default-client-scopes/${encodeURIComponent(scopeId)}`,
        { method: 'PUT' },
      );
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
    },
    async updateRealm(realm, changes) {
      const response = await authorized(`/admin/realms/${encodeURIComponent(realm)}`, {
        method: 'PUT',
        body: JSON.stringify(changes),
      });
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
    },
    async getRealmRole(realm, role) {
      const response = await authorized(
        `/admin/realms/${encodeURIComponent(realm)}/roles/${encodeURIComponent(role)}`,
      );
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
      return (
        object(await json(response)) ??
        fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid')
      );
    },
    async getRoleComposites(realm, roleId) {
      const response = await authorized(
        `/admin/realms/${encodeURIComponent(realm)}/roles-by-id/${encodeURIComponent(roleId)}/composites`,
      );
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
      const body = await json(response);
      if (!Array.isArray(body) || body.some((entry) => object(entry) === undefined)) {
        fail('KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE', 'Keycloak Admin response was invalid');
      }
      return body as Array<Record<string, unknown>>;
    },
    async addRoleComposites(realm, roleId, roles) {
      const response = await authorized(
        `/admin/realms/${encodeURIComponent(realm)}/roles-by-id/${encodeURIComponent(roleId)}/composites`,
        { method: 'POST', body: JSON.stringify(roles) },
      );
      if (!response.ok) {
        fail('KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED', 'Keycloak Admin request failed');
      }
    },
  };
}
