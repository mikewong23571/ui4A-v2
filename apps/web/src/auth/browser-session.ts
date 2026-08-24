import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AuthPrivateStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, expiresAtMs: number): Promise<void>;
  take(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface BrowserTokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  accessExpiresAtMs: number;
  refreshExpiresAtMs: number;
}

export interface BrowserAuthenticationPolicy {
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
}

export interface BrowserAuthenticationDependencies {
  policy: BrowserAuthenticationPolicy;
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
}

export interface BrowserAuthentication {
  beginLogin(request: Request): Promise<Response>;
  completeCallback(request: Request): Promise<Response>;
  resolveSession(request: Request): Promise<{
    authorizationHeader: string;
    expiresAtMs: number;
  }>;
  logout(request: Request): Promise<Response>;
}

export type BrowserAuthenticationErrorCode =
  | 'session_key_invalid'
  | 'oidc_state_missing'
  | 'oidc_state_invalid'
  | 'oidc_state_replayed'
  | 'authorization_code_missing'
  | 'login_correlation_missing'
  | 'oidc_nonce_mismatch'
  | 'oidc_token_endpoint_unavailable'
  | 'jwks_unavailable'
  | 'session_cookie_invalid'
  | 'session_not_found'
  | 'session_expired'
  | 'session_revoked'
  | 'session_refresh_unavailable'
  | 'oidc_revocation_unavailable';

export class BrowserAuthenticationError extends Error {
  readonly code: BrowserAuthenticationErrorCode;

  constructor(code: BrowserAuthenticationErrorCode) {
    super(code);
    this.name = 'BrowserAuthenticationError';
    this.code = code;
  }
}

interface LoginTransaction {
  kind: 'browser-login';
  correlationId: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  expiresAtMs: number;
}

interface SessionRecord {
  kind: 'browser-session';
  tokens: BrowserTokenSet;
  absoluteExpiresAtMs: number;
}

const textEncoder = new TextEncoder();
const CALLBACK_ERRORS = new Set<BrowserAuthenticationErrorCode>([
  'oidc_nonce_mismatch',
  'oidc_token_endpoint_unavailable',
  'jwks_unavailable',
]);
const REFRESH_ERRORS = new Set<BrowserAuthenticationErrorCode>([
  'session_revoked',
  'session_refresh_unavailable',
  'oidc_token_endpoint_unavailable',
]);

