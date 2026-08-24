export type ProductionDeploymentMode = 'compose' | 'kubernetes';
export type ProductionAgentSpecialization = 'coding' | 'writing' | 'authoring';

export interface ProductionDeploymentSettings {
  schemaVersion: 1;
  releaseStage: 'production';
  deploymentMode: ProductionDeploymentMode;
  service: {
    publicOrigin: string;
  };
  auth: {
    mode: 'oidc';
    oidc: {
      issuer: string;
      audience: 'ui4a-api';
      clientId: 'ui4a-web';
      clientSecretRef: string;
      sessionSecretRef: string;
      agentClientId: 'ui4a-agent';
      agentClientSecretRef: string;
      agentScopes: string[];
      callbackUrl: string;
      scopes: string[];
    };
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    runtimeUser: string;
    runtimePasswordRef: string;
    migrationUser: string;
    migrationPasswordRef: string;
    pool: { min: number; max: number; idleTimeoutMs: number };
    connectTimeoutMs: number;
    tls: { mode: 'verify-full'; caCertificatePath: string };
  };
  temporal: {
    address: string;
    namespace: string;
    taskQueue: string;
    workerIdentity: string;
    connectTimeoutMs: number;
    transport: { mode: 'istio' | 'tls' };
  };
  keycloak: {
    host: string;
    realm: 'ui4a';
    database: string;
    databasePasswordRef: string;
    bootstrapAdminUser: string;
    bootstrapAdminPasswordRef: string;
    experimentHumanPasswordRef: string;
  };
  tls: {
    ui4aHost: string;
    keycloakHost: string;
    caCertificatePath: string;
    ui4aCertificatePath: string;
    ui4aPrivateKeyPath: string;
    keycloakCertificatePath: string;
    keycloakPrivateKeyPath: string;
  };
  llm: {
    baseUrl: string;
    model: string;
    apiKeyRef: string;
    requestTimeoutMs: number;
  };
  runtime: {
    defaultProfiles: Record<ProductionAgentSpecialization, string>;
    profiles: ProductionRuntimeProfile[];
    repositories: ProductionRepository[];
  };
}

interface ProductionRuntimeProfileBase {
  id: string;
  specialization: ProductionAgentSpecialization;
  workspaceRoot: string;
  timeoutSeconds: number;
  resources: { cpu: string; memory: string };
  networkPolicy: 'restricted';
  credentialRefs: string[];
}

export interface KubernetesProductionRuntimeProfile extends ProductionRuntimeProfileBase {
  backend: 'kubernetes';
  image: string;
}

export interface HostProductionRuntimeProfile extends ProductionRuntimeProfileBase {
  backend: 'host';
  runnerId: string;
  runnerTokenRef: string;
}

export type ProductionRuntimeProfile =
  KubernetesProductionRuntimeProfile | HostProductionRuntimeProfile;

export interface ProductionRepository {
  ref: string;
  root: string;
  allowedPaths: string[];
}

export interface ProductionDeploymentConfig {
  settings: ProductionDeploymentSettings;
  secrets: Readonly<Record<string, string>>;
}

export const PRODUCTION_DEPLOYMENT_ENV = {
  profile: 'UI4A_DEPLOYMENT_PROFILE',
  settingsJson: 'UI4A_DEPLOYMENT_SETTINGS_JSON',
  secretsJson: 'UI4A_DEPLOYMENT_SECRETS_JSON',
  settingsFile: 'UI4A_DEPLOYMENT_SETTINGS_FILE',
  secretsFile: 'UI4A_DEPLOYMENT_SECRETS_FILE',
} as const;

export const PRODUCTION_DEPLOYMENT_HELM_VALUES_PATH = {
  settings: 'ui4a.deploymentConfig.settings',
  secrets: 'ui4a.deploymentConfig.secrets',
} as const;

export type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;
export type DeploymentFileReader = (path: string) => string;

export class ProductionDeploymentConfigError extends Error {
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'ProductionDeploymentConfigError';
  }
}

