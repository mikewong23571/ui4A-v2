import { createHash, createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { resolveTrustedRequestIdentity } from './request-identity';

const NOW_SECONDS = 1_788_739_200;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const ISSUER = 'https://auth.ui4a.mothership.internal/realms/ui4a';
const UI4A_ORIGIN = 'https://ui4a.mothership.internal';
const AUDIENCE = 'ui4a-api';
const CLIENT_ID = 'ui4a-web';
const KEY_ID = 'ui4a-browser-auth-fixture-1';
const SESSION_COOKIE = '__Host-ui4a_session';
const LOGIN_COOKIE = '__Host-ui4a_login';

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

interface AuthPrivateStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, expiresAtMs: number): Promise<void>;
  take(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface BrowserTokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  accessExpiresAtMs: number;
  refreshExpiresAtMs: number;
}

interface BrowserAuthentication {
  beginLogin(request: Request): Promise<Response>;
  completeCallback(request: Request): Promise<Response>;
  resolveSession(request: Request): Promise<{
    authorizationHeader: string;
    expiresAtMs: number;
  }>;
  logout(request: Request): Promise<Response>;
}

interface BrowserAuthenticationModule {
  createBrowserAuthentication(input: {
    policy: {
      issuer: string;
      authorizationEndpoint: string;
      clientId: string;
      audience: string;
      redirectUri: string;
      scopes: string[];
      sessionCookieName: string;
      loginCookieName: string;
      sessionTtlMs: number;
      loginTtlMs: number;
      refreshBeforeExpiryMs: number;
      defaultReturnTo: string;
      allowedReturnOrigin: string;
    };
    sessionKey: Uint8Array;
    clock(): number;
    randomBytes(size: number): Uint8Array;
    sha256(value: Uint8Array): Uint8Array;
    loginTransactions: AuthPrivateStore;
    sessions: AuthPrivateStore;
    exchangeCode(input: {
      code: string;
      codeVerifier: string;
      redirectUri: string;
      clientId: string;
    }): Promise<BrowserTokenSet>;
    refresh(refreshToken: string): Promise<BrowserTokenSet>;
    revoke(refreshToken: string): Promise<void>;
    verifyIdToken(
      idToken: string,
      expected: { issuer: string; nonce: string; audience: string },
    ): Promise<void>;
  }): BrowserAuthentication;
}

class MemoryAuthPrivateStore implements AuthPrivateStore {
  readonly records = new Map<string, { value: unknown; expiresAtMs: number }>();

  async get(key: string): Promise<unknown> {
    return this.records.get(key)?.value;
  }

  async put(key: string, value: unknown, expiresAtMs: number): Promise<void> {
    this.records.set(key, { value, expiresAtMs });
  }

  async take(key: string): Promise<unknown> {
    const value = this.records.get(key)?.value;
    this.records.delete(key);
    return value;
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }
}

const plannedModulePath = './browser-session';

async function plannedApi(): Promise<BrowserAuthenticationModule> {
  return (await import(plannedModulePath)) as BrowserAuthenticationModule;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function accessToken(claims: Record<string, unknown> = {}): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }));
  const payload = base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'human-alice',
      azp: CLIENT_ID,
      scope: 'openid ui4a:read ui4a:write ui4a:approve development governance',
      iat: NOW_SECONDS - 30,
      nbf: NOW_SECONDS - 30,
      exp: NOW_SECONDS + 300,
      ...claims,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), createPrivateKey(PRIVATE_KEY));
  return `${signingInput}.${base64Url(signature)}`;
}

function cookieFrom(response: Response, name: string): string {
  const setCookie = response.headers.get('set-cookie');
  if (setCookie === null) throw new Error(`missing Set-Cookie for ${name}`);
  const match = new RegExp(`(?:^|,\\s*)(${name}=[^;]*)`).exec(setCookie);
  if (match?.[1] === undefined) throw new Error(`missing cookie ${name}`);
  return match[1];
}

function requestWithCookie(url: string, cookie: string): Request {
  return new Request(url, { headers: { cookie } });
}

async function responseCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

async function expectAuthCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

