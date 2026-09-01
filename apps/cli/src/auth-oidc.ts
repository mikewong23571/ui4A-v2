import type { CredentialKey, CredentialStore, StoredCredential } from './auth-credential.js';
import type { CliConfig } from './config.js';
import { CliError } from './envelope.js';

export type { CredentialStore, StoredCredential } from './auth-credential.js';

interface Discovery {
  issuer: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
}

interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds: number;
  scopes: string[];
}

export interface AuthDependencies {
  fetch: typeof fetch;
  store: CredentialStore;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  notify?: (notice: {
    verificationUri: string;
    verificationUriComplete?: string;
    userCode: string;
    expiresInSeconds: number;
  }) => Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = (await response.json()) as unknown;
    if (record(value)) return value;
  } catch {
    // Normalized below without exposing the response body.
  }
  throw new CliError('OIDC_RESPONSE_INVALID', 'OIDC response is invalid', 9, response.status);
}

function endpoint(value: unknown, issuer: URL, label: string): string {
  if (typeof value !== 'string') {
    throw new CliError('OIDC_DISCOVERY_INVALID', `OIDC discovery is missing ${label}`, 9);
  }
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== issuer.origin) {
    throw new CliError('OIDC_DISCOVERY_INVALID', `OIDC ${label} is not trusted`, 9);
  }
  return url.toString();
}