const EXPERIMENTAL_POLICY_SCOPES = [
  'ui4a:policy:default',
  'ui4a:policy:publishing',
  'ui4a:policy:community',
  'ui4a:policy:development',
  'ui4a:policy:editorial',
  'ui4a:policy:governance',
] as const;
const EXPERIMENTAL_POLICY_SCOPE_SET = new Set<string>(EXPERIMENTAL_POLICY_SCOPES);

function fail(path: string, reason: string): never {
  throw new ProductionDeploymentConfigError(path, reason);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const parsed = object(value, path);
  const unknownKey = Object.keys(parsed).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) fail(`${path}.${unknownKey}`, 'unknown field');
  return parsed;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'is required');
  return value.trim();
}

function identifier(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parsed)) {
    fail(path, 'must be a stable identifier');
  }
  return parsed;
}

function integer(value: unknown, path: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `must be an integer >= ${minimum}`);
  }
  return value as number;
}

function enumValue<const T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(path, `must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty array');
  return value.map((entry, index) => string(entry, `${path}[${index}]`));
}

function absolutePath(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!parsed.startsWith('/') || parsed === '/' || parsed.includes('\0')) {
    fail(path, 'must be a non-root absolute path');
  }
  return parsed;
}

function hostname(value: unknown, path: string): string {
  const parsed = string(value, path).toLowerCase();
  if (
    parsed === 'localhost' ||
    parsed === '0.0.0.0' ||
    parsed === '::1' ||
    parsed.startsWith('127.') ||
    parsed.includes('/') ||
    parsed.includes(':')
  ) {
    fail(path, 'localhost, loopback, URL and port values are forbidden in production hosts');
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(parsed) || parsed.includes('..')) {
    fail(path, 'must be a valid production hostname');
  }
  return parsed;
}

function httpsUrl(value: unknown, path: string): URL {
  const parsed = string(value, path);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    fail(path, 'must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:') fail(path, 'must use HTTPS in production');
  hostname(url.hostname, path);
  if (url.username !== '' || url.password !== '') fail(path, 'must not contain credentials');
  return url;
}

function parseSecrets(value: unknown): Record<string, string> {
  const candidate = object(value, 'secrets');
  const result: Record<string, string> = {};
  for (const [key, secret] of Object.entries(candidate)) {
    identifier(key, `secrets.${key}`);
    if (typeof secret !== 'string' || secret.trim() === '') {
      fail(`secrets.${key}`, 'Secret value must not be empty');
    }
    result[key] = secret;
  }
  return result;
}

function requireSecret(secrets: Readonly<Record<string, string>>, ref: string, path: string): void {
  if (secrets[ref] === undefined) fail(path, `Secret ref ${ref} is required`);
}

function parseService(value: unknown): ProductionDeploymentSettings['service'] {
  const candidate = exactObject(value, 'settings.service', ['publicOrigin']);
  const publicOrigin = httpsUrl(candidate.publicOrigin, 'service.publicOrigin');
  if (publicOrigin.pathname !== '/' || publicOrigin.search !== '' || publicOrigin.hash !== '') {
    fail('service.publicOrigin', 'must be an HTTPS origin without path, query or fragment');
  }
  return { publicOrigin: publicOrigin.origin };
}

function parseAuth(value: unknown): ProductionDeploymentSettings['auth'] {
  const candidate = exactObject(value, 'settings.auth', ['mode', 'oidc']);
  const mode = enumValue(candidate.mode, 'settings.auth.mode', ['oidc'] as const);
  const oidc = exactObject(candidate.oidc, 'settings.auth.oidc', [
    'issuer',
    'audience',
    'clientId',
    'clientSecretRef',
    'sessionSecretRef',
    'agentClientId',
    'agentClientSecretRef',
    'agentScopes',
    'callbackUrl',
    'scopes',
  ]);
  if (oidc.audience === '*') {
    fail('settings.auth.oidc.audience', 'wildcard audience is forbidden in production');
  }
  const audience = identifier(oidc.audience, 'settings.auth.oidc.audience');
  if (audience !== 'ui4a-api') {
    fail('settings.auth.oidc.audience', 'must be ui4a-api for the experimental release');
  }
  const clientId = identifier(oidc.clientId, 'settings.auth.oidc.clientId');
  if (clientId !== 'ui4a-web') {
    fail('settings.auth.oidc.clientId', 'must be ui4a-web for the experimental release');
  }
  return {
    mode,
    oidc: {
      issuer: httpsUrl(oidc.issuer, 'auth.oidc.issuer').toString().replace(/\/$/, ''),
      audience,
      clientId,
      clientSecretRef: identifier(oidc.clientSecretRef, 'settings.auth.oidc.clientSecretRef'),
      sessionSecretRef: identifier(oidc.sessionSecretRef, 'settings.auth.oidc.sessionSecretRef'),
      agentClientId: (() => {
        const clientId = identifier(oidc.agentClientId, 'settings.auth.oidc.agentClientId');
        if (clientId !== 'ui4a-agent') {
          fail(
            'settings.auth.oidc.agentClientId',
            'must be ui4a-agent for the experimental release',
          );
        }
        return clientId as 'ui4a-agent';
      })(),
      agentClientSecretRef: identifier(
        oidc.agentClientSecretRef,
        'settings.auth.oidc.agentClientSecretRef',
      ),
      agentScopes: stringList(oidc.agentScopes, 'settings.auth.oidc.agentScopes'),
      callbackUrl: httpsUrl(oidc.callbackUrl, 'auth.oidc.callbackUrl').toString(),
      scopes: stringList(oidc.scopes, 'settings.auth.oidc.scopes'),
    },
  };
}

function parsePostgres(value: unknown): ProductionDeploymentSettings['postgres'] {
  const candidate = exactObject(value, 'settings.postgres', [
    'host',
    'port',
    'database',
    'runtimeUser',
    'runtimePasswordRef',
    'migrationUser',
    'migrationPasswordRef',
    'pool',
    'connectTimeoutMs',
    'tls',
  ]);
  const pool = exactObject(candidate.pool, 'settings.postgres.pool', [
    'min',
    'max',
    'idleTimeoutMs',
  ]);
  const min = integer(pool.min, 'settings.postgres.pool.min', 0);
  const max = integer(pool.max, 'settings.postgres.pool.max');
  if (min > max) fail('settings.postgres.pool', 'min must not exceed max');
  const tls = exactObject(candidate.tls, 'settings.postgres.tls', ['mode', 'caCertificatePath']);
  return {
    host: hostname(candidate.host, 'settings.postgres.host'),
    port: (() => {
      const port = integer(candidate.port, 'settings.postgres.port');
      if (port > 65_535) fail('settings.postgres.port', 'must not exceed 65535');
      return port;
    })(),
    database: identifier(candidate.database, 'settings.postgres.database'),
    runtimeUser: identifier(candidate.runtimeUser, 'settings.postgres.runtimeUser'),
    runtimePasswordRef: identifier(
      candidate.runtimePasswordRef,
      'settings.postgres.runtimePasswordRef',
    ),
    migrationUser: identifier(candidate.migrationUser, 'settings.postgres.migrationUser'),
    migrationPasswordRef: identifier(
      candidate.migrationPasswordRef,
      'settings.postgres.migrationPasswordRef',
    ),
    pool: {
      min,
      max,
      idleTimeoutMs: integer(pool.idleTimeoutMs, 'settings.postgres.pool.idleTimeoutMs'),
    },
    connectTimeoutMs: integer(candidate.connectTimeoutMs, 'settings.postgres.connectTimeoutMs'),
    tls: {
      mode: enumValue(tls.mode, 'settings.postgres.tls.mode', ['verify-full'] as const),
      caCertificatePath: absolutePath(
        tls.caCertificatePath,
        'settings.postgres.tls.caCertificatePath',
      ),
    },
  };
}

function parseTemporal(value: unknown): ProductionDeploymentSettings['temporal'] {
  const candidate = exactObject(value, 'settings.temporal', [
    'address',
    'namespace',
    'taskQueue',
    'workerIdentity',
    'connectTimeoutMs',
    'transport',
  ]);
  const address = string(candidate.address, 'settings.temporal.address');
  const match = /^([^:]+):(\d+)$/.exec(address);
  if (match === null) fail('settings.temporal.address', 'must be host:port');
  hostname(match[1], 'settings.temporal.address');
  const port = Number(match[2]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    fail('settings.temporal.address', 'port must be between 1 and 65535');
  }
  const namespace = identifier(candidate.namespace, 'settings.temporal.namespace');
  if (namespace === 'default')
    fail('settings.temporal.namespace', 'default is forbidden in production');
  const transport = exactObject(candidate.transport, 'settings.temporal.transport', ['mode']);
  return {
    address,
    namespace,
    taskQueue: identifier(candidate.taskQueue, 'settings.temporal.taskQueue'),
    workerIdentity: identifier(candidate.workerIdentity, 'settings.temporal.workerIdentity'),
    connectTimeoutMs: integer(candidate.connectTimeoutMs, 'settings.temporal.connectTimeoutMs'),
    transport: {
      mode: enumValue(transport.mode, 'settings.temporal.transport.mode', [
        'istio',
        'tls',
      ] as const),
    },
  };
}

function parseKeycloak(value: unknown): ProductionDeploymentSettings['keycloak'] {
  const candidate = exactObject(value, 'settings.keycloak', [
    'host',
    'realm',
    'database',
    'databasePasswordRef',
    'bootstrapAdminUser',
    'bootstrapAdminPasswordRef',
    'experimentHumanPasswordRef',
  ]);
  const realm = identifier(candidate.realm, 'settings.keycloak.realm');
  if (realm !== 'ui4a') {
    fail('settings.keycloak.realm', 'must be ui4a for the experimental release');
  }
  return {
    host: hostname(candidate.host, 'settings.keycloak.host'),
    realm,
    database: identifier(candidate.database, 'settings.keycloak.database'),
    databasePasswordRef: identifier(
      candidate.databasePasswordRef,
      'settings.keycloak.databasePasswordRef',
    ),
    bootstrapAdminUser: identifier(
      candidate.bootstrapAdminUser,
      'settings.keycloak.bootstrapAdminUser',
    ),
    bootstrapAdminPasswordRef: identifier(
      candidate.bootstrapAdminPasswordRef,
      'settings.keycloak.bootstrapAdminPasswordRef',
    ),
    experimentHumanPasswordRef: identifier(
      candidate.experimentHumanPasswordRef,
      'settings.keycloak.experimentHumanPasswordRef',
    ),
  };
}

function parseTls(value: unknown): ProductionDeploymentSettings['tls'] {
  const candidate = exactObject(value, 'settings.tls', [
    'ui4aHost',
    'keycloakHost',
    'caCertificatePath',
    'ui4aCertificatePath',
    'ui4aPrivateKeyPath',
    'keycloakCertificatePath',
    'keycloakPrivateKeyPath',
  ]);
  return {
    ui4aHost: hostname(candidate.ui4aHost, 'settings.tls.ui4aHost'),
    keycloakHost: hostname(candidate.keycloakHost, 'settings.tls.keycloakHost'),
    caCertificatePath: absolutePath(candidate.caCertificatePath, 'settings.tls.caCertificatePath'),
    ui4aCertificatePath: absolutePath(
      candidate.ui4aCertificatePath,
      'settings.tls.ui4aCertificatePath',
    ),
    ui4aPrivateKeyPath: absolutePath(
      candidate.ui4aPrivateKeyPath,
      'settings.tls.ui4aPrivateKeyPath',
    ),
    keycloakCertificatePath: absolutePath(
      candidate.keycloakCertificatePath,
      'settings.tls.keycloakCertificatePath',
    ),
    keycloakPrivateKeyPath: absolutePath(
      candidate.keycloakPrivateKeyPath,
      'settings.tls.keycloakPrivateKeyPath',
    ),
  };
}

function parseLlm(value: unknown): ProductionDeploymentSettings['llm'] {
  const candidate = exactObject(value, 'settings.llm', [
    'baseUrl',
    'model',
    'apiKeyRef',
    'requestTimeoutMs',
  ]);
  return {
    baseUrl: httpsUrl(candidate.baseUrl, 'llm.baseUrl').toString().replace(/\/$/, ''),
    model: string(candidate.model, 'settings.llm.model'),
    apiKeyRef: identifier(candidate.apiKeyRef, 'settings.llm.apiKeyRef'),
    requestTimeoutMs: integer(candidate.requestTimeoutMs, 'settings.llm.requestTimeoutMs'),
  };
}

function parseResources(value: unknown, path: string): { cpu: string; memory: string } {
  const candidate = exactObject(value, path, ['cpu', 'memory']);
  const cpu = string(candidate.cpu, `${path}.cpu`);
  const memory = string(candidate.memory, `${path}.memory`);
  if (!/^(?:[1-9]\d*m|[1-9]\d*(?:\.\d+)?)$/.test(cpu)) {
    fail(`${path}.cpu`, 'must be a positive CPU quantity');
  }
  if (!/^[1-9]\d*(?:Ki|Mi|Gi|Ti)$/.test(memory)) {
    fail(`${path}.memory`, 'must be a positive binary memory quantity');
  }
  return {
    cpu,
    memory,
  };
}

function parseProfile(value: unknown, index: number): ProductionRuntimeProfile {
  const path = `settings.runtime.profiles[${index}]`;
  const candidate = object(value, path);
  const backend = enumValue(candidate.backend, `${path}.backend`, ['kubernetes', 'host'] as const);
  const commonKeys = [
    'id',
    'specialization',
    'backend',
    'workspaceRoot',
    'timeoutSeconds',
    'resources',
    'networkPolicy',
    'credentialRefs',
  ];
  exactObject(candidate, path, [
    ...commonKeys,
    ...(backend === 'kubernetes' ? ['image'] : ['runnerId', 'runnerTokenRef']),
  ]);
  const common: ProductionRuntimeProfileBase = {
    id: identifier(candidate.id, `${path}.id`),
    specialization: enumValue(candidate.specialization, `${path}.specialization`, [
      'coding',
      'writing',
      'authoring',
    ] as const),
    workspaceRoot: absolutePath(candidate.workspaceRoot, `${path}.workspaceRoot`),
    timeoutSeconds: integer(candidate.timeoutSeconds, `${path}.timeoutSeconds`),
    resources: parseResources(candidate.resources, `${path}.resources`),
    networkPolicy: enumValue(candidate.networkPolicy, `${path}.networkPolicy`, [
      'restricted',
    ] as const),
    credentialRefs: stringList(candidate.credentialRefs, `${path}.credentialRefs`).map(
      (ref, refIndex) => identifier(ref, `${path}.credentialRefs[${refIndex}]`),
    ),
  };
  if (backend === 'kubernetes') {
    const image = string(candidate.image, `${path}.image`);
    if (!/@sha256:[a-f0-9]{64}$/.test(image)) {
      fail(`${path}.image`, 'production Runtime image must be pinned by sha256 digest');
    }
    return { ...common, backend, image };
  }
  return {
    ...common,
    backend,
    runnerId: identifier(candidate.runnerId, `${path}.runnerId`),
    runnerTokenRef: identifier(candidate.runnerTokenRef, `${path}.runnerTokenRef`),
  };
}

function parseRepository(value: unknown, index: number): ProductionRepository {
  const path = `settings.runtime.repositories[${index}]`;
  const candidate = exactObject(value, path, ['ref', 'root', 'allowedPaths']);
  const allowedPaths = stringList(candidate.allowedPaths, `${path}.allowedPaths`);
  for (const [allowedIndex, allowedPath] of allowedPaths.entries()) {
    if (
      allowedPath.startsWith('/') ||
      allowedPath === '.' ||
      allowedPath.includes('..') ||
      allowedPath.includes('\0')
    ) {
      fail(`${path}.allowedPaths[${allowedIndex}]`, 'must be a bounded relative path');
    }
  }
  return {
    ref: identifier(candidate.ref, `${path}.ref`),
    root: absolutePath(candidate.root, `${path}.root`),
    allowedPaths,
  };
}

function parseRuntime(value: unknown): ProductionDeploymentSettings['runtime'] {
  const candidate = exactObject(value, 'settings.runtime', [
    'defaultProfiles',
    'profiles',
    'repositories',
  ]);
  const defaults = exactObject(candidate.defaultProfiles, 'settings.runtime.defaultProfiles', [
    'coding',
    'writing',
    'authoring',
  ]);
  if (!Array.isArray(candidate.profiles) || candidate.profiles.length === 0) {
    fail('settings.runtime.profiles', 'must be a non-empty array');
  }
  if (!Array.isArray(candidate.repositories) || candidate.repositories.length === 0) {
    fail('settings.runtime.repositories', 'must be a non-empty array');
  }
  const profiles = candidate.profiles.map(parseProfile);
  const repositories = candidate.repositories.map(parseRepository);
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (ids.has(profile.id))
      fail('settings.runtime.profiles', `duplicate profile id ${profile.id}`);
    ids.add(profile.id);
  }
  const repositoryRefs = new Set<string>();
  for (const repository of repositories) {
    if (repositoryRefs.has(repository.ref)) {
      fail('settings.runtime.repositories', `duplicate repository ref ${repository.ref}`);
    }
    repositoryRefs.add(repository.ref);
  }
  const defaultProfiles: Record<ProductionAgentSpecialization, string> = {
    coding: identifier(defaults.coding, 'settings.runtime.defaultProfiles.coding'),
    writing: identifier(defaults.writing, 'settings.runtime.defaultProfiles.writing'),
    authoring: identifier(defaults.authoring, 'settings.runtime.defaultProfiles.authoring'),
  };
  for (const specialization of ['coding', 'writing', 'authoring'] as const) {
    const matches = profiles.filter(
      (profile) =>
        profile.id === defaultProfiles[specialization] && profile.specialization === specialization,
    );
    if (matches.length !== 1) {
      fail(
        `settings.runtime.defaultProfiles.${specialization}`,
        'must resolve exactly one sealed server-owned profile of the same specialization',
      );
    }
  }
  return { defaultProfiles, profiles, repositories };
}

export function parseProductionDeploymentConfig(input: unknown): ProductionDeploymentConfig {
  const candidate = exactObject(input, 'deploymentConfig', ['settings', 'secrets']);
  const secrets = parseSecrets(candidate.secrets);
  const rawSettings = exactObject(candidate.settings, 'settings', [
    'schemaVersion',
    'releaseStage',
    'deploymentMode',
    'service',
    'auth',
    'postgres',
    'temporal',
    'keycloak',
    'tls',
    'llm',
    'runtime',
  ]);
  if (rawSettings.schemaVersion !== 1) fail('settings.schemaVersion', 'must be 1');
  const releaseStage = enumValue(rawSettings.releaseStage, 'settings.releaseStage', [
    'production',
  ] as const);
  const deploymentMode = enumValue(rawSettings.deploymentMode, 'settings.deploymentMode', [
    'compose',
    'kubernetes',
  ] as const);
  const settings: ProductionDeploymentSettings = {
    schemaVersion: 1,
    releaseStage,
    deploymentMode,
    service: parseService(rawSettings.service),
    auth: parseAuth(rawSettings.auth),
    postgres: parsePostgres(rawSettings.postgres),
    temporal: parseTemporal(rawSettings.temporal),
    keycloak: parseKeycloak(rawSettings.keycloak),
    tls: parseTls(rawSettings.tls),
    llm: parseLlm(rawSettings.llm),
    runtime: parseRuntime(rawSettings.runtime),
  };

  if (new URL(settings.service.publicOrigin).hostname !== settings.tls.ui4aHost) {
    fail('service.publicOrigin', 'hostname must equal settings.tls.ui4aHost');
  }
  if (settings.keycloak.host !== settings.tls.keycloakHost) {
    fail('settings.tls.keycloakHost', 'must equal settings.keycloak.host');
  }
  const issuer = new URL(settings.auth.oidc.issuer);
  if (
    issuer.hostname !== settings.keycloak.host ||
    issuer.pathname.replace(/\/$/, '') !== `/realms/${settings.keycloak.realm}`
  ) {
    fail('auth.oidc.issuer', 'must identify the configured Keycloak host and realm');
  }
  if (new URL(settings.auth.oidc.callbackUrl).origin !== settings.service.publicOrigin) {
    fail('auth.oidc.callbackUrl', 'origin must equal service.publicOrigin');
  }
  if (new URL(settings.auth.oidc.callbackUrl).pathname !== '/api/auth/callback') {
    fail('auth.oidc.callbackUrl', 'path must be /api/auth/callback');
  }
  if (settings.auth.oidc.sessionSecretRef === settings.auth.oidc.clientSecretRef) {
    fail('settings.auth.oidc.sessionSecretRef', 'must differ from clientSecretRef');
  }
  if (
    settings.auth.oidc.agentClientSecretRef === settings.auth.oidc.clientSecretRef ||
    settings.auth.oidc.agentClientSecretRef === settings.auth.oidc.sessionSecretRef
  ) {
    fail(
      'settings.auth.oidc.agentClientSecretRef',
      'must differ from the Web client and browser session Secret refs',
    );
  }
  const browserScopes = settings.auth.oidc.scopes;
  if (new Set(browserScopes).size !== browserScopes.length) {
    fail('settings.auth.oidc.scopes', 'must not contain duplicates');
  }
  const requiredBrowserScopes = ['openid', 'ui4a:read', 'ui4a:write', 'ui4a:approve'];
  if (requiredBrowserScopes.some((scope) => !browserScopes.includes(scope))) {
    fail(
      'settings.auth.oidc.scopes',
      'must include openid and the ui4a:read, ui4a:write, ui4a:approve permissions',
    );
  }
  if (!browserScopes.some((scope) => EXPERIMENTAL_POLICY_SCOPE_SET.has(scope))) {
    fail('settings.auth.oidc.scopes', 'must include at least one fixed ui4a:policy:<app> scope');
  }
  if (
    browserScopes.some(
      (scope) =>
        !['openid', 'profile', 'email', 'ui4a:read', 'ui4a:write', 'ui4a:approve'].includes(
          scope,
        ) && !EXPERIMENTAL_POLICY_SCOPE_SET.has(scope),
    )
  ) {
    fail('settings.auth.oidc.scopes', 'contains a scope unavailable in the fixed ui4a realm');
  }
  const agentScopes = settings.auth.oidc.agentScopes;
  if (new Set(agentScopes).size !== agentScopes.length) {
    fail('settings.auth.oidc.agentScopes', 'must not contain duplicates');
  }
  if (!agentScopes.includes('ui4a:read') || !agentScopes.includes('ui4a:write')) {
    fail('settings.auth.oidc.agentScopes', 'must include exactly ui4a:read and ui4a:write');
  }
  if (!agentScopes.some((scope) => EXPERIMENTAL_POLICY_SCOPE_SET.has(scope))) {
    fail('settings.auth.oidc.agentScopes', 'must include at least one ui4a:policy:<app> scope');
  }
  if (
    agentScopes.some(
      (scope) =>
        scope === 'openid' ||
        scope === 'ui4a:approve' ||
        (scope !== 'ui4a:read' &&
          scope !== 'ui4a:write' &&
          !EXPERIMENTAL_POLICY_SCOPE_SET.has(scope)),
    )
  ) {
    fail(
      'settings.auth.oidc.agentScopes',
      'may contain only ui4a:read, ui4a:write and ui4a:policy:<app> scopes; openid and approve are forbidden',
    );
  }
  if (settings.postgres.runtimeUser === settings.postgres.migrationUser) {
    fail('settings.postgres.migrationUser', 'must differ from runtimeUser in production');
  }
  if (settings.postgres.database === settings.keycloak.database) {
    fail('settings.keycloak.database', 'must be isolated from the UI4A database');
  }

  const secretRefs: Array<[string, string]> = [
    [settings.auth.oidc.clientSecretRef, 'settings.auth.oidc.clientSecretRef'],
    [settings.auth.oidc.sessionSecretRef, 'settings.auth.oidc.sessionSecretRef'],
    [settings.auth.oidc.agentClientSecretRef, 'settings.auth.oidc.agentClientSecretRef'],
    [settings.postgres.runtimePasswordRef, 'settings.postgres.runtimePasswordRef'],
    [settings.postgres.migrationPasswordRef, 'settings.postgres.migrationPasswordRef'],
    [settings.keycloak.databasePasswordRef, 'settings.keycloak.databasePasswordRef'],
    [settings.keycloak.bootstrapAdminPasswordRef, 'settings.keycloak.bootstrapAdminPasswordRef'],
    [settings.keycloak.experimentHumanPasswordRef, 'settings.keycloak.experimentHumanPasswordRef'],
    [settings.llm.apiKeyRef, 'settings.llm.apiKeyRef'],
  ];
  for (const profile of settings.runtime.profiles) {
    for (const ref of profile.credentialRefs) {
      secretRefs.push([ref, `settings.runtime.profiles.${profile.id}.credentialRefs`]);
    }
    if (profile.backend === 'host') {
      secretRefs.push([
        profile.runnerTokenRef,
        `settings.runtime.profiles.${profile.id}.runnerTokenRef`,
      ]);
    }
  }
  for (const [ref, path] of secretRefs) requireSecret(secrets, ref, path);

  const sessionSecret = secrets[settings.auth.oidc.sessionSecretRef]!;
  const agentClientSecret = secrets[settings.auth.oidc.agentClientSecretRef]!;
  if (
    sessionSecret === secrets[settings.auth.oidc.clientSecretRef] ||
    sessionSecret === settings.auth.oidc.clientId
  ) {
    fail(
      'settings.auth.oidc.sessionSecretRef',
      'Secret material must differ from the OIDC client credential and clientId',
    );
  }
  if (
    agentClientSecret === secrets[settings.auth.oidc.clientSecretRef] ||
    agentClientSecret === sessionSecret
  ) {
    fail(
      'settings.auth.oidc.agentClientSecretRef',
      'Secret material must differ from the Web client credential and browser session Secret',
    );
  }

  return { settings, secrets: Object.freeze({ ...secrets }) };
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    fail(label, 'must contain valid JSON');
  }
}

function readSource(
  environment: DeploymentEnvironment,
  inlineName: string,
  fileName: string,
  label: string,
  readFile: DeploymentFileReader,
): unknown {
  const inline = environment[inlineName];
  const file = environment[fileName];
  if (inline !== undefined && file !== undefined) {
    fail(label, `configure exactly one of ${inlineName} or ${fileName}`);
  }
  if (inline === undefined && file === undefined) {
    fail(label, `configure one of ${inlineName} or ${fileName}`);
  }
  if (inline !== undefined) return parseJson(inline, label);
  const path = string(file, fileName);
  let content: string;
  try {
    content = readFile(path);
  } catch {
    fail(label, `could not read configured file ${path}`);
  }
  return parseJson(content, label);
}

/**
 * Explicit production startup gate. `NODE_ENV` is intentionally ignored: Next builds set it too.
 * Undefined or `local` preserves the existing local demo behavior.
 */
export function preflightProductionDeploymentFromEnvironment(
  environment: DeploymentEnvironment,
  readFile: DeploymentFileReader = () => fail('deploymentConfig', 'file reader is required'),
): ProductionDeploymentConfig | undefined {
  const profile = environment[PRODUCTION_DEPLOYMENT_ENV.profile];
  if (profile === undefined || profile === '' || profile === 'local') return undefined;
  if (profile !== 'production') {
    fail(PRODUCTION_DEPLOYMENT_ENV.profile, 'must be local or production');
  }
  const settings = readSource(
    environment,
    PRODUCTION_DEPLOYMENT_ENV.settingsJson,
    PRODUCTION_DEPLOYMENT_ENV.settingsFile,
    'settings',
    readFile,
  );
  const secrets = readSource(
    environment,
    PRODUCTION_DEPLOYMENT_ENV.secretsJson,
    PRODUCTION_DEPLOYMENT_ENV.secretsFile,
    'secrets',
    readFile,
  );
  return parseProductionDeploymentConfig({ settings, secrets });
}

/** Normalize the Helm values projection used by the chart into the same canonical parser input. */
export function productionDeploymentConfigFromHelmValues(
  values: unknown,
): ProductionDeploymentConfig {
  const root = object(values, 'values');
  const ui4a = object(root.ui4a, 'values.ui4a');
  const deploymentConfig = exactObject(ui4a.deploymentConfig, 'values.ui4a.deploymentConfig', [
    'settings',
    'secrets',
  ]);
  return parseProductionDeploymentConfig(deploymentConfig);
}
