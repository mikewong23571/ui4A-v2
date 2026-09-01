import { createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type { ProductionDeploymentConfig } from '@ui4a/shared';

import {
  createKeycloakBrowserTokenAdapter,
  createProductionBrowserAuthentication,
  PRODUCTION_BROWSER_LOGIN_COOKIE,
  PRODUCTION_BROWSER_SESSION_COOKIE,
} from './production-browser-authentication';
import { createRemoteJwksLoader, verifyProductionIdToken } from './production/request-identity';
import { BrowserAuthenticationError, type AuthPrivateStore } from './browser-session';
import { authenticationErrorResponse, resolveTrustedRequestIdentity } from './request-identity';

const NOW_SECONDS = 1_788_739_200;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const ISSUER = 'https://auth.ui4a.mothership.internal/realms/ui4a';
const API_AUDIENCE = 'ui4a-api';
const CLIENT_ID = 'ui4a-web';
const CLIENT_SECRET = '__fixed_confidential_client_secret__';
const KEY_ID = 'ui4a-browser-composition-fixture-1';

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDVBCxY89awO3UM
qvDM+6GG59CED+d5tdqtQ5G1elAW02rmVYztloacnlMC9WyqM2G2ZzDIui+uNDNb
IF91+YfhjLCFVju6ILU8zInTdIX1KCjXe2d9w8u0kuSlG9Y9/FXllU/5zLa6rVyt
4OJ1Z8jZXEEG/7lIJT0JicQqJcG7lLjCTFTiYqviEisnocPz+9lo69tzMBc9ncOa
alJ8b6kIk0bZWRv4D6JxroiDty0USKoQe6Te6TKEDFFiGjXfr8gTz+DFiLknpNxM
BaBk8mRqw4W4vrhEpjzhSheVzcdn7UjpngdArMa9SPi1GQweQnUCWL6wl9fBp/Yp
Z5wjftI1AgMBAAECggEAECCVgfOOFsAdo8SiYAaSC15sHz98AS83O+RweOqmex/t
CTzDY26AyQVEmCYAIN+sf2yPGTddakU5+SV5jLtEYhtudt3ZPkWBKzX6HlgFV1L/
ypaldnRXLRfs9yIlJYK/9xaHnEw3Lml3KZPr2UMvBePR6Yd9Xdyx4xG62A0NPpgH
uHdJjFNFtITg4IURtkP17tC5wHm2BViw5RxvsdLE1al1xby33+oYA3atWUMNPKpF
ImCScIgOGSaduthoGUb81gWHdFw+ElqVuBbj8UFBLlhcuyWDPmymSZnpvUn256ca
gXcOUUVMeOh70Bq5jWYby3OTvUcg3uiH2LzXELlhGQKBgQD5ShjuBBlQYEiZZNa8
VE6coZh5ceY/a+7iY1pLe+kAHj07gIs2kETCSksgpqUmGYyK58tiSSoRn7ZSS8oy
SevZz0FJcSmOjvlstPHuUMAiWRUGfcSfaan2uq3Z+fPIETvD/Z/p2SixrLlOGUsH
CYf+JcgtZQaCmGa0vmxM4FaJWQKBgQDawBxJY5c5pVTx5mVtiCP/iMwzhU7s4TB1
1LgK6Oxe4Wu6+lxUlc2+KbNCGXD8w/Df71ff+21YHQpTeOcp3yeD+3RKvjH5EslH
mGMPPQ/i7F0QUHDPKySwApzXm8oYo8nTNphrhxX+EY6BzjlG8rgbVFkyVGj9p5bw
8S7JFkXYPQKBgQDXR5oH0hpaQwvvDBo1QUkyEosuNaJ1GqyNbOdJUJSCuZp/jB6s
3CHE94uxgrgUEvQ/8LS/CBgAaEB3CWRv0U6QJl9nIQaWSfo0Wn6jI7EI+I0jsfDf
CczxeX0xRJ22JMvMEXbL5/EwnszYGRel2CFM5Svdp+TbWuk3JUs5iHKy4QKBgDB5
oAsXWby5iaBteQ6Tu7511yKXqQzPPkjuUbaBNVg1RgVSU8GezNAWN5YvQx2QYkGN
rYCCHBIJpW8n/LoHrJ8Pyw6BJVvXsOj/uPv4gRu9W0YxPT57hg7HFXCmIlvhd+kp
UQ+LCPGbfGQBiinRwcC0qWuAzx9e0xEjsUV4fRPVAoGAMpEGgvtgiVoqyxu5j8h1
NL5TLpOWRKpQY3B9/FVDBX8SY/2mjelrPDmZeuDojN/+uLGhWX8vNNANfdT4CZql
I/J7JYSnwjfOq24CBzLcDjyxRCHwI22SCU/WhnXykUIEWu0msNgYAw53nLGj6wxw
YS9F+AWcQVUyFoSBAeQl8xs=
-----END PRIVATE KEY-----`;

const PUBLIC_JWK = {
  kty: 'RSA',
  use: 'sig',
  alg: 'RS256',
  kid: KEY_ID,
  n: '1QQsWPPWsDt1DKrwzPuhhufQhA_nebXarUORtXpQFtNq5lWM7ZaGnJ5TAvVsqjNhtmcwyLovrjQzWyBfdfmH4YywhVY7uiC1PMyJ03SF9Sgo13tnfcPLtJLkpRvWPfxV5ZVP-cy2uq1creDidWfI2VxBBv-5SCU9CYnEKiXBu5S4wkxU4mKr4hIrJ6HD8_vZaOvbczAXPZ3DmmpSfG-pCJNG2Vkb-A-ica6Ig7ctFEiqEHuk3ukyhAxRYho136_IE8_gxYi5J6TcTAWgZPJkasOFuL64RKY84UoXlc3HZ-1I6Z4HQKzGvUj4tRkMHkJ1Ali-sJfXwaf2KWecI37SNQ',
  e: 'AQAB',
} as const;

function idToken(claims: Record<string, unknown> = {}): string {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }),
  ).toString('base64url');
  const encodedClaims = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'human-alice',
      nonce: 'fixed-nonce',
      nbf: NOW_SECONDS - 30,
      exp: NOW_SECONDS + 300,
      ...claims,
    }),
  ).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), createPrivateKey(PRIVATE_KEY));
  return `${signingInput}.${signature.toString('base64url')}`;
}

const ID_TOKEN_DEPENDENCIES = {
  clock: () => NOW_MILLISECONDS,
  jwks: {
    load: async () => ({
      keys: [PUBLIC_JWK],
      fetchedAtMs: NOW_MILLISECONDS - 1_000,
      expiresAtMs: NOW_MILLISECONDS + 60_000,
    }),
  },
};

class MemoryStore implements AuthPrivateStore {
  readonly records = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.records.get(key);
  }

  async put(key: string, value: unknown): Promise<void> {
    this.records.set(key, value);
  }

  async take(key: string): Promise<unknown> {
    const value = this.records.get(key);
    this.records.delete(key);
    return value;
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

const COMPOSITION_CONFIG = {
  settings: {
    service: { publicOrigin: 'https://ui4a.mothership.internal' },
    auth: {
      mode: 'oidc',
      oidc: {
        issuer: ISSUER,
        audience: API_AUDIENCE,
        clientId: CLIENT_ID,
        clientSecretRef: 'oidc-client-secret',
        sessionSecretRef: 'oidc-session-secret',
        agentClientId: 'ui4a-agent',
        agentClientSecretRef: 'oidc-agent-client-secret',
        agentScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
        callbackUrl: 'https://ui4a.mothership.internal/api/auth/callback',
        scopes: ['openid', 'ui4a:read'],
      },
    },
  },
  secrets: {
    'oidc-client-secret': CLIENT_SECRET,
    'oidc-session-secret': 'short-independent',
    'oidc-agent-client-secret': 'fixed-agent-client-secret',
  },
} as unknown as ProductionDeploymentConfig;

describe('production Keycloak browser protocol adapters', () => {
  it('composes the canonical issuer, callback, cookies, and independent session secret', async () => {
    let randomValue = 0;
    const authentication = createProductionBrowserAuthentication({
      config: COMPOSITION_CONFIG,
      store: new MemoryStore(),
      clock: () => NOW_MILLISECONDS,
      randomBytes: (size) => {
        randomValue += 1;
        return Uint8Array.from({ length: size }, (_, index) => randomValue + index);
      },
      sha256: (value) => Buffer.from(value),
      fetch: vi.fn() as typeof globalThis.fetch,
      credentialDependencies: ID_TOKEN_DEPENDENCIES,
    });

    const response = await authentication.beginLogin(
      new Request('https://ui4a.mothership.internal/auth/login?returnTo=%2Fmeta'),
    );
    const authorization = new URL(response.headers.get('location')!);

    expect(`${authorization.origin}${authorization.pathname}`).toBe(
      `${ISSUER}/protocol/openid-connect/auth`,
    );
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      'https://ui4a.mothership.internal/api/auth/callback',
    );
    expect(response.headers.get('set-cookie')).toContain(`${PRODUCTION_BROWSER_LOGIN_COOKIE}=`);
    expect(response.headers.get('set-cookie')).not.toContain(CLIENT_SECRET);
  });

  it('completes a callback with an ID Token addressed to the browser client', async () => {
    let callbackNonce = '';
    let randomValue = 0;
    const fetcher = vi.fn(async () =>
      Response.json({
        access_token: 'browser-access-token',
        id_token: idToken({ aud: CLIENT_ID, nonce: callbackNonce }),
        refresh_token: 'browser-refresh-token',
        expires_in: 300,
        refresh_expires_in: 3_600,
      }),
    ) as typeof globalThis.fetch;
    const authentication = createProductionBrowserAuthentication({
      config: COMPOSITION_CONFIG,
      store: new MemoryStore(),
      clock: () => NOW_MILLISECONDS,
      randomBytes: (size) => {
        randomValue += 1;
        return Uint8Array.from({ length: size }, (_, index) => randomValue * 13 + index);
      },
      fetch: fetcher,
      credentialDependencies: ID_TOKEN_DEPENDENCIES,
    });

    const login = await authentication.beginLogin(
      new Request('https://ui4a.mothership.internal/auth/login'),
    );
    const authorization = new URL(login.headers.get('location')!);
    callbackNonce = authorization.searchParams.get('nonce')!;
    const state = authorization.searchParams.get('state')!;
    const loginCookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
    const callback = await authentication.completeCallback(
      new Request(
        `https://ui4a.mothership.internal/api/auth/callback?code=fixed-code&state=${state}`,
        { headers: { cookie: loginCookie } },
      ),
    );

    expect(callback.status).toBe(303);
    expect(callback.headers.get('set-cookie')).toContain(`${PRODUCTION_BROWSER_SESSION_COOKIE}=`);
    const sessionCookie = callback.headers.get('set-cookie')!.split(';', 1)[0]!;
    await expect(
      authentication.resolveSession(
        new Request('https://ui4a.mothership.internal/api/entity', {
          headers: { cookie: sessionCookie },
        }),
      ),
    ).resolves.toEqual({
      authorizationHeader: 'Bearer browser-access-token',
      expiresAtMs: NOW_MILLISECONDS + 300_000,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('posts the confidential Authorization Code + PKCE form and returns bounded token expiry', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json({
        access_token: 'access-token',
        id_token: 'id-token',
        refresh_token: 'refresh-token',
        expires_in: 60,
        refresh_expires_in: 3_600,
      });
    }) as typeof globalThis.fetch;
    const adapter = createKeycloakBrowserTokenAdapter({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      clock: () => NOW_MILLISECONDS,
      fetch: fetcher,
    });

    const result = await adapter.exchangeCode({
      code: 'authorization-code',
      codeVerifier: 'fixed-pkce-verifier',
      redirectUri: 'https://ui4a.mothership.internal/api/auth/callback',
      clientId: CLIENT_ID,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(`${ISSUER}/protocol/openid-connect/token`);
    expect(requests[0]!.init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(Object.fromEntries(requests[0]!.init!.body as URLSearchParams)).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: 'authorization-code',
      code_verifier: 'fixed-pkce-verifier',
      redirect_uri: 'https://ui4a.mothership.internal/api/auth/callback',
    });
    expect(result).toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      accessExpiresAtMs: NOW_MILLISECONDS + 60_000,
      refreshExpiresAtMs: NOW_MILLISECONDS + 3_600_000,
    });
    expect(JSON.stringify(result)).not.toContain(CLIENT_SECRET);
    expect(PRODUCTION_BROWSER_SESSION_COOKIE).toBe('__Host-ui4a_session');
    expect(PRODUCTION_BROWSER_LOGIN_COOKIE).toBe('__Host-ui4a_login');
  });

  it.each(['refresh', 'revoke'] as const)(
    'forbids redirects while posting the confidential %s form',
    async (operation) => {
      const requests: RequestInit[] = [];
      const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        requests.push(init ?? {});
        return operation === 'refresh'
          ? Response.json({
              access_token: 'access-token',
              id_token: 'id-token',
              refresh_token: 'rotated-refresh-token',
              expires_in: 60,
              refresh_expires_in: 3_600,
            })
          : new Response(null, { status: 204 });
      }) as typeof globalThis.fetch;
      const adapter = createKeycloakBrowserTokenAdapter({
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        fetch: fetcher,
      });

      if (operation === 'refresh') await adapter.refresh('private-refresh-token');
      else await adapter.revoke('private-refresh-token');

      expect(fetcher).toHaveBeenCalledOnce();
      expect(requests[0]?.redirect).toBe('error');
    },
  );

  it('pins JWKS loading to the configured issuer origin by forbidding redirects', async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return Response.json({ keys: [PUBLIC_JWK] }, { headers: { 'cache-control': 'max-age=60' } });
    }) as typeof globalThis.fetch;
    const loader = createRemoteJwksLoader({
      url: `${ISSUER}/protocol/openid-connect/certs`,
      clock: () => NOW_MILLISECONDS,
      fetch: fetcher,
    });

    await loader.load();

    expect(fetcher).toHaveBeenCalledOnce();
    expect(requests[0]?.redirect).toBe('error');
  });

  it.each([
    ['refresh', 'session_refresh_unavailable'],
    ['revoke', 'oidc_revocation_unavailable'],
  ] as const)('folds a %s outage to a stable secret-free error', async (operation, code) => {
    const adapter = createKeycloakBrowserTokenAdapter({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch: vi.fn(async () => {
        throw new Error(`upstream failed with ${CLIENT_SECRET}`);
      }) as typeof globalThis.fetch,
    });

    const error = await (
      operation === 'refresh'
        ? adapter.refresh('private-refresh-token')
        : adapter.revoke('private-refresh-token')
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code, message: code });
    expect(JSON.stringify(error)).not.toContain(CLIENT_SECRET);
  });

  it.each([
    ['session_expired', 401],
    ['session_refresh_unavailable', 503],
  ] as const)('maps browser authentication %s to a stable HTTP response', async (code, status) => {
    const response = authenticationErrorResponse(new BrowserAuthenticationError(code));
    const responseText = await response?.clone().text();

    expect(response?.status).toBe(status);
    await expect(response?.json()).resolves.toEqual({ error: { code } });
    expect(responseText).not.toContain(CLIENT_SECRET);
  });

  it.each([
    ['no credential', undefined],
    ['lookalike cookie name', `${PRODUCTION_BROWSER_SESSION_COOKIE}X=opaque.mac`],
  ])('keeps credential_missing for %s', async (_name, cookie) => {
    const resolveSession = vi.fn();
    const request = new Request('https://ui4a.mothership.internal/api/entity', {
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });

    await expect(
      resolveTrustedRequestIdentity(request, {
        profile: 'production',
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['development'],
        productionPolicy: {
          issuer: ISSUER,
          audience: API_AUDIENCE,
          algorithms: ['RS256'],
          humanClientIds: [CLIENT_ID],
          agentClientIds: [],
          delegatedScopesByClient: {},
          agentCredentialSourcesByClient: {},
        },
        productionDependencies: ID_TOKEN_DEPENDENCIES,
        browserAuthentication: { resolveSession },
      }),
    ).rejects.toMatchObject({ code: 'credential_missing' });
    expect(resolveSession).not.toHaveBeenCalled();
  });
});

describe('production browser ID Token verification', () => {
  it('accepts a signed ID Token without requiring an access-token scope claim', async () => {
    await expect(
      verifyProductionIdToken(
        idToken(),
        { issuer: ISSUER, audience: CLIENT_ID, nonce: 'fixed-nonce' },
        ID_TOKEN_DEPENDENCIES,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['issuer', { iss: 'https://issuer.invalid/realms/ui4a' }, 'issuer_mismatch'],
    ['nonce', { nonce: 'wrong-nonce' }, 'oidc_nonce_mismatch'],
  ])('rejects a correctly signed ID Token with the wrong %s', async (_name, claims, code) => {
    await expect(
      verifyProductionIdToken(
        idToken(claims),
        { issuer: ISSUER, audience: CLIENT_ID, nonce: 'fixed-nonce' },
        ID_TOKEN_DEPENDENCIES,
      ),
    ).rejects.toMatchObject({ code });
  });
});
