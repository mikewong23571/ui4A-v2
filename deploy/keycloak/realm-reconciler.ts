export type RealmRoleName = 'ui4a-human' | 'ui4a-agent' | 'ui4a-service';

export interface RealmClientContract {
  clientId: string;
  clientKind: 'browser' | 'service-account' | 'resource-server';
  confidential: boolean;
  standardFlowEnabled: boolean;
  serviceAccountsEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  pkceCodeChallengeMethod?: string;
  redirectUris?: string[];
  postLogoutRedirectUris?: string[];
  secretRef?: string;
  standardTokenExchangeEnabled?: boolean;
  audiences: string[];
  defaultScopes: string[];
  optionalScopes: string[];
}

export interface KeycloakRealmContract {
  schemaVersion: number;
  keycloakVersion: string;
  realm: { name: string; enabled: boolean };
  protocolScopes: string[];
  clientScopes: Array<{ name: string; kind: 'permission' | 'policy' }>;
  clients: RealmClientContract[];
  roles: Array<{
    name: RealmRoleName;
    scopes: string[];
    humanApprovalEligible: boolean;
  }>;
  fixtureUsers: Array<{
    username: string;
    role: RealmRoleName;
    passwordSecretRef: string;
  }>;
  bearerConsumers: {
    cli: {
      flow: 'externally-provisioned-bearer';
      audience: string;
      dedicatedClient: false;
    };
  };
}

export interface ObservedRealm {
  realm: KeycloakRealmContract['realm'];
  clients: Array<Omit<RealmClientContract, 'secretRef'>>;
  clientScopes: KeycloakRealmContract['clientScopes'];
  roles: KeycloakRealmContract['roles'];
  users: Array<{
    username: string;
    role: string;
    profile: Record<string, string>;
    credentialsConfigured: boolean;
  }>;
  unmanaged: Record<string, unknown>;
}

export interface ReconcileOperation {
  verb: 'create' | 'update';
  kind: 'realm' | 'client' | 'client-scope' | 'realm-role' | 'user';
  id: string;
  secretRef?: string;
  changedFields?: string[];
}

export interface ReconcilePlan {
  outcome: 'create' | 'noop' | 'update';
  operations: ReconcileOperation[];
  summary: string;
}

type JsonObject = Record<string, unknown>;

const rootKeys = [
  'schemaVersion',
  'keycloakVersion',
  'realm',
  'protocolScopes',
  'clientScopes',
  'clients',
  'roles',
  'fixtureUsers',
  'bearerConsumers',
] as const;

const clientKeys = [
  'clientId',
  'clientKind',
  'confidential',
  'standardFlowEnabled',
  'serviceAccountsEnabled',
  'directAccessGrantsEnabled',
  'pkceCodeChallengeMethod',
  'redirectUris',
  'postLogoutRedirectUris',
  'secretRef',
  'standardTokenExchangeEnabled',
  'audiences',
  'defaultScopes',
  'optionalScopes',
] as const;

const requiredClientKeys = [
  'clientId',
  'clientKind',
  'confidential',
  'standardFlowEnabled',
  'serviceAccountsEnabled',
  'directAccessGrantsEnabled',
  'audiences',
  'defaultScopes',
  'optionalScopes',
] as const;

const permissionScopes = ['ui4a:read', 'ui4a:write', 'ui4a:approve'] as const;
const policyScopes = [
  'default',
  'publishing',
  'community',
  'development',
  'editorial',
  'governance',
] as const;
const roleNames = ['ui4a-human', 'ui4a-agent', 'ui4a-service'] as const;

function invalid(path: string, reason: string): never {
  throw new Error(`Invalid Keycloak realm contract at ${path}: ${reason}`);
}

function objectAt(input: unknown, path: string): JsonObject {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalid(path, 'expected object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, 'expected plain object');
  }
  return input as JsonObject;
}

