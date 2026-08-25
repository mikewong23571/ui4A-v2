import { fail, object, type RealmImportRepresentation } from './realm-contract';

export interface KeycloakAdmin {
  getRealm(realm: string): Promise<Record<string, unknown> | undefined>;
  getClients(realm: string): Promise<Array<Record<string, unknown>>>;
  importRealm(realm: RealmImportRepresentation): Promise<void>;
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

export function createKeycloakAdminClient(input: AdminClientInput): KeycloakAdmin {
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
      return body as Array<Record<string, unknown>>;
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
  };
}
