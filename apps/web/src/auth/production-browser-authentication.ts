import { createHash, randomBytes } from 'node:crypto';

import type { ProductionDeploymentConfig } from '@ui4a/shared';

import { createPostgresAuthPrivateStore } from '../db/auth-private-store';
import { getDb } from '../engine/service';
import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';

import {
  BROWSER_LOGIN_COOKIE_NAME,
  BROWSER_SESSION_COOKIE_NAME,
  BrowserAuthenticationError,
  createBrowserAuthentication,
  type AuthPrivateStore,
  type BrowserAuthentication,
  type BrowserTokenSet,
} from './browser-session';
import {
  createRemoteJwksLoader,
  ProductionIdentityError,
  verifyProductionIdToken,
  type ProductionCredentialDependencies,
} from './production-request-identity';

export const PRODUCTION_BROWSER_SESSION_COOKIE = BROWSER_SESSION_COOKIE_NAME;
export const PRODUCTION_BROWSER_LOGIN_COOKIE = BROWSER_LOGIN_COOKIE_NAME;

export interface KeycloakBrowserTokenAdapter {
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): Promise<BrowserTokenSet>;
  refresh(refreshToken: string): Promise<BrowserTokenSet>;
  revoke(refreshToken: string): Promise<void>;
}

interface KeycloakTokenPayload {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}

function browserError(code: ConstructorParameters<typeof BrowserAuthenticationError>[0]): never {
  throw new BrowserAuthenticationError(code);
}

function tokenPayload(value: unknown): KeycloakTokenPayload | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.access_token !== 'string' ||
    candidate.access_token === '' ||
    typeof candidate.id_token !== 'string' ||
    candidate.id_token === '' ||
    typeof candidate.refresh_token !== 'string' ||
    candidate.refresh_token === '' ||
    typeof candidate.expires_in !== 'number' ||
    !Number.isFinite(candidate.expires_in) ||
    candidate.expires_in <= 0 ||
    typeof candidate.refresh_expires_in !== 'number' ||
    !Number.isFinite(candidate.refresh_expires_in) ||
    candidate.refresh_expires_in <= 0
  ) {
    return undefined;
  }
  return candidate as unknown as KeycloakTokenPayload;
}

function deriveBrowserSessionKey(secret: string): Uint8Array {
  return createHash('sha256')
    .update('ui4a/browser-session-hmac/v1', 'utf8')
    .update('\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Build the confidential-client Keycloak token, refresh, and revocation adapter. */
export function createKeycloakBrowserTokenAdapter(input: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  clock?: () => number;
  fetch?: typeof globalThis.fetch;
}): KeycloakBrowserTokenAdapter {
  const clock = input.clock ?? Date.now;
  const fetcher = input.fetch ?? globalThis.fetch;
  const tokenEndpoint = `${input.issuer}/protocol/openid-connect/token`;
  const revocationEndpoint = `${input.issuer}/protocol/openid-connect/revoke`;

  async function requestTokens(
    parameters: URLSearchParams,
    failure: 'oidc_token_endpoint_unavailable' | 'session_refresh_unavailable',
  ): Promise<BrowserTokenSet> {
    let response: Response;
    try {
      response = await fetcher(tokenEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: parameters,
        cache: 'no-store',
      });
    } catch {
      return browserError(failure);
    }
    if (!response.ok) {
      if (failure === 'session_refresh_unavailable' && [400, 401].includes(response.status)) {
        return browserError('session_revoked');
      }
      return browserError(failure);
    }
    const payload = tokenPayload(await responseJson(response));
    if (payload === undefined) return browserError(failure);
    const now = clock();
    const accessExpiresAtMs = now + payload.expires_in * 1_000;
    const refreshExpiresAtMs = now + payload.refresh_expires_in * 1_000;
    if (!Number.isFinite(accessExpiresAtMs) || !Number.isFinite(refreshExpiresAtMs)) {
      return browserError(failure);
    }
    return {
      accessToken: payload.access_token,
      idToken: payload.id_token,
      refreshToken: payload.refresh_token,
      accessExpiresAtMs,
      refreshExpiresAtMs,
    };
  }

  function confidentialClientParameters(): URLSearchParams {
    return new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
    });
  }

  return {
    async exchangeCode(exchange) {
      const parameters = confidentialClientParameters();
      parameters.set('grant_type', 'authorization_code');
      parameters.set('code', exchange.code);
      parameters.set('code_verifier', exchange.codeVerifier);
      parameters.set('redirect_uri', exchange.redirectUri);
      return requestTokens(parameters, 'oidc_token_endpoint_unavailable');
    },

    async refresh(refreshToken) {
      const parameters = confidentialClientParameters();
      parameters.set('grant_type', 'refresh_token');
      parameters.set('refresh_token', refreshToken);
      return requestTokens(parameters, 'session_refresh_unavailable');
    },

    async revoke(refreshToken) {
      const parameters = confidentialClientParameters();
      parameters.set('token', refreshToken);
      parameters.set('token_type_hint', 'refresh_token');
      let response: Response;
      try {
        response = await fetcher(revocationEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: parameters,
          cache: 'no-store',
        });
      } catch {
        return browserError('oidc_revocation_unavailable');
      }
      if (!response.ok) return browserError('oidc_revocation_unavailable');
    },
  };
}