function exactKeys(
  input: JsonObject,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(input)
    .filter((key) => !allowed.includes(key))
    .sort();
  if (unknown.length > 0) invalid(path, 'unknown field');
  const missing = required.filter((key) => !Object.hasOwn(input, key)).sort();
  if (missing.length > 0) invalid(`${path}.${missing[0]}`, 'missing field');
}

function stringAt(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.length === 0) return invalid(path, 'expected string');
  return input;
}

function booleanAt(input: unknown, path: string): boolean {
  if (typeof input !== 'boolean') return invalid(path, 'expected boolean');
  return input;
}

function literalAt<T extends string | number | boolean>(
  input: unknown,
  expected: T,
  path: string,
): T {
  if (input !== expected) invalid(path, 'unexpected value');
  return expected;
}

function enumAt<const T extends readonly string[]>(
  input: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof input !== 'string' || !allowed.includes(input as T[number])) {
    return invalid(path, 'unexpected value');
  }
  return input as T[number];
}

function stringArrayAt(input: unknown, path: string): string[] {
  if (!Array.isArray(input)) return invalid(path, 'expected array');
  const result = input.map((entry, index) => stringAt(entry, `${path}[${index}]`));
  assertUnique(result, path);
  return result;
}

function optionalString(input: JsonObject, key: string, path: string): string | undefined {
  return Object.hasOwn(input, key) ? stringAt(input[key], `${path}.${key}`) : undefined;
}

function optionalBoolean(input: JsonObject, key: string, path: string): boolean | undefined {
  return Object.hasOwn(input, key) ? booleanAt(input[key], `${path}.${key}`) : undefined;
}

function optionalStringArray(input: JsonObject, key: string, path: string): string[] | undefined {
  return Object.hasOwn(input, key) ? stringArrayAt(input[key], `${path}.${key}`) : undefined;
}

function assertUnique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) invalid(path, 'duplicate identifier');
    seen.add(value);
  }
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...values].sort(asciiCompare);
}

function assertSameSet(actual: readonly string[], expected: readonly string[], path: string): void {
  if (actual.length !== expected.length || expected.some((value) => !actual.includes(value))) {
    invalid(path, 'required identifiers do not match');
  }
}

function assertSecretReference(value: string, path: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) invalid(path, 'invalid reference');
}

function parseRealm(input: unknown): KeycloakRealmContract['realm'] {
  const value = objectAt(input, '$.realm');
  exactKeys(value, ['name', 'enabled'], ['name', 'enabled'], '$.realm');
  return {
    name: literalAt(value.name, 'ui4a', '$.realm.name'),
    enabled: literalAt(value.enabled, true, '$.realm.enabled'),
  };
}

function parseClientScope(
  input: unknown,
  index: number,
): KeycloakRealmContract['clientScopes'][number] {
  const path = `$.clientScopes[${index}]`;
  const value = objectAt(input, path);
  exactKeys(value, ['name', 'kind'], ['name', 'kind'], path);
  return {
    name: stringAt(value.name, `${path}.name`),
    kind: enumAt(value.kind, ['permission', 'policy'] as const, `${path}.kind`),
  };
}