async function discover(config: CliConfig, fetcher: typeof fetch): Promise<Discovery> {
  if (config.issuer === undefined) {
    throw new CliError('AUTH_CONFIG_REQUIRED', 'UI4A_ISSUER is required for Device login', 3);
  }
  const issuer = new URL(config.issuer);
  let response: Response;
  try {
    response = await fetcher(`${config.issuer}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CliError(
      'OIDC_UNAVAILABLE',
      'OIDC discovery is unavailable',
      8,
      undefined,
      undefined,
      true,
    );
  }
  if (!response.ok)
    throw new CliError('OIDC_UNAVAILABLE', 'OIDC discovery failed', 8, response.status);
  const payload = await json(response);
  if (payload.issuer !== config.issuer) {
    throw new CliError('OIDC_DISCOVERY_INVALID', 'OIDC issuer mismatch', 9);
  }
  return {
    issuer: config.issuer,
    deviceAuthorizationEndpoint: endpoint(
      payload.device_authorization_endpoint,
      issuer,
      'device authorization endpoint',
    ),
    tokenEndpoint: endpoint(payload.token_endpoint, issuer, 'token endpoint'),
    revocationEndpoint: endpoint(payload.revocation_endpoint, issuer, 'revocation endpoint'),
  };
}

async function formRequest(
  fetcher: typeof fetch,
  url: string,
  body: URLSearchParams,
): Promise<Response> {
  try {
    return await fetcher(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CliError(
      'OIDC_UNAVAILABLE',
      'OIDC token endpoint is unavailable',
      8,
      undefined,
      undefined,
      true,
    );
  }
}

function tokenResult(
  payload: Record<string, unknown>,
  requiredScopes: readonly string[],
  previousRefresh?: string,
): TokenResult {
  const scopes =
    typeof payload.scope === 'string' ? payload.scope.trim().split(/\s+/).filter(Boolean) : [];
  if (
    typeof payload.access_token !== 'string' ||
    payload.access_token === '' ||
    payload.token_type !== 'Bearer' ||
    typeof payload.expires_in !== 'number' ||
    payload.expires_in <= 0 ||
    (payload.refresh_token !== undefined && typeof payload.refresh_token !== 'string') ||
    (payload.refresh_expires_in !== undefined &&
      (typeof payload.refresh_expires_in !== 'number' || payload.refresh_expires_in <= 0)) ||
    scopes.length === 0
  ) {
    throw new CliError('OIDC_RESPONSE_INVALID', 'OIDC token response is invalid', 9);
  }
  if (scopes.includes('ui4a:approve')) {
    throw new CliError('AUTH_SCOPE_INVALID', 'CLI credential contains forbidden approval scope', 4);
  }
  if (requiredScopes.some((scope) => !scopes.includes(scope))) {
    throw new CliError('AUTH_SCOPE_INVALID', 'CLI credential is missing a required scope', 4);
  }
  const refreshToken = payload.refresh_token ?? previousRefresh;
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    throw new CliError('OIDC_RESPONSE_INVALID', 'OIDC refresh credential is missing', 9);
  }
  return {
    accessToken: payload.access_token,
    refreshToken,
    expiresInSeconds: payload.expires_in,
    refreshExpiresInSeconds:
      typeof payload.refresh_expires_in === 'number' ? payload.refresh_expires_in : 0,
    scopes,
  };
}

function key(config: CliConfig): CredentialKey {
  if (config.issuer === undefined) {
    throw new CliError('AUTH_CONFIG_REQUIRED', 'UI4A_ISSUER is required', 3);
  }
  return { issuer: config.issuer, clientId: config.clientId };
}

function requestedScopes(config: CliConfig): string[] {
  if (config.applications.length === 0) {
    throw new CliError(
      'AUTH_CONFIG_REQUIRED',
      'At least one UI4A application grant is required',
      3,
    );
  }
  return ['openid', ...requiredCredentialScopes(config)];
}

function requiredCredentialScopes(config: CliConfig): string[] {
  return [
    'offline_access',
    'ui4a:read',
    'ui4a:write',
    ...config.applications.map((application) => `ui4a:policy:${application}`),
  ];
}

export async function deviceLogin(
  config: CliConfig,
  dependencies: AuthDependencies,
): Promise<Omit<TokenResult, 'accessToken' | 'refreshToken'>> {
  const discovery = await discover(config, dependencies.fetch);
  const deviceResponse = await formRequest(
    dependencies.fetch,
    discovery.deviceAuthorizationEndpoint,
    new URLSearchParams({ client_id: config.clientId, scope: requestedScopes(config).join(' ') }),
  );
  if (!deviceResponse.ok) {
    throw new CliError(
      'AUTH_DEVICE_FAILED',
      'OIDC Device authorization failed',
      4,
      deviceResponse.status,
    );
  }
  const device = await json(deviceResponse);
  if (
    typeof device.device_code !== 'string' ||
    typeof device.user_code !== 'string' ||
    typeof device.verification_uri !== 'string' ||
    typeof device.expires_in !== 'number' ||
    typeof device.interval !== 'number' ||
    device.expires_in <= 0 ||
    device.expires_in > 1_800 ||
    device.interval <= 0 ||
    device.interval > 60
  ) {
    throw new CliError('OIDC_RESPONSE_INVALID', 'OIDC Device response is invalid', 9);
  }
  const verificationUri = new URL(device.verification_uri);
  if (
    verificationUri.protocol !== 'https:' ||
    verificationUri.origin !== new URL(discovery.issuer).origin
  ) {
    throw new CliError('OIDC_RESPONSE_INVALID', 'OIDC verification URI is not trusted', 9);
  }
  await dependencies.notify?.({
    verificationUri: device.verification_uri,
    ...(typeof device.verification_uri_complete === 'string'
      ? { verificationUriComplete: device.verification_uri_complete }
      : {}),
    userCode: device.user_code,
    expiresInSeconds: device.expires_in,
  });
  const now = dependencies.now ?? Date.now;
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const expiresAt = now() + device.expires_in * 1_000;
  let intervalMs = device.interval * 1_000;
  while (now() < expiresAt) {
    const tokenResponse = await formRequest(
      dependencies.fetch,
      discovery.tokenEndpoint,
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: config.clientId,
        device_code: device.device_code,
      }),
    );
    const payload = await json(tokenResponse);
    if (tokenResponse.ok) {
      const token = tokenResult(payload, requiredCredentialScopes(config));
      await dependencies.store.write(key(config), {
        schemaVersion: 1,
        refreshToken: token.refreshToken,
      });
      return {
        expiresInSeconds: token.expiresInSeconds,
        refreshExpiresInSeconds: token.refreshExpiresInSeconds,
        scopes: token.scopes,
      };
    }
    if (payload.error === 'authorization_pending') {
      await sleep(intervalMs);
      continue;
    }
    if (payload.error === 'slow_down') {
      intervalMs += 5_000;
      await sleep(intervalMs);
      continue;
    }
    const denied = payload.error === 'access_denied' || payload.error === 'expired_token';
    throw new CliError(
      denied ? 'AUTH_DEVICE_DENIED' : 'AUTH_DEVICE_FAILED',
      denied ? 'OIDC Device authorization was denied or expired' : 'OIDC Device polling failed',
      4,
      tokenResponse.status,
    );
  }
  throw new CliError('AUTH_DEVICE_DENIED', 'OIDC Device authorization expired', 4);
}

export async function refreshAccessCredential(
  config: CliConfig,
  dependencies: Pick<AuthDependencies, 'fetch' | 'store'>,
): Promise<string> {
  const stored = await dependencies.store.read(key(config));
  if (stored === undefined) throw new CliError('AUTH_LOGIN_REQUIRED', 'Run ui4a auth login', 4);
  const discovery = await discover(config, dependencies.fetch);
  const response = await formRequest(
    dependencies.fetch,
    discovery.tokenEndpoint,
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: stored.refreshToken,
    }),
  );
  if (!response.ok)
    throw new CliError('AUTH_REFRESH_FAILED', 'CLI credential refresh failed', 4, response.status);
  const token = tokenResult(
    await json(response),
    requiredCredentialScopes(config),
    stored.refreshToken,
  );
  await dependencies.store.write(key(config), {
    schemaVersion: 1,
    refreshToken: token.refreshToken,
  });
  return token.accessToken;
}

export async function revokeStoredCredential(
  config: CliConfig,
  dependencies: Pick<AuthDependencies, 'fetch' | 'store'>,
): Promise<boolean> {
  const stored = await dependencies.store.read(key(config));
  if (stored === undefined) return false;
  const discovery = await discover(config, dependencies.fetch);
  const response = await formRequest(
    dependencies.fetch,
    discovery.revocationEndpoint,
    new URLSearchParams({
      client_id: config.clientId,
      token: stored.refreshToken,
      token_type_hint: 'refresh_token',
    }),
  );
  if (!response.ok)
    throw new CliError(
      'AUTH_REVOKE_FAILED',
      'CLI credential revocation failed',
      4,
      response.status,
    );
  await dependencies.store.delete(key(config));
  return true;
}