export interface ProductionBrowserAuthenticationInput {
  config: ProductionDeploymentConfig;
  store: AuthPrivateStore;
  clock?: () => number;
  fetch?: typeof globalThis.fetch;
  randomBytes?: (size: number) => Uint8Array;
  sha256?: (value: Uint8Array) => Uint8Array;
  credentialDependencies?: ProductionCredentialDependencies;
}

/** Compose browser lifecycle, Keycloak protocol adapters, ID Token verification, and private store. */
export function createProductionBrowserAuthentication(
  input: ProductionBrowserAuthenticationInput,
): BrowserAuthentication {
  const { config } = input;
  const oidc = config.settings.auth.oidc;
  const clock = input.clock ?? Date.now;
  const tokenAdapter = createKeycloakBrowserTokenAdapter({
    issuer: oidc.issuer,
    clientId: oidc.clientId,
    clientSecret: config.secrets[oidc.clientSecretRef]!,
    clock,
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  const credentialDependencies =
    input.credentialDependencies ??
    ({
      clock,
      jwks: createRemoteJwksLoader({
        url: `${oidc.issuer}/protocol/openid-connect/certs`,
        clock,
        ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      }),
    } satisfies ProductionCredentialDependencies);

  return createBrowserAuthentication({
    policy: {
      issuer: oidc.issuer,
      authorizationEndpoint: `${oidc.issuer}/protocol/openid-connect/auth`,
      clientId: oidc.clientId,
      audience: oidc.clientId,
      redirectUri: oidc.callbackUrl,
      scopes: [...oidc.scopes],
      sessionCookieName: PRODUCTION_BROWSER_SESSION_COOKIE,
      loginCookieName: PRODUCTION_BROWSER_LOGIN_COOKIE,
      sessionTtlMs: 8 * 60 * 60_000,
      loginTtlMs: 10 * 60_000,
      refreshBeforeExpiryMs: 60_000,
      defaultReturnTo: '/',
      allowedReturnOrigin: config.settings.service.publicOrigin,
    },
    sessionKey: deriveBrowserSessionKey(config.secrets[oidc.sessionSecretRef]!),
    clock,
    randomBytes: input.randomBytes ?? ((size) => randomBytes(size)),
    sha256: input.sha256 ?? ((value) => createHash('sha256').update(value).digest()),
    loginTransactions: input.store,
    sessions: input.store,
    ...tokenAdapter,
    async verifyIdToken(idToken, expected) {
      try {
        await verifyProductionIdToken(idToken, expected, credentialDependencies);
      } catch (error) {
        if (error instanceof ProductionIdentityError) {
          if (error.code === 'oidc_nonce_mismatch') return browserError('oidc_nonce_mismatch');
          if (error.code === 'jwks_unavailable' || error.code === 'jwks_stale') {
            return browserError('jwks_unavailable');
          }
          return browserError('oidc_id_token_invalid');
        }
        return browserError('oidc_id_token_invalid');
      }
    },
  });
}

let productionBrowserAuthentication: BrowserAuthentication | undefined;

/** Lazily compose the process singleton after production preflight has resolved canonical config. */
export function getProductionBrowserAuthentication(): BrowserAuthentication {
  if (productionBrowserAuthentication !== undefined) return productionBrowserAuthentication;
  const config = runWebProductionDeploymentPreflight();
  if (config === undefined) {
    throw new Error('production browser authentication requires the production deployment profile');
  }
  const clock = Date.now;
  productionBrowserAuthentication = createProductionBrowserAuthentication({
    config,
    clock,
    store: createPostgresAuthPrivateStore(getDb(), { clock }),
  });
  return productionBrowserAuthentication;
}
