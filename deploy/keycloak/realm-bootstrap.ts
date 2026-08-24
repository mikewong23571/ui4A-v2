export interface RealmClientRepresentation extends Record<string, unknown> {
  clientId: string;
  enabled: boolean;
  publicClient: boolean;
  bearerOnly?: boolean;
  standardFlowEnabled: boolean;
  serviceAccountsEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  redirectUris?: string[];
  attributes?: Record<string, string>;
  secret?: string;
  protocolMappers?: Array<{
    name: string;
    protocol: string;
    protocolMapper: string;
    config: Record<string, string>;
  }>;
}

export interface RealmImportRepresentation extends Record<string, unknown> {
  realm: string;
  enabled: boolean;
  clients: RealmClientRepresentation[];
  users?: Array<Record<string, unknown>>;
}

export interface BootstrapResult {
  outcome: 'imported' | 'skip' | 'absent';
  summary: string;
}

export type KeycloakBootstrapErrorCode =
  | 'KEYCLOAK_REALM_IMPORT_INVALID'
  | 'KEYCLOAK_REALM_INCOMPATIBLE'
  | 'KEYCLOAK_BOOTSTRAP_ADMIN_REQUEST_FAILED'
  | 'KEYCLOAK_BOOTSTRAP_TIMEOUT'
  | 'KEYCLOAK_BOOTSTRAP_INVALID_RESPONSE';

export class KeycloakBootstrapError extends Error {
  constructor(
    readonly code: KeycloakBootstrapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KeycloakBootstrapError';
  }
}

interface KeycloakAdmin {
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

interface BootstrapInput {
  admin: unknown;
  realmImport: RealmImportRepresentation;
  publicOrigin: string;
  resolveSecret: (reference: string) => string;
  mode: 'check' | 'apply';
}

type JsonObject = Record<string, unknown>;

const managedClientIds = ['ui4a-web', 'ui4a-agent', 'ui4a-api'] as const;
const clientKeys = new Set([
  'clientId',
  'enabled',
  'publicClient',
  'bearerOnly',
  'standardFlowEnabled',
  'serviceAccountsEnabled',
  'directAccessGrantsEnabled',
  'redirectUris',
  'attributes',
  'secret',
  'protocolMappers',
]);

function fail(code: KeycloakBootstrapErrorCode, message: string): never {
  throw new KeycloakBootstrapError(code, message);
}

function object(input: unknown): JsonObject | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as JsonObject)
    : undefined;
}

function requiredObject(input: unknown, label: string): JsonObject {
  return object(input) ?? fail('KEYCLOAK_REALM_IMPORT_INVALID', `${label} must be an object`);
}

function exactKeys(input: JsonObject, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', `${label} contains an unsupported field`);
  }
}

function stringRecord(input: unknown, label: string): Record<string, string> {
  const value = requiredObject(input, label);
  if (Object.values(value).some((entry) => typeof entry !== 'string')) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', `${label} must contain only strings`);
  }
  return value as Record<string, string>;
}

function validateRealmImport(input: unknown): RealmImportRepresentation {
  const root = requiredObject(input, 'realm import');
  exactKeys(root, new Set(['realm', 'enabled', 'clients', 'users']), 'realm import');
  if (root.realm !== 'ui4a' || root.enabled !== true || !Array.isArray(root.clients)) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define the enabled ui4a realm');
  }
  if (root.clients.length !== managedClientIds.length) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define exactly three clients');
  }

  const clients = root.clients.map((candidate, index) => {
    const client = requiredObject(candidate, `clients[${index}]`);
    exactKeys(client, clientKeys, `clients[${index}]`);
    for (const field of [
      'clientId',
      'enabled',
      'publicClient',
      'standardFlowEnabled',
      'serviceAccountsEnabled',
      'directAccessGrantsEnabled',
    ]) {
      if (!(field in client)) {
        fail('KEYCLOAK_REALM_IMPORT_INVALID', `clients[${index}] is incomplete`);
      }
    }
    if (
      typeof client.clientId !== 'string' ||
      client.enabled !== true ||
      typeof client.publicClient !== 'boolean' ||
      typeof client.standardFlowEnabled !== 'boolean' ||
      typeof client.serviceAccountsEnabled !== 'boolean' ||
      client.directAccessGrantsEnabled !== false
    ) {
      fail('KEYCLOAK_REALM_IMPORT_INVALID', `clients[${index}] has an invalid contract`);
    }
    if (client.attributes !== undefined)
      stringRecord(client.attributes, `clients[${index}].attributes`);
    return client as RealmClientRepresentation;
  });

  const ids = clients.map(({ clientId }) => clientId).sort();
  if (ids.join(',') !== [...managedClientIds].sort().join(',')) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import client identifiers are incompatible');
  }
  if (!Array.isArray(root.users) || root.users.length !== 1) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define one experimental user');
  }

  return root as RealmImportRepresentation;
}

