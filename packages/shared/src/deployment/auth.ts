/**
 * service/auth/keycloak/tls/llm 段解析(自 production-deployment-config.ts 按配置域拆出,
 * 行为不变)。模块内部使用,不经 barrel 导出。
 */
import {
  absolutePath,
  enumValue,
  exactObject,
  fail,
  hostname,
  httpsUrl,
  identifier,
  integer,
  string,
  stringList,
} from './primitives';
import type { ProductionDeploymentSettings } from './types';

export function parseService(value: unknown): ProductionDeploymentSettings['service'] {
  const candidate = exactObject(value, 'settings.service', ['publicOrigin']);
  const publicOrigin = httpsUrl(candidate.publicOrigin, 'service.publicOrigin');
  if (publicOrigin.pathname !== '/' || publicOrigin.search !== '' || publicOrigin.hash !== '') {
    fail('service.publicOrigin', 'must be an HTTPS origin without path, query or fragment');
  }
  return { publicOrigin: publicOrigin.origin };
}

export function parseAuth(value: unknown): ProductionDeploymentSettings['auth'] {
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

export function parseKeycloak(value: unknown): ProductionDeploymentSettings['keycloak'] {
  const candidate = exactObject(value, 'settings.keycloak', [
    'host',
    'realm',
    'database',
    'databaseUser',
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
    databaseUser: identifier(candidate.databaseUser, 'settings.keycloak.databaseUser'),
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

export function parseTls(value: unknown): ProductionDeploymentSettings['tls'] {
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

export function parseLlm(value: unknown): ProductionDeploymentSettings['llm'] {
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