function fail(code: BrowserAuthenticationErrorCode): never {
  throw new BrowserAuthenticationError(code);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function randomOpaqueId(dependencies: BrowserAuthenticationDependencies): string {
  const value = dependencies.randomBytes(32);
  if (value.length !== 32) fail('session_key_invalid');
  return base64Url(value);
}

function mac(value: string, key: Uint8Array): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function authenticatedCookieValue(value: string, key: Uint8Array): string {
  return `${value}.${mac(value, key).toString('base64url')}`;
}

function verifyAuthenticatedCookie(value: string | undefined, key: Uint8Array): string | undefined {
  if (value === undefined) return undefined;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value);
  if (match === null) return undefined;
  const [, opaqueId, encodedMac] = match;
  const suppliedMac = Buffer.from(encodedMac!, 'base64url');
  if (suppliedMac.toString('base64url') !== encodedMac) return undefined;
  const expectedMac = mac(opaqueId!, key);
  if (suppliedMac.length !== expectedMac.length) return undefined;
  return timingSafeEqual(suppliedMac, expectedMac) ? opaqueId : undefined;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (header === null) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(
    0,
    Math.floor(maxAgeSeconds),
  )}`;
}

function clearCookie(name: string): string {
  return setCookie(name, '', 0);
}

function loginKey(state: string): string {
  return `browser-login:${state}`;
}

function knownStateKey(state: string): string {
  return `browser-login-known:${state}`;
}

function sessionKey(id: string): string {
  return `browser-session:${id}`;
}

function loginTransaction(value: unknown): LoginTransaction | undefined {
  if (
    !record(value) ||
    value.kind !== 'browser-login' ||
    typeof value.correlationId !== 'string' ||
    typeof value.codeVerifier !== 'string' ||
    typeof value.nonce !== 'string' ||
    typeof value.returnTo !== 'string' ||
    typeof value.expiresAtMs !== 'number'
  ) {
    return undefined;
  }
  return value as unknown as LoginTransaction;
}

function tokenSet(value: unknown): value is BrowserTokenSet {
  return (
    record(value) &&
    typeof value.accessToken === 'string' &&
    value.accessToken !== '' &&
    typeof value.idToken === 'string' &&
    value.idToken !== '' &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken !== '' &&
    typeof value.accessExpiresAtMs === 'number' &&
    Number.isFinite(value.accessExpiresAtMs) &&
    typeof value.refreshExpiresAtMs === 'number' &&
    Number.isFinite(value.refreshExpiresAtMs)
  );
}

function sessionRecord(value: unknown): SessionRecord | undefined {
  if (
    !record(value) ||
    value.kind !== 'browser-session' ||
    !tokenSet(value.tokens) ||
    typeof value.absoluteExpiresAtMs !== 'number' ||
    !Number.isFinite(value.absoluteExpiresAtMs)
  ) {
    return undefined;
  }
  return value as unknown as SessionRecord;
}

function safeReturnTo(candidate: string | null, policy: BrowserAuthenticationPolicy): string {
  const fallback = policy.defaultReturnTo;
  if (candidate === null || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback;
  }
  try {
    const resolved = new URL(candidate, policy.allowedReturnOrigin);
    return resolved.origin === policy.allowedReturnOrigin
      ? `${resolved.pathname}${resolved.search}`
      : fallback;
  } catch {
    return fallback;
  }
}

function redirect(location: string, status: 302 | 303, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie !== undefined) headers.append('set-cookie', cookie);
  return new Response(null, { status, headers });
}

function errorResponse(code: BrowserAuthenticationErrorCode, cookie?: string): Response {
  const serviceUnavailable =
    code === 'oidc_token_endpoint_unavailable' ||
    code === 'jwks_unavailable' ||
    code === 'session_refresh_unavailable' ||
    code === 'oidc_revocation_unavailable';
  const unauthorized = code === 'oidc_nonce_mismatch';
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie !== undefined) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify({ error: { code } }), {
    status: serviceUnavailable ? 503 : unauthorized ? 401 : 400,
    headers,
  });
}

function safeErrorCode(
  error: unknown,
  allowed: ReadonlySet<BrowserAuthenticationErrorCode>,
  fallback: BrowserAuthenticationErrorCode,
): BrowserAuthenticationErrorCode {
  const code = record(error) && typeof error.code === 'string' ? error.code : undefined;
  return code !== undefined && allowed.has(code as BrowserAuthenticationErrorCode)
    ? (code as BrowserAuthenticationErrorCode)
    : fallback;
}

function assertPolicy(dependencies: BrowserAuthenticationDependencies): Uint8Array {
  const key = Uint8Array.from(dependencies.sessionKey);
  if (key.length < 32) fail('session_key_invalid');
  if (
    key.length === textEncoder.encode(dependencies.policy.clientId).length &&
    constantTimeTextEqual(Buffer.from(key).toString('utf8'), dependencies.policy.clientId)
  ) {
    fail('session_key_invalid');
  }
  return key;
}

export function createBrowserAuthentication(
  dependencies: BrowserAuthenticationDependencies,
): BrowserAuthentication {
  const key = assertPolicy(dependencies);
  const { policy } = dependencies;

  async function beginLogin(request: Request): Promise<Response> {
    const now = dependencies.clock();
    const state = randomOpaqueId(dependencies);
    const nonce = randomOpaqueId(dependencies);
    const codeVerifier = randomOpaqueId(dependencies);
    const existingCorrelation = verifyAuthenticatedCookie(
      cookieValue(request, policy.loginCookieName),
      key,
    );
    const correlationId = existingCorrelation ?? randomOpaqueId(dependencies);
    const expiresAtMs = now + policy.loginTtlMs;
    const transaction: LoginTransaction = {
      kind: 'browser-login',
      correlationId,
      codeVerifier,
      nonce,
      returnTo: safeReturnTo(new URL(request.url).searchParams.get('returnTo'), policy),
      expiresAtMs,
    };
    await dependencies.loginTransactions.put(loginKey(state), transaction, expiresAtMs);
    await dependencies.loginTransactions.put(knownStateKey(state), true, expiresAtMs);

    const authorizationUrl = new URL(policy.authorizationEndpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', policy.clientId);
    authorizationUrl.searchParams.set('redirect_uri', policy.redirectUri);
    authorizationUrl.searchParams.set('scope', policy.scopes.join(' '));
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set(
      'code_challenge',
      base64Url(dependencies.sha256(textEncoder.encode(codeVerifier))),
    );
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');

    return redirect(
      authorizationUrl.toString(),
      302,
      setCookie(
        policy.loginCookieName,
        authenticatedCookieValue(correlationId, key),
        policy.loginTtlMs / 1_000,
      ),
    );
  }

  async function completeCallback(request: Request): Promise<Response> {
    const parameters = new URL(request.url).searchParams;
    const state = parameters.get('state');
    if (state === null || state === '') return errorResponse('oidc_state_missing');
    const code = parameters.get('code');
    if (code === null || code === '') return errorResponse('authorization_code_missing');

    const pending = loginTransaction(await dependencies.loginTransactions.get(loginKey(state)));
    if (pending === undefined) {
      const known = await dependencies.loginTransactions.get(knownStateKey(state));
      return errorResponse(known === undefined ? 'oidc_state_invalid' : 'oidc_state_replayed');
    }
    if (pending.expiresAtMs <= dependencies.clock()) {
      await dependencies.loginTransactions.delete(loginKey(state));
      return errorResponse('oidc_state_invalid');
    }
    const correlationId = verifyAuthenticatedCookie(
      cookieValue(request, policy.loginCookieName),
      key,
    );
    if (
      correlationId === undefined ||
      !constantTimeTextEqual(correlationId, pending.correlationId)
    ) {
      return errorResponse('login_correlation_missing');
    }

    const consumed = loginTransaction(await dependencies.loginTransactions.take(loginKey(state)));
    if (consumed === undefined) return errorResponse('oidc_state_replayed');
    const correlationCookie = setCookie(
      policy.loginCookieName,
      authenticatedCookieValue(consumed.correlationId, key),
      policy.loginTtlMs / 1_000,
    );

    let tokens: BrowserTokenSet;
    try {
      tokens = await dependencies.exchangeCode({
        code,
        codeVerifier: consumed.codeVerifier,
        redirectUri: policy.redirectUri,
        clientId: policy.clientId,
      });
      if (!tokenSet(tokens)) fail('oidc_token_endpoint_unavailable');
      await dependencies.verifyIdToken(tokens.idToken, {
        issuer: policy.issuer,
        nonce: consumed.nonce,
        audience: policy.audience,
      });
    } catch (error) {
      return errorResponse(
        safeErrorCode(error, CALLBACK_ERRORS, 'oidc_token_endpoint_unavailable'),
        correlationCookie,
      );
    }

    const now = dependencies.clock();
    const absoluteExpiresAtMs = Math.min(now + policy.sessionTtlMs, tokens.refreshExpiresAtMs);
    if (tokens.accessExpiresAtMs <= now || absoluteExpiresAtMs <= now) {
      return errorResponse('oidc_token_endpoint_unavailable', correlationCookie);
    }
    const id = randomOpaqueId(dependencies);
    await dependencies.sessions.put(
      sessionKey(id),
      { kind: 'browser-session', tokens, absoluteExpiresAtMs } satisfies SessionRecord,
      absoluteExpiresAtMs,
    );
    return redirect(
      new URL(consumed.returnTo, policy.allowedReturnOrigin).toString(),
      303,
      setCookie(
        policy.sessionCookieName,
        authenticatedCookieValue(id, key),
        (absoluteExpiresAtMs - now) / 1_000,
      ),
    );
  }

  async function resolveSession(request: Request): Promise<{
    authorizationHeader: string;
    expiresAtMs: number;
  }> {
    const rawCookie = cookieValue(request, policy.sessionCookieName);
    if (rawCookie === undefined) fail('session_not_found');
    const id = verifyAuthenticatedCookie(rawCookie, key);
    if (id === undefined) fail('session_cookie_invalid');
    const keyForSession = sessionKey(id);
    const stored = sessionRecord(await dependencies.sessions.get(keyForSession));
    if (stored === undefined) fail('session_not_found');

    const now = dependencies.clock();
    if (stored.absoluteExpiresAtMs <= now || stored.tokens.refreshExpiresAtMs <= now) {
      await dependencies.sessions.delete(keyForSession);
      fail('session_expired');
    }

    let tokens = stored.tokens;
    if (tokens.accessExpiresAtMs - now <= policy.refreshBeforeExpiryMs) {
      try {
        const refreshed = await dependencies.refresh(tokens.refreshToken);
        if (!tokenSet(refreshed) || refreshed.accessExpiresAtMs <= now) {
          fail('session_refresh_unavailable');
        }
        tokens = refreshed;
        await dependencies.sessions.put(
          keyForSession,
          { ...stored, tokens } satisfies SessionRecord,
          stored.absoluteExpiresAtMs,
        );
      } catch (error) {
        await dependencies.sessions.delete(keyForSession);
        fail(safeErrorCode(error, REFRESH_ERRORS, 'session_refresh_unavailable'));
      }
    }
    return {
      authorizationHeader: `Bearer ${tokens.accessToken}`,
      expiresAtMs: tokens.accessExpiresAtMs,
    };
  }

  async function logout(request: Request): Promise<Response> {
    const clearedCookie = clearCookie(policy.sessionCookieName);
    const rawCookie = cookieValue(request, policy.sessionCookieName);
    if (rawCookie === undefined) {
      return redirect(
        new URL(policy.defaultReturnTo, policy.allowedReturnOrigin).toString(),
        303,
        clearedCookie,
      );
    }
    const id = verifyAuthenticatedCookie(rawCookie, key);
    if (id === undefined) return errorResponse('session_cookie_invalid', clearedCookie);
    const keyForSession = sessionKey(id);
    const stored = sessionRecord(await dependencies.sessions.get(keyForSession));
    await dependencies.sessions.delete(keyForSession);
    if (stored === undefined) {
      return redirect(
        new URL(policy.defaultReturnTo, policy.allowedReturnOrigin).toString(),
        303,
        clearedCookie,
      );
    }
    try {
      await dependencies.revoke(stored.tokens.refreshToken);
    } catch (error) {
      return errorResponse(
        safeErrorCode(
          error,
          new Set<BrowserAuthenticationErrorCode>(['oidc_revocation_unavailable']),
          'oidc_revocation_unavailable',
        ),
        clearedCookie,
      );
    }
    return redirect(
      new URL(policy.defaultReturnTo, policy.allowedReturnOrigin).toString(),
      303,
      clearedCookie,
    );
  }

  return { beginLogin, completeCallback, resolveSession, logout };
}
