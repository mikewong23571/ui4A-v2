/**
 * 规范部署配置入口 parseProductionDeploymentConfig 与跨段一致性校验
 * (自 production-deployment-config.ts 按配置域拆出,行为不变)。
 */
import { parseAuth, parseKeycloak, parseLlm, parseService, parseTls } from './auth';
import { parsePostgres } from './postgres';
import { enumValue, exactObject, fail, parseSecrets, requireSecret } from './primitives';
import { parseRuntime } from './runtime';
import { parseTemporal } from './temporal';
import type { ProductionDeploymentConfig, ProductionDeploymentSettings } from './types';

const EXPERIMENTAL_POLICY_SCOPES = [
  'ui4a:policy:default',
  'ui4a:policy:publishing',
  'ui4a:policy:community',
  'ui4a:policy:development',
  'ui4a:policy:editorial',
  'ui4a:policy:governance',
] as const;
const EXPERIMENTAL_POLICY_SCOPE_SET = new Set<string>(EXPERIMENTAL_POLICY_SCOPES);

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
  if (
    settings.postgres.backupUser === settings.postgres.runtimeUser ||
    settings.postgres.backupUser === settings.postgres.migrationUser
  ) {
    fail('settings.postgres.backupUser', 'must differ from runtimeUser and migrationUser');
  }
  if (settings.postgres.database === settings.keycloak.database) {
    fail('settings.keycloak.database', 'must be isolated from the UI4A database');
  }
  if (
    [
      settings.postgres.runtimeUser,
      settings.postgres.migrationUser,
      settings.postgres.backupUser,
    ].includes(settings.keycloak.databaseUser)
  ) {
    fail('settings.keycloak.databaseUser', 'must be isolated from UI4A database roles');
  }

  const secretRefs: Array<[string, string]> = [
    [settings.auth.oidc.clientSecretRef, 'settings.auth.oidc.clientSecretRef'],
    [settings.auth.oidc.sessionSecretRef, 'settings.auth.oidc.sessionSecretRef'],
    [settings.auth.oidc.agentClientSecretRef, 'settings.auth.oidc.agentClientSecretRef'],
    [settings.postgres.runtimePasswordRef, 'settings.postgres.runtimePasswordRef'],
    [settings.postgres.migrationPasswordRef, 'settings.postgres.migrationPasswordRef'],
    [settings.postgres.backupPasswordRef, 'settings.postgres.backupPasswordRef'],
    [
      settings.temporal.persistence.defaultStore.schemaPasswordRef,
      'settings.temporal.persistence.defaultStore.schemaPasswordRef',
    ],
    [
      settings.temporal.persistence.defaultStore.runtimePasswordRef,
      'settings.temporal.persistence.defaultStore.runtimePasswordRef',
    ],
    [
      settings.temporal.persistence.visibilityStore.schemaPasswordRef,
      'settings.temporal.persistence.visibilityStore.schemaPasswordRef',
    ],
    [
      settings.temporal.persistence.visibilityStore.runtimePasswordRef,
      'settings.temporal.persistence.visibilityStore.runtimePasswordRef',
    ],
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