function parseClient(input: unknown, index: number): RealmClientContract {
  const path = `$.clients[${index}]`;
  const value = objectAt(input, path);
  exactKeys(value, clientKeys, requiredClientKeys, path);
  const client: RealmClientContract = {
    clientId: stringAt(value.clientId, `${path}.clientId`),
    clientKind: enumAt(
      value.clientKind,
      ['browser', 'service-account', 'resource-server'] as const,
      `${path}.clientKind`,
    ),
    confidential: booleanAt(value.confidential, `${path}.confidential`),
    standardFlowEnabled: booleanAt(value.standardFlowEnabled, `${path}.standardFlowEnabled`),
    serviceAccountsEnabled: booleanAt(
      value.serviceAccountsEnabled,
      `${path}.serviceAccountsEnabled`,
    ),
    directAccessGrantsEnabled: booleanAt(
      value.directAccessGrantsEnabled,
      `${path}.directAccessGrantsEnabled`,
    ),
    audiences: canonicalStrings(stringArrayAt(value.audiences, `${path}.audiences`)),
    defaultScopes: canonicalStrings(stringArrayAt(value.defaultScopes, `${path}.defaultScopes`)),
    optionalScopes: canonicalStrings(stringArrayAt(value.optionalScopes, `${path}.optionalScopes`)),
  };
  const pkce = optionalString(value, 'pkceCodeChallengeMethod', path);
  const redirects = optionalStringArray(value, 'redirectUris', path);
  const logoutRedirects = optionalStringArray(value, 'postLogoutRedirectUris', path);
  const secretRef = optionalString(value, 'secretRef', path);
  const exchange = optionalBoolean(value, 'standardTokenExchangeEnabled', path);
  if (pkce !== undefined) client.pkceCodeChallengeMethod = pkce;
  if (redirects !== undefined) client.redirectUris = canonicalStrings(redirects);
  if (logoutRedirects !== undefined)
    client.postLogoutRedirectUris = canonicalStrings(logoutRedirects);
  if (secretRef !== undefined) {
    assertSecretReference(secretRef, `${path}.secretRef`);
    client.secretRef = secretRef;
  }
  if (exchange !== undefined) client.standardTokenExchangeEnabled = exchange;
  return client;
}

function parseRole(input: unknown, index: number): KeycloakRealmContract['roles'][number] {
  const path = `$.roles[${index}]`;
  const value = objectAt(input, path);
  exactKeys(
    value,
    ['name', 'scopes', 'humanApprovalEligible'],
    ['name', 'scopes', 'humanApprovalEligible'],
    path,
  );
  return {
    name: enumAt(value.name, roleNames, `${path}.name`),
    scopes: canonicalStrings(stringArrayAt(value.scopes, `${path}.scopes`)),
    humanApprovalEligible: booleanAt(value.humanApprovalEligible, `${path}.humanApprovalEligible`),
  };
}

function parseFixtureUser(
  input: unknown,
  index: number,
): KeycloakRealmContract['fixtureUsers'][number] {
  const path = `$.fixtureUsers[${index}]`;
  const value = objectAt(input, path);
  exactKeys(
    value,
    ['username', 'role', 'passwordSecretRef'],
    ['username', 'role', 'passwordSecretRef'],
    path,
  );
  const passwordSecretRef = stringAt(value.passwordSecretRef, `${path}.passwordSecretRef`);
  assertSecretReference(passwordSecretRef, `${path}.passwordSecretRef`);
  return {
    username: stringAt(value.username, `${path}.username`),
    role: enumAt(value.role, roleNames, `${path}.role`),
    passwordSecretRef,
  };
}

function assertClientInvariants(clients: RealmClientContract[]): void {
  assertSameSet(
    clients.map((client) => client.clientId),
    ['ui4a-web', 'ui4a-agent', 'ui4a-api'],
    '$.clients',
  );
  if (clients.some((client) => client.directAccessGrantsEnabled)) {
    invalid('$.clients', 'direct access grants are forbidden');
  }

  const byId = new Map(clients.map((client) => [client.clientId, client]));
  const web = byId.get('ui4a-web')!;
  if (
    web.clientKind !== 'browser' ||
    !web.confidential ||
    !web.standardFlowEnabled ||
    web.serviceAccountsEnabled ||
    web.pkceCodeChallengeMethod !== 'S256' ||
    web.secretRef !== 'oidc-client-secret' ||
    !same(web.redirectUris, ['{{UI4A_ORIGIN}}/api/auth/callback']) ||
    !same(web.postLogoutRedirectUris, ['{{UI4A_ORIGIN}}/'])
  ) {
    invalid('$.clients.ui4a-web', 'browser client invariant failed');
  }

  const agent = byId.get('ui4a-agent')!;
  if (
    agent.clientKind !== 'service-account' ||
    !agent.confidential ||
    agent.standardFlowEnabled ||
    !agent.serviceAccountsEnabled ||
    agent.standardTokenExchangeEnabled !== true ||
    agent.secretRef !== 'ui4a-agent-client-secret' ||
    !agent.audiences.includes('ui4a-api')
  ) {
    invalid('$.clients.ui4a-agent', 'service account invariant failed');
  }

  const api = byId.get('ui4a-api')!;
  if (
    api.clientKind !== 'resource-server' ||
    !api.confidential ||
    api.standardFlowEnabled ||
    api.serviceAccountsEnabled ||
    api.secretRef !== undefined ||
    !same(api.audiences, ['ui4a-api'])
  ) {
    invalid('$.clients.ui4a-api', 'resource server invariant failed');
  }
}