function makeHarness(overrides: Record<string, unknown> = {}) {
  let now = NOW_MILLISECONDS;
  let randomCounter = 0;
  const exchanges: Array<{
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }> = [];
  const nonceChecks: Array<{
    idToken: string;
    issuer: string;
    nonce: string;
    audience: string;
  }> = [];
  const refreshes: string[] = [];
  const revocations: string[] = [];
  const loginTransactions = new MemoryAuthPrivateStore();
  const sessions = new MemoryAuthPrivateStore();
  const initialTokens: BrowserTokenSet = {
    accessToken: accessToken(),
    idToken: 'fixed-id-token',
    refreshToken: 'fixed-refresh-token',
    accessExpiresAtMs: NOW_MILLISECONDS + 60_000,
    refreshExpiresAtMs: NOW_MILLISECONDS + 3_600_000,
  };
  const refreshedTokens: BrowserTokenSet = {
    ...initialTokens,
    accessToken: accessToken({ exp: NOW_SECONDS + 900 }),
    refreshToken: 'rotated-refresh-token',
    accessExpiresAtMs: NOW_MILLISECONDS + 900_000,
  };

  const dependencies = {
    policy: {
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/protocol/openid-connect/auth`,
      clientId: CLIENT_ID,
      audience: AUDIENCE,
      redirectUri: `${UI4A_ORIGIN}/api/auth/callback`,
      scopes: ['openid', 'profile', 'ui4a:read', 'ui4a:write', 'ui4a:approve'],
      sessionCookieName: SESSION_COOKIE,
      loginCookieName: LOGIN_COOKIE,
      sessionTtlMs: 3_600_000,
      loginTtlMs: 300_000,
      refreshBeforeExpiryMs: 30_000,
      defaultReturnTo: '/',
      allowedReturnOrigin: UI4A_ORIGIN,
    },
    // This key is an injected deployment secret. It is deliberately unrelated to state, nonce,
    // client id, or any token and the browser must never receive it.
    sessionKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    clock: () => now,
    randomBytes: (size: number) => {
      randomCounter += 1;
      return Uint8Array.from({ length: size }, (_, index) => (randomCounter * 29 + index) % 256);
    },
    sha256: (value: Uint8Array) => createHash('sha256').update(value).digest(),
    loginTransactions,
    sessions,
    exchangeCode: async (input: (typeof exchanges)[number]) => {
      exchanges.push(input);
      return initialTokens;
    },
    refresh: async (refreshToken: string) => {
      refreshes.push(refreshToken);
      return refreshedTokens;
    },
    revoke: async (refreshToken: string) => {
      revocations.push(refreshToken);
    },
    verifyIdToken: async (
      idToken: string,
      expected: { issuer: string; nonce: string; audience: string },
    ) => {
      nonceChecks.push({ idToken, ...expected });
    },
    ...overrides,
  };

  return {
    dependencies,
    exchanges,
    nonceChecks,
    refreshes,
    revocations,
    loginTransactions,
    sessions,
    initialTokens,
    refreshedTokens,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

async function startLogin(
  auth: BrowserAuthentication,
  returnTo = '/meta/entity?rel=meta%2Fflows&scope=governance',
  cookie?: string,
): Promise<{ response: Response; state: string; nonce: string; loginCookie: string }> {
  const headers = cookie === undefined ? undefined : { cookie };
  const response = await auth.beginLogin(
    new Request(`${UI4A_ORIGIN}/auth/login?returnTo=${encodeURIComponent(returnTo)}`, { headers }),
  );
  const location = new URL(response.headers.get('location')!);
  return {
    response,
    state: location.searchParams.get('state')!,
    nonce: location.searchParams.get('nonce')!,
    loginCookie: cookieFrom(response, LOGIN_COOKIE),
  };
}

async function completeLogin(
  auth: BrowserAuthentication,
  login: { state: string; loginCookie: string },
  code = 'fixed-authorization-code',
): Promise<Response> {
  return auth.completeCallback(
    requestWithCookie(
      `${UI4A_ORIGIN}/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(login.state)}`,
      login.loginCookie,
    ),
  );
}

describe('browser Authorization Code + S256 PKCE lifecycle', () => {
  it('starts a standards-shaped login and restores the exact safe pre-login target', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const location = new URL(login.response.headers.get('location')!);

    expect(login.response.status).toBe(302);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `${UI4A_ORIGIN}/api/auth/callback`,
      code_challenge_method: 'S256',
      state: login.state,
      nonce: login.nonce,
    });
    expect(location.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'ui4a:read']),
    );

    const callback = await completeLogin(auth, login);
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe(
      `${UI4A_ORIGIN}/meta/entity?rel=meta%2Fflows&scope=governance`,
    );
    expect(harness.exchanges).toHaveLength(1);
    const exchange = harness.exchanges[0]!;
    const expectedChallenge = base64Url(
      createHash('sha256').update(exchange.codeVerifier).digest(),
    );
    expect(location.searchParams.get('code_challenge')).toBe(expectedChallenge);
    expect(exchange).toMatchObject({
      code: 'fixed-authorization-code',
      redirectUri: `${UI4A_ORIGIN}/api/auth/callback`,
      clientId: CLIENT_ID,
    });
    expect(harness.nonceChecks).toEqual([
      {
        idToken: 'fixed-id-token',
        issuer: ISSUER,
        nonce: login.nonce,
        audience: AUDIENCE,
      },
    ]);
  });

  it('does not turn an absolute or cross-origin return target into an open redirect', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth, 'https://attacker.invalid/steal');
    const callback = await completeLogin(auth, login);

    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe(`${UI4A_ORIGIN}/`);
  });

  it.each([
    ['missing state', `${UI4A_ORIGIN}/auth/callback?code=code`, 'oidc_state_missing'],
    ['unknown state', `${UI4A_ORIGIN}/auth/callback?code=code&state=unknown`, 'oidc_state_invalid'],
    [
      'missing authorization code',
      `${UI4A_ORIGIN}/auth/callback?state=known`,
      'authorization_code_missing',
    ],
  ])('rejects %s before a token exchange', async (_name, url, code) => {
    const api = await plannedApi();
    const harness = makeHarness();
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const response = await auth.completeCallback(requestWithCookie(url, `${LOGIN_COOKIE}=opaque`));

    expect(response.status).toBe(400);
    expect(await responseCode(response)).toBe(code);
    expect(harness.exchanges).toHaveLength(0);
  });

  it('binds callback state to the initiating browser and validates the ID Token nonce', async () => {
    const api = await plannedApi();
    const harness = makeHarness({
      verifyIdToken: async () => {
        throw Object.assign(new Error('nonce mismatch'), { code: 'oidc_nonce_mismatch' });
      },
    });
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);

    const noCorrelation = await auth.completeCallback(
      new Request(`${UI4A_ORIGIN}/auth/callback?code=code&state=${login.state}`),
    );
    expect(noCorrelation.status).toBe(400);
    expect(await responseCode(noCorrelation)).toBe('login_correlation_missing');

    const nonceMismatch = await completeLogin(auth, login);
    expect(nonceMismatch.status).toBe(401);
    expect(await responseCode(nonceMismatch)).toBe('oidc_nonce_mismatch');
    expect(nonceMismatch.headers.get('set-cookie')).not.toContain(`${SESSION_COOKIE}=`);
  });

  it('keeps two tab states independent, consumes each once, and rejects replay of A', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const tabA = await startLogin(auth, '/app/publishing');
    const tabB = await startLogin(auth, '/meta', tabA.loginCookie);

    expect(tabA.state).not.toBe(tabB.state);
    const callbackA = await completeLogin(auth, tabA, 'code-a');
    expect(callbackA.status).toBe(303);
    expect(callbackA.headers.get('location')).toBe(`${UI4A_ORIGIN}/app/publishing`);

    const callbackB = await completeLogin(auth, tabB, 'code-b');
    expect(callbackB.status).toBe(303);
    expect(callbackB.headers.get('location')).toBe(`${UI4A_ORIGIN}/meta`);

    const replayA = await completeLogin(auth, tabA, 'code-a-replay');
    expect(replayA.status).toBe(400);
    expect(await responseCode(replayA)).toBe('oidc_state_replayed');
    expect(harness.exchanges.map((exchange) => exchange.code)).toEqual(['code-a', 'code-b']);
  });

  it.each([
    ['token endpoint outage', 'oidc_token_endpoint_unavailable'],
    ['JWKS outage', 'jwks_unavailable'],
  ])('fails closed on %s and never creates a session', async (failure, code) => {
    const api = await plannedApi();
    const harness = makeHarness(
      failure === 'token endpoint outage'
        ? {
            exchangeCode: async () => {
              throw Object.assign(new Error('offline'), { code });
            },
          }
        : {
            verifyIdToken: async () => {
              throw Object.assign(new Error('offline'), { code });
            },
          },
    );
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const callback = await completeLogin(auth, login);

    expect(callback.status).toBe(503);
    expect(await responseCode(callback)).toBe(code);
    expect(callback.headers.get('set-cookie')).not.toContain(`${SESSION_COOKIE}=`);
    expect(harness.sessions.records.size).toBe(0);
  });
});

describe('opaque secure browser session lifecycle', () => {
  it('sets opaque authenticated __Host cookies without browser-visible credential material', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const callback = await completeLogin(auth, login);
    const loginSetCookie = login.response.headers.get('set-cookie')!;
    const sessionSetCookie = callback.headers.get('set-cookie')!;

    for (const setCookie of [loginSetCookie, sessionSetCookie]) {
      expect(setCookie).toMatch(/;\s*Path=\//i);
      expect(setCookie).toMatch(/;\s*HttpOnly/i);
      expect(setCookie).toMatch(/;\s*Secure/i);
      expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    }
    expect(loginSetCookie).toContain(`${LOGIN_COOKIE}=`);
    expect(sessionSetCookie).toContain(`${SESSION_COOKIE}=`);
    for (const secret of [
      harness.exchanges[0]!.codeVerifier,
      harness.initialTokens.accessToken,
      harness.initialTokens.idToken,
      harness.initialTokens.refreshToken,
      'human-alice',
    ]) {
      expect(loginSetCookie).not.toContain(secret);
      expect(sessionSetCookie).not.toContain(secret);
    }
  });

  it('requires a deployment-injected high-entropy session authentication key', async () => {
    const api = await plannedApi();
    const harness = makeHarness();

    expect(() =>
      api.createBrowserAuthentication({
        ...harness.dependencies,
        sessionKey: new Uint8Array(0),
      }),
    ).toThrow(expect.objectContaining({ code: 'session_key_invalid' }));
    expect(() =>
      api.createBrowserAuthentication({
        ...harness.dependencies,
        sessionKey: new TextEncoder().encode(CLIENT_ID),
      }),
    ).toThrow(expect.objectContaining({ code: 'session_key_invalid' }));
  });

  it('rejects a tampered opaque cookie before reading a server-side session', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const callback = await completeLogin(auth, login);
    const cookie = cookieFrom(callback, SESSION_COOKIE);
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;

    await expectAuthCode(
      auth.resolveSession(requestWithCookie(`${UI4A_ORIGIN}/api/entity`, tampered)),
      'session_cookie_invalid',
    );
  });

  it('refreshes shortly-expiring access credentials and rotates the private session record', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    harness.initialTokens.accessExpiresAtMs = NOW_MILLISECONDS + 10_000;
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const callback = await completeLogin(auth, login);
    const cookie = cookieFrom(callback, SESSION_COOKIE);
    const resolved = await auth.resolveSession(
      requestWithCookie(`${UI4A_ORIGIN}/api/entity`, cookie),
    );

    expect(harness.refreshes).toEqual(['fixed-refresh-token']);
    expect(resolved).toEqual({
      authorizationHeader: `Bearer ${harness.refreshedTokens.accessToken}`,
      expiresAtMs: harness.refreshedTokens.accessExpiresAtMs,
    });
  });

  it.each([
    ['absolute session expiry', 'session_expired'],
    ['refresh-token revocation', 'session_revoked'],
  ])('fails closed on %s and invalidates the private session', async (scenario, code) => {
    const api = await plannedApi();
    const harness = makeHarness(
      scenario === 'refresh-token revocation'
        ? {
            refresh: async () => {
              throw Object.assign(new Error('invalid grant'), { code: 'session_revoked' });
            },
          }
        : {},
    );
    if (scenario === 'refresh-token revocation') {
      harness.initialTokens.accessExpiresAtMs = NOW_MILLISECONDS + 10_000;
    }
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const callback = await completeLogin(auth, login);
    const cookie = cookieFrom(callback, SESSION_COOKIE);
    if (scenario === 'absolute session expiry') harness.advance(3_600_001);

    await expectAuthCode(
      auth.resolveSession(requestWithCookie(`${UI4A_ORIGIN}/api/entity`, cookie)),
      code,
    );
    await expectAuthCode(
      auth.resolveSession(requestWithCookie(`${UI4A_ORIGIN}/api/entity`, cookie)),
      'session_not_found',
    );
  });

  it('revokes on logout, clears local state, and cannot reuse the old cookie', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const callback = await completeLogin(auth, login);
    const cookie = cookieFrom(callback, SESSION_COOKIE);
    const logout = await auth.logout(requestWithCookie(`${UI4A_ORIGIN}/auth/logout`, cookie));

    expect(logout.status).toBe(303);
    expect(logout.headers.get('location')).toBe(`${UI4A_ORIGIN}/`);
    expect(logout.headers.get('set-cookie')).toMatch(
      new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, 'i'),
    );
    expect(harness.revocations).toEqual(['fixed-refresh-token']);
    await expectAuthCode(
      auth.resolveSession(requestWithCookie(`${UI4A_ORIGIN}/api/entity`, cookie)),
      'session_not_found',
    );
  });

  it('requires login again after a single-process Web restart clears the private store', async () => {
    const api = await plannedApi();
    const harness = makeHarness();
    const beforeRestart = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(beforeRestart);
    const callback = await completeLogin(beforeRestart, login);
    const cookie = cookieFrom(callback, SESSION_COOKIE);
    const afterRestart = api.createBrowserAuthentication({
      ...harness.dependencies,
      loginTransactions: new MemoryAuthPrivateStore(),
      sessions: new MemoryAuthPrivateStore(),
    });

    await expectAuthCode(
      afterRestart.resolveSession(requestWithCookie(`${UI4A_ORIGIN}/api/entity`, cookie)),
      'session_not_found',
    );
  });

  it('clears the local session but reports a Keycloak revocation outage honestly', async () => {
    const api = await plannedApi();
    const harness = makeHarness({
      revoke: async () => {
        throw Object.assign(new Error('offline'), { code: 'oidc_revocation_unavailable' });
      },
    });
    const auth = api.createBrowserAuthentication(harness.dependencies);
    const login = await startLogin(auth);
    const callback = await completeLogin(auth, login);
    const cookie = cookieFrom(callback, SESSION_COOKIE);
    const logout = await auth.logout(requestWithCookie(`${UI4A_ORIGIN}/auth/logout`, cookie));

    expect(logout.status).toBe(503);
    expect(await responseCode(logout)).toBe('oidc_revocation_unavailable');
    expect(logout.headers.get('set-cookie')).toMatch(
      new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, 'i'),
    );
    await expectAuthCode(
      auth.resolveSession(requestWithCookie(`${UI4A_ORIGIN}/api/entity`, cookie)),
      'session_not_found',
    );
  });
});

describe('one trusted request identity adapter for browser business and meta requests', () => {
  it.each([
    ['business', '/api/entity?rel=applications'],
    ['meta', '/_meta/api/entity?rel=meta%2Fflows'],
  ] as const)(
    'feeds a verified %s browser session into resolveTrustedRequestIdentity',
    async (plane, path) => {
      const api = await plannedApi();
      const harness = makeHarness();
      const auth = api.createBrowserAuthentication(harness.dependencies);
      const login = await startLogin(auth);
      const callback = await completeLogin(auth, login);
      const session = await auth.resolveSession(
        requestWithCookie(`${UI4A_ORIGIN}${path}`, cookieFrom(callback, SESSION_COOKIE)),
      );
      const request = new Request(`${UI4A_ORIGIN}${path}`, {
        headers: { authorization: session.authorizationHeader },
      });

      const identity = await resolveTrustedRequestIdentity(request, {
        profile: 'production',
        plane,
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['development', 'governance'],
        productionPolicy: {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: ['RS256'],
          humanClientIds: [CLIENT_ID],
          agentClientIds: ['ui4a-agent'],
          delegatedScopesByClient: { 'ui4a-agent': ['ui4a:read'] },
        },
        productionDependencies: {
          clock: () => NOW_MILLISECONDS,
          jwks: {
            load: async () => ({
              keys: [PUBLIC_JWK],
              fetchedAtMs: NOW_MILLISECONDS - 1_000,
              expiresAtMs: NOW_MILLISECONDS + 60_000,
            }),
          },
        },
      });

      // D51:identity 携带凭证授予集合(plain-name 与 ui4a:policy:* 同词汇解析),
      // 不再产出会话冻结的单一 policyScope。
      expect(identity).toMatchObject({
        authorizationMode: 'credential',
        actor: 'human',
        principal: 'human-alice',
        grantedApplications: ['development', 'governance'],
        channel: 'oidc',
        humanApprovalEligible: true,
      });
    },
  );
});
