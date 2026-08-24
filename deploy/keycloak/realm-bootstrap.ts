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
  defaultClientScopes: string[];
  optionalClientScopes: string[];
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
  attributes: { 'ui4a.experimental.contract.version': '1' };
  clients: RealmClientRepresentation[];
  clientScopes: RealmClientScopeRepresentation[];
  users?: Array<Record<string, unknown>>;
}

interface RealmClientScopeRepresentation extends Record<string, unknown> {
  name: string;
  protocol: 'openid-connect';
  attributes: { 'include.in.token.scope': 'true' };
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
const permissionScopes = ['ui4a:read', 'ui4a:write', 'ui4a:approve'] as const;
const policyScopes = [
  'ui4a:policy:default',
  'ui4a:policy:publishing',
  'ui4a:policy:community',
  'ui4a:policy:development',
  'ui4a:policy:editorial',
  'ui4a:policy:governance',
] as const;
const managedClientScopes = [...permissionScopes, ...policyScopes] as const;
const expectedClientScopeAssignments: Record<
  (typeof managedClientIds)[number],
  { defaults: readonly string[]; optional: readonly string[] }
> = {
  'ui4a-web': {
    defaults: permissionScopes,
    optional: policyScopes,
  },
  'ui4a-agent': {
    defaults: ['ui4a:read', 'ui4a:write'],
    optional: policyScopes,
  },
  'ui4a-api': {
    defaults: ['ui4a:read'],
    optional: ['ui4a:write', 'ui4a:approve', ...policyScopes],
  },
};
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
  'defaultClientScopes',
  'optionalClientScopes',
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

function exactStringArray(input: unknown, expected: readonly string[], label: string): string[] {
  if (!Array.isArray(input) || input.some((entry) => typeof entry !== 'string')) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', `${label} must contain only strings`);
  }
  const values = input as string[];
  const sortedExpected = [...expected].sort();
  if (
    values.length !== sortedExpected.length ||
    [...values].sort().some((entry, index) => entry !== sortedExpected[index])
  ) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', `${label} is incompatible`);
  }
  return values;
}

function validateRealmImport(input: unknown): RealmImportRepresentation {
  const root = requiredObject(input, 'realm import');
  exactKeys(
    root,
    new Set(['realm', 'enabled', 'attributes', 'clients', 'clientScopes', 'users']),
    'realm import',
  );
  if (root.realm !== 'ui4a' || root.enabled !== true || !Array.isArray(root.clients)) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define the enabled ui4a realm');
  }
  if (root.clients.length !== managedClientIds.length) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define exactly three clients');
  }
  const realmAttributes = stringRecord(root.attributes, 'realm import attributes');
  if (
    Object.keys(realmAttributes).length !== 1 ||
    realmAttributes['ui4a.experimental.contract.version'] !== '1'
  ) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import contract version is incompatible');
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
    const expectedScopes =
      expectedClientScopeAssignments[client.clientId as (typeof managedClientIds)[number]];
    if (expectedScopes !== undefined) {
      exactStringArray(
        client.defaultClientScopes,
        expectedScopes.defaults,
        `clients[${index}].defaultClientScopes`,
      );
      exactStringArray(
        client.optionalClientScopes,
        expectedScopes.optional,
        `clients[${index}].optionalClientScopes`,
      );
    }
    return client as RealmClientRepresentation;
  });

  const ids = clients.map(({ clientId }) => clientId).sort();
  if (ids.join(',') !== [...managedClientIds].sort().join(',')) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import client identifiers are incompatible');
  }
  if (!Array.isArray(root.clientScopes)) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define fixed client scopes');
  }
  exactStringArray(
    root.clientScopes.map((candidate) => object(candidate)?.name),
    managedClientScopes,
    'realm import client scope names',
  );
  root.clientScopes.forEach((candidate, index) => {
    const scope = requiredObject(candidate, `clientScopes[${index}]`);
    exactKeys(scope, new Set(['name', 'protocol', 'attributes']), `clientScopes[${index}]`);
    const attributes = stringRecord(scope.attributes, `clientScopes[${index}].attributes`);
    if (
      typeof scope.name !== 'string' ||
      scope.protocol !== 'openid-connect' ||
      attributes['include.in.token.scope'] !== 'true' ||
      Object.keys(attributes).length !== 1
    ) {
      fail('KEYCLOAK_REALM_IMPORT_INVALID', `clientScopes[${index}] has an invalid contract`);
    }
  });
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