function assertReferenceInvariants(contract: KeycloakRealmContract): void {
  const knownScopes = new Set([
    ...contract.protocolScopes,
    ...contract.clientScopes.map((scope) => scope.name),
  ]);
  const resourceAudiences = new Set(
    contract.clients
      .filter((client) => client.clientKind === 'resource-server')
      .flatMap((client) => client.audiences),
  );
  for (const [index, client] of contract.clients.entries()) {
    for (const audience of client.audiences) {
      if (!resourceAudiences.has(audience)) {
        invalid(`$.clients[${index}]`, 'unknown audience reference');
      }
    }
    for (const scope of [...client.defaultScopes, ...client.optionalScopes]) {
      if (!knownScopes.has(scope)) invalid(`$.clients[${index}]`, 'unknown scope reference');
    }
    assertUnique([...client.defaultScopes, ...client.optionalScopes], `$.clients[${index}].scopes`);
  }
  for (const [index, role] of contract.roles.entries()) {
    for (const scope of role.scopes) {
      if (!knownScopes.has(scope)) invalid(`$.roles[${index}]`, 'unknown scope reference');
    }
  }

  const roleSet = new Set(contract.roles.map((role) => role.name));
  for (const [index, user] of contract.fixtureUsers.entries()) {
    if (!roleSet.has(user.role)) invalid(`$.fixtureUsers[${index}].role`, 'unknown role reference');
    if (user.role !== 'ui4a-human') {
      invalid(`$.fixtureUsers[${index}].role`, 'fixture identities must be human');
    }
  }
}