function mapJson(input: unknown, mapString: (value: string) => string): unknown {
  if (Array.isArray(input)) {
    return input.map((entry) => mapJson(entry, mapString));
  }
  const record = object(input);
  if (record !== undefined) {
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, mapJson(value, mapString)]),
    );
  }
  return typeof input === 'string' ? mapString(input) : input;
}

function httpsOrigin(input: string, label: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail('KEYCLOAK_REALM_IMPORT_INVALID', `${label} must be an HTTPS origin`);
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== input ||
    url.username !== '' ||
    url.password !== ''
  ) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', `${label} must be an HTTPS origin`);
  }
  return url.origin;
}

function renderCompatibilityRealmImport(
  input: RealmImportRepresentation,
  publicOrigin: string,
): RealmImportRepresentation {
  const origin = httpsOrigin(publicOrigin, 'public origin');
  const validated = validateRealmImport(input);
  return mapJson(validated, (value) => {
    const rendered = value.replaceAll('{{UI4A_ORIGIN}}', origin);
    const withoutSecrets = rendered.replace(/\{\{secret:[a-z][a-z0-9-]*\}\}/g, '');
    if (/\{\{[^{}]+\}\}/.test(withoutSecrets)) {
      fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import contains an unsupported placeholder');
    }
    return rendered;
  }) as RealmImportRepresentation;
}

function resolveRealmImportSecrets(
  input: RealmImportRepresentation,
  resolveSecret: (reference: string) => string,
): RealmImportRepresentation {
  return mapJson(input, (value) => {
    const rendered = value.replace(
      /\{\{secret:([a-z][a-z0-9-]*)\}\}/g,
      (_match, reference: string) => {
        const secret = resolveSecret(reference);
        if (typeof secret !== 'string' || secret.length === 0) {
          fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import references an unavailable secret');
        }
        return secret;
      },
    );
    if (/\{\{[^{}]+\}\}/.test(rendered)) {
      fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import contains an unresolved placeholder');
    }
    return rendered;
  }) as RealmImportRepresentation;
}

function assertAdmin(input: unknown): asserts input is KeycloakAdmin {
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

function hasAccessTokenAudience(client: Record<string, unknown>, audience: string): boolean {
  const mappers = Array.isArray(client.protocolMappers) ? client.protocolMappers : [];
  return mappers.some((candidate) => {
    const mapper = object(candidate);
    const config = object(mapper?.config);
    return (
      mapper?.protocol === 'openid-connect' &&
      mapper.protocolMapper === 'oidc-audience-mapper' &&
      config?.['included.client.audience'] === audience &&
      config['access.token.claim'] === 'true' &&
      config['id.token.claim'] === 'false'
    );
  });
}

function compatibleRealm(
  realm: Record<string, unknown>,
  clients: Array<Record<string, unknown>>,
  expected: RealmImportRepresentation,
): boolean {
  if (realm.enabled !== true) return false;
  const byId = new Map<string, Record<string, unknown>>();
  for (const candidate of clients) {
    if (
      typeof candidate.clientId !== 'string' ||
      !managedClientIds.includes(candidate.clientId as never)
    ) {
      continue;
    }
    if (byId.has(candidate.clientId)) return false;
    byId.set(candidate.clientId, candidate);
  }
  if (managedClientIds.some((clientId) => !byId.has(clientId))) return false;

  const web = byId.get('ui4a-web')!;
  const expectedWeb = expected.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
  const webAttributes = object(web.attributes);
  if (
    web.enabled !== true ||
    web.publicClient !== false ||
    web.standardFlowEnabled !== true ||
    web.directAccessGrantsEnabled !== false ||
    webAttributes?.['pkce.code.challenge.method'] !== 'S256' ||
    !hasAccessTokenAudience(web, 'ui4a-api') ||
    !hasAccessTokenAudience(web, 'ui4a-agent') ||
    !Array.isArray(web.redirectUris) ||
    web.redirectUris.length !== 1 ||
    web.redirectUris[0] !== expectedWeb.redirectUris?.[0]
  ) {
    return false;
  }

  const agent = byId.get('ui4a-agent')!;
  const agentAttributes = object(agent.attributes);
  if (
    agent.enabled !== true ||
    agent.publicClient !== false ||
    agent.serviceAccountsEnabled !== true ||
    agent.directAccessGrantsEnabled !== false ||
    agentAttributes?.['standard.token.exchange.enabled'] !== 'true' ||
    !hasAccessTokenAudience(agent, 'ui4a-api')
  ) {
    return false;
  }

  const api = byId.get('ui4a-api')!;
  return (
    api.enabled === true &&
    api.publicClient === false &&
    api.bearerOnly === true &&
    api.directAccessGrantsEnabled === false
  );
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
  if (!compatibleRealm(existingRealm, clients, compatibilityView)) {
    fail(
      'KEYCLOAK_REALM_INCOMPATIBLE',
      'The existing ui4a realm is incompatible; back it up and replace or rebuild it.',
    );
  }
  return { outcome: 'skip', summary: 'The existing ui4a realm is compatible; no changes made.' };
}