function hasExactAccessTokenSubjectMapper(client: Record<string, unknown>): boolean {
  const mappers = Array.isArray(client.protocolMappers) ? client.protocolMappers : [];
  const subjects = mappers.filter((candidate) => {
    const mapper = object(candidate);
    return mapper?.name === 'subject' || mapper?.protocolMapper === 'oidc-sub-mapper';
  });
  if (subjects.length !== 1) return false;

  const mapper = object(subjects[0]);
  const config = object(mapper?.config);
  return (
    mapper?.name === 'subject' &&
    mapper.protocol === 'openid-connect' &&
    mapper.protocolMapper === 'oidc-sub-mapper' &&
    config !== undefined &&
    Object.keys(config).length === 5 &&
    config['access.token.claim'] === 'true' &&
    config['introspection.token.claim'] === 'true' &&
    config['lightweight.claim'] === 'true' &&
    config['id.token.claim'] === 'false' &&
    config['userinfo.token.claim'] === 'false'
  );
}

function sameStringSet(input: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(input) &&
    input.every((entry) => typeof entry === 'string') &&
    input.length === expected.length &&
    [...input].sort().every((entry, index) => entry === [...expected].sort()[index])
  );
}

function compatibleRealm(
  realm: Record<string, unknown>,
  clients: Array<Record<string, unknown>>,
  expected: RealmImportRepresentation,
): boolean {
  const realmAttributes = object(realm.attributes);
  if (
    realm.enabled !== true ||
    realmAttributes?.['ui4a.experimental.contract.version'] !==
      expected.attributes['ui4a.experimental.contract.version']
  ) {
    return false;
  }
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
  const expectedWebAttributes = expectedWeb.attributes!;
  if (
    web.enabled !== true ||
    web.publicClient !== false ||
    web.bearerOnly !== false ||
    web.standardFlowEnabled !== true ||
    web.serviceAccountsEnabled !== false ||
    web.directAccessGrantsEnabled !== false ||
    webAttributes?.['pkce.code.challenge.method'] !== 'S256' ||
    webAttributes['post.logout.redirect.uris'] !==
      expectedWebAttributes['post.logout.redirect.uris'] ||
    !sameStringSet(web.defaultClientScopes, expectedClientScopeAssignments['ui4a-web'].defaults) ||
    !sameStringSet(web.optionalClientScopes, expectedClientScopeAssignments['ui4a-web'].optional) ||
    !hasExactAccessTokenSubjectMapper(web) ||
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
    agent.bearerOnly !== false ||
    agent.standardFlowEnabled !== false ||
    agent.serviceAccountsEnabled !== true ||
    agent.directAccessGrantsEnabled !== false ||
    agentAttributes?.['standard.token.exchange.enabled'] !== 'true' ||
    !sameStringSet(
      agent.defaultClientScopes,
      expectedClientScopeAssignments['ui4a-agent'].defaults,
    ) ||
    !sameStringSet(
      agent.optionalClientScopes,
      expectedClientScopeAssignments['ui4a-agent'].optional,
    ) ||
    !hasAccessTokenAudience(agent, 'ui4a-api')
  ) {
    return false;
  }

  const api = byId.get('ui4a-api')!;
  return (
    api.enabled === true &&
    api.publicClient === false &&
    api.bearerOnly === true &&
    api.standardFlowEnabled === false &&
    api.serviceAccountsEnabled === false &&
    api.directAccessGrantsEnabled === false &&
    sameStringSet(api.defaultClientScopes, expectedClientScopeAssignments['ui4a-api'].defaults) &&
    sameStringSet(api.optionalClientScopes, expectedClientScopeAssignments['ui4a-api'].optional)
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