function assertRoleInvariants(roles: KeycloakRealmContract['roles']): void {
  assertSameSet(
    roles.map((role) => role.name),
    roleNames,
    '$.roles',
  );
  for (const role of roles) {
    const hasApproval = role.scopes.includes('ui4a:approve');
    if (role.name === 'ui4a-human') {
      if (!role.humanApprovalEligible || !hasApproval) {
        invalid('$.roles.ui4a-human', 'human approval invariant failed');
      }
    } else if (role.humanApprovalEligible || hasApproval) {
      invalid(`$.roles.${role.name}`, 'non-human approval invariant failed');
    }
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStringCollection(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return same(left, right);
  if (
    left.some((value) => typeof value !== 'string') ||
    right.some((value) => typeof value !== 'string')
  ) {
    return false;
  }
  return same(canonicalStrings(left as string[]), canonicalStrings(right as string[]));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as JsonObject)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Parses, validates, clones, and freezes the canonical Keycloak realm contract. */
export function parseKeycloakRealmContract(input: unknown): KeycloakRealmContract {
  const root = objectAt(input, '$');
  exactKeys(root, rootKeys, rootKeys, '$');

  const protocolScopes = canonicalStrings(stringArrayAt(root.protocolScopes, '$.protocolScopes'));
  assertSameSet(protocolScopes, ['openid', 'profile', 'email'], '$.protocolScopes');

  if (!Array.isArray(root.clientScopes)) invalid('$.clientScopes', 'expected array');
  const clientScopes = root.clientScopes
    .map(parseClientScope)
    .sort((left, right) => asciiCompare(left.name, right.name));
  assertUnique(
    clientScopes.map((scope) => scope.name),
    '$.clientScopes',
  );
  assertSameSet(
    clientScopes.filter((scope) => scope.kind === 'permission').map((scope) => scope.name),
    permissionScopes,
    '$.clientScopes.permission',
  );
  assertSameSet(
    clientScopes.filter((scope) => scope.kind === 'policy').map((scope) => scope.name),
    policyScopes,
    '$.clientScopes.policy',
  );

  if (!Array.isArray(root.clients)) invalid('$.clients', 'expected array');
  const clients = root.clients
    .map(parseClient)
    .sort((left, right) => asciiCompare(left.clientId, right.clientId));
  assertUnique(
    clients.map((client) => client.clientId),
    '$.clients',
  );
  assertClientInvariants(clients);

  if (!Array.isArray(root.roles)) invalid('$.roles', 'expected array');
  const roles = root.roles
    .map(parseRole)
    .sort((left, right) => asciiCompare(left.name, right.name));
  assertUnique(
    roles.map((role) => role.name),
    '$.roles',
  );
  assertRoleInvariants(roles);

  if (!Array.isArray(root.fixtureUsers)) invalid('$.fixtureUsers', 'expected array');
  const fixtureUsers = root.fixtureUsers
    .map(parseFixtureUser)
    .sort((left, right) => asciiCompare(left.username, right.username));
  if (fixtureUsers.length === 0) invalid('$.fixtureUsers', 'at least one fixture is required');
  assertUnique(
    fixtureUsers.map((user) => user.username),
    '$.fixtureUsers',
  );

  const bearerConsumers = objectAt(root.bearerConsumers, '$.bearerConsumers');
  exactKeys(bearerConsumers, ['cli'], ['cli'], '$.bearerConsumers');
  const cli = objectAt(bearerConsumers.cli, '$.bearerConsumers.cli');
  exactKeys(
    cli,
    ['flow', 'audience', 'dedicatedClient'],
    ['flow', 'audience', 'dedicatedClient'],
    '$.bearerConsumers.cli',
  );

  const contract: KeycloakRealmContract = {
    schemaVersion: literalAt(root.schemaVersion, 1, '$.schemaVersion'),
    keycloakVersion: literalAt(root.keycloakVersion, '26.7.1', '$.keycloakVersion'),
    realm: parseRealm(root.realm),
    protocolScopes,
    clientScopes,
    clients,
    roles,
    fixtureUsers,
    bearerConsumers: {
      cli: {
        flow: literalAt(cli.flow, 'externally-provisioned-bearer', '$.bearerConsumers.cli.flow'),
        audience: literalAt(cli.audience, 'ui4a-api', '$.bearerConsumers.cli.audience'),
        dedicatedClient: literalAt(
          cli.dedicatedClient,
          false,
          '$.bearerConsumers.cli.dedicatedClient',
        ),
      },
    },
  };
  assertReferenceInvariants(contract);
  return deepFreeze(contract);
}

const comparableClientFields = [
  'clientKind',
  'confidential',
  'standardFlowEnabled',
  'serviceAccountsEnabled',
  'directAccessGrantsEnabled',
  'pkceCodeChallengeMethod',
  'redirectUris',
  'postLogoutRedirectUris',
  'standardTokenExchangeEnabled',
  'audiences',
  'defaultScopes',
  'optionalScopes',
] as const;

const clientCollectionFields = new Set<(typeof comparableClientFields)[number]>([
  'redirectUris',
  'postLogoutRedirectUris',
  'audiences',
  'defaultScopes',
  'optionalScopes',
]);

function changedClientFields(
  desired: RealmClientContract,
  observed: Omit<RealmClientContract, 'secretRef'>,
): string[] {
  return comparableClientFields.filter((field) => {
    const matches = clientCollectionFields.has(field)
      ? sameStringCollection(desired[field], observed[field])
      : same(desired[field], observed[field]);
    return !matches;
  });
}

function firstById<T>(values: readonly T[], id: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = id(value);
    if (!result.has(key)) result.set(key, value);
  }
  return result;
}

function createOperations(contract: KeycloakRealmContract): ReconcileOperation[] {
  return [
    { verb: 'create', kind: 'realm', id: contract.realm.name },
    ...contract.clientScopes.map((scope) => ({
      verb: 'create' as const,
      kind: 'client-scope' as const,
      id: scope.name,
    })),
    ...contract.roles.map((role) => ({
      verb: 'create' as const,
      kind: 'realm-role' as const,
      id: role.name,
    })),
    ...contract.clients.map((client) => ({
      verb: 'create' as const,
      kind: 'client' as const,
      id: client.clientId,
      ...(client.secretRef === undefined ? {} : { secretRef: client.secretRef }),
    })),
    ...contract.fixtureUsers.map((user) => ({
      verb: 'create' as const,
      kind: 'user' as const,
      id: user.username,
      secretRef: user.passwordSecretRef,
    })),
  ];
}

/** Produces a deterministic, value-redacted plan for managed Keycloak resources. */
export function planKeycloakRealmReconciliation(input: {
  contract: KeycloakRealmContract;
  observed?: ObservedRealm;
}): ReconcilePlan {
  const contract = parseKeycloakRealmContract(input.contract);
  if (input.observed === undefined) {
    return deepFreeze({
      outcome: 'create',
      operations: createOperations(contract),
      summary: 'Create managed Keycloak realm resources.',
    });
  }

  const observed = input.observed;
  const operations: ReconcileOperation[] = [];
  const realmFields = (['name', 'enabled'] as const).filter(
    (field) => !same(contract.realm[field], observed.realm[field]),
  );
  if (realmFields.length > 0) {
    operations.push({
      verb: 'update',
      kind: 'realm',
      id: contract.realm.name,
      changedFields: realmFields,
    });
  }

  const observedScopes = firstById(observed.clientScopes, (scope) => scope.name);
  for (const desired of contract.clientScopes) {
    const current = observedScopes.get(desired.name);
    if (current === undefined) {
      operations.push({ verb: 'create', kind: 'client-scope', id: desired.name });
    } else if (current.kind !== desired.kind) {
      operations.push({
        verb: 'update',
        kind: 'client-scope',
        id: desired.name,
        changedFields: ['kind'],
      });
    }
  }

  const observedRoles = firstById(observed.roles, (role) => role.name);
  for (const desired of contract.roles) {
    const current = observedRoles.get(desired.name);
    if (current === undefined) {
      operations.push({ verb: 'create', kind: 'realm-role', id: desired.name });
      continue;
    }
    const changedFields = (['scopes', 'humanApprovalEligible'] as const).filter((field) =>
      field === 'scopes'
        ? !sameStringCollection(desired[field], current[field])
        : !same(desired[field], current[field]),
    );
    if (changedFields.length > 0) {
      operations.push({
        verb: 'update',
        kind: 'realm-role',
        id: desired.name,
        changedFields,
      });
    }
  }

  const observedClients = firstById(observed.clients, (client) => client.clientId);
  for (const desired of contract.clients) {
    const current = observedClients.get(desired.clientId);
    if (current === undefined) {
      operations.push({
        verb: 'create',
        kind: 'client',
        id: desired.clientId,
        ...(desired.secretRef === undefined ? {} : { secretRef: desired.secretRef }),
      });
      continue;
    }
    const changedFields = changedClientFields(desired, current);
    if (changedFields.length > 0) {
      operations.push({
        verb: 'update',
        kind: 'client',
        id: desired.clientId,
        changedFields,
      });
    }
  }

  const observedUsers = new Set(observed.users.map((user) => user.username));
  for (const desired of contract.fixtureUsers) {
    if (!observedUsers.has(desired.username)) {
      operations.push({
        verb: 'create',
        kind: 'user',
        id: desired.username,
        secretRef: desired.passwordSecretRef,
      });
    }
  }

  if (operations.length === 0) {
    return deepFreeze({
      outcome: 'noop',
      operations,
      summary: 'Managed Keycloak realm resources already match.',
    });
  }
  return deepFreeze({
    outcome: 'update',
    operations,
    summary: 'Reconcile managed Keycloak realm resources.',
  });
}
