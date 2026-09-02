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
  offlineSessionIdleTimeout: 7776000;
  offlineSessionMaxLifespanEnabled: true;
  offlineSessionMaxLifespan: 15552000;
  attributes: { 'ui4a.experimental.contract.version': '2' };
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
  | 'KEYCLOAK_REALM_BACKUP_FAILED'
  | 'KEYCLOAK_REALM_POSTCHECK_FAILED'
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

type JsonObject = Record<string, unknown>;

export const managedClientIds = ['ui4a-web', 'ui4a-agent', 'ui4a-cli', 'ui4a-api'] as const;
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
export const expectedClientScopeAssignments: Record<
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
  'ui4a-cli': {
    defaults: ['ui4a:read', 'ui4a:write'],
    optional: ['offline_access', ...policyScopes],
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

export function fail(code: KeycloakBootstrapErrorCode, message: string): never {
  throw new KeycloakBootstrapError(code, message);
}

export function object(input: unknown): JsonObject | undefined {
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
    new Set([
      'realm',
      'enabled',
      'offlineSessionIdleTimeout',
      'offlineSessionMaxLifespanEnabled',
      'offlineSessionMaxLifespan',
      'attributes',
      'clients',
      'clientScopes',
      'users',
    ]),
    'realm import',
  );
  if (root.realm !== 'ui4a' || root.enabled !== true || !Array.isArray(root.clients)) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define the enabled ui4a realm');
  }
  if (
    root.offlineSessionIdleTimeout !== 7_776_000 ||
    root.offlineSessionMaxLifespanEnabled !== true ||
    root.offlineSessionMaxLifespan !== 15_552_000
  ) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import offline lifetime is incompatible');
  }
  if (root.clients.length !== managedClientIds.length) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import must define exactly four clients');
  }
  const realmAttributes = stringRecord(root.attributes, 'realm import attributes');
  if (
    Object.keys(realmAttributes).length !== 1 ||
    realmAttributes['ui4a.experimental.contract.version'] !== '2'
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
  const user = requiredObject(root.users[0], 'users[0]');
  exactKeys(user, new Set(['username', 'enabled', 'realmRoles', 'credentials']), 'users[0]');
  if (user.username !== 'ui4a-experiment-human' || user.enabled !== true) {
    fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import experimental user is incompatible');
  }
  exactStringArray(user.realmRoles, ['offline_access'], 'users[0].realmRoles');

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

export function renderCompatibilityRealmImport(
  input: RealmImportRepresentation,
  publicOrigin: string,
  trustedRequestOrigins: readonly string[],
): RealmImportRepresentation {
  const origin = httpsOrigin(publicOrigin, 'public origin');
  const browserOrigins = trustedRequestOrigins.map((candidate) =>
    httpsOrigin(candidate, 'trusted request origin'),
  );
  if (
    browserOrigins.length === 0 ||
    new Set(browserOrigins).size !== browserOrigins.length ||
    !browserOrigins.includes(origin)
  ) {
    fail(
      'KEYCLOAK_REALM_IMPORT_INVALID',
      'trusted request origins must be unique and contain public origin',
    );
  }
  const validated = validateRealmImport(input);
  const rendered = mapJson(validated, (value) => {
    const rendered = value.replaceAll('{{UI4A_ORIGIN}}', origin);
    const withoutSecrets = rendered.replace(/\{\{secret:[a-z][a-z0-9-]*\}\}/g, '');
    if (/\{\{[^{}]+\}\}/.test(withoutSecrets)) {
      fail('KEYCLOAK_REALM_IMPORT_INVALID', 'realm import contains an unsupported placeholder');
    }
    return rendered;
  }) as RealmImportRepresentation;
  const web = rendered.clients.find(({ clientId }) => clientId === 'ui4a-web')!;
  web.redirectUris = browserOrigins.map((browserOrigin) => `${browserOrigin}/api/auth/callback`);
  web.attributes = {
    ...web.attributes,
    'post.logout.redirect.uris': browserOrigins
      .map((browserOrigin) => `${browserOrigin}/*`)
      .join('##'),
  };
  return rendered;
}

export function resolveRealmImportSecrets(
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
