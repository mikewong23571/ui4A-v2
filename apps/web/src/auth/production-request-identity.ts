import { createPublicKey, verify } from 'node:crypto';

export type ProductionIdentityErrorCode =
  | 'credential_missing'
  | 'credential_malformed'
  | 'credential_expired'
  | 'credential_not_active'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'signature_invalid'
  | 'signing_key_not_found'
  | 'jwks_unavailable'
  | 'jwks_stale'
  | 'scope_insufficient'
  | 'delegation_malformed'
  | 'delegation_too_deep'
  | 'delegation_actor_not_allowed'
  | 'delegation_scope_exceeded';

export class ProductionIdentityError extends Error {
  readonly code: ProductionIdentityErrorCode;

  constructor(code: ProductionIdentityErrorCode) {
    super(code);
    this.name = 'ProductionIdentityError';
    this.code = code;
  }
}

export interface JsonWebKeyLike {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [name: string]: unknown;
}

export interface JwksSnapshot {
  keys: readonly JsonWebKeyLike[];
  fetchedAtMs: number;
  expiresAtMs: number;
}

export interface JwksLoader {
  load(): Promise<JwksSnapshot>;
}

export function createRemoteJwksLoader(input: {
  url: string;
  clock?: () => number;
  fetch?: typeof globalThis.fetch;
  maximumAgeMs?: number;
}): JwksLoader {
  const clock = input.clock ?? Date.now;
  const fetcher = input.fetch ?? globalThis.fetch;
  const maximumAgeMs = input.maximumAgeMs ?? 5 * 60_000;
  let cached: JwksSnapshot | undefined;
  return {
    async load(): Promise<JwksSnapshot> {
      const now = clock();
      if (cached !== undefined && cached.expiresAtMs > now) return cached;
      let response: Response;
      try {
        response = await fetcher(input.url, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
      } catch {
        return fail('jwks_unavailable');
      }
      if (!response.ok) fail('jwks_unavailable');
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return fail('jwks_unavailable');
      }
      if (!record(payload) || !Array.isArray(payload.keys)) fail('jwks_unavailable');
      const keys = payload.keys.filter(record) as JsonWebKeyLike[];
      if (keys.length === 0) fail('jwks_unavailable');
      const cacheControl = response.headers.get('cache-control');
      const maxAgeMatch =
        cacheControl === null ? null : /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
      const advertisedAgeMs = maxAgeMatch === null ? maximumAgeMs : Number(maxAgeMatch[1]) * 1_000;
      const ageMs = Math.min(Math.max(advertisedAgeMs, 1_000), maximumAgeMs);
      cached = { keys, fetchedAtMs: now, expiresAtMs: now + ageMs };
      return cached;
    },
  };
}

export interface ProductionCredentialPolicy {
  issuer: string;
  audience: string;
  algorithms: readonly string[];
  humanClientIds: readonly string[];
  agentClientIds: readonly string[];
  delegatedScopesByClient: Readonly<Record<string, readonly string[]>>;
  maximumDelegationDepth: number;
}

export interface ProductionCredentialDependencies {
  clock(): number;
  jwks: JwksLoader;
}

export interface VerifiedCredential {
  claims: Record<string, unknown>;
  header: { alg: 'RS256'; kid: string };
}

const verifiedPolicy = Symbol('verifiedProductionCredentialPolicy');
type PolicyBoundCredential = VerifiedCredential & {
  readonly [verifiedPolicy]: ProductionCredentialPolicy;
};

export interface ProductionRequestIdentity {
  actor: 'human' | 'agent' | 'system';
  kind: 'human' | 'agent' | 'service';
  principal: string;
  scopes: string[];
  humanApprovalEligible: boolean;
  delegation?: {
    subject: string;
    actorClientId: string;
    source: 'token-exchange-sub-azp';
  };
}

interface JwtParts {
  signingInput: string;
  signature: Buffer;
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}

function fail(code: ProductionIdentityErrorCode): never {
  throw new ProductionIdentityError(code);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  if (segment === '' || !/^[A-Za-z0-9_-]+$/.test(segment)) fail('credential_malformed');
  try {
    const decoded = Buffer.from(segment, 'base64url');
    if (decoded.toString('base64url') !== segment) fail('credential_malformed');
    const value = JSON.parse(decoded.toString('utf8')) as unknown;
    if (!record(value)) fail('credential_malformed');
    return value;
  } catch (error) {
    if (error instanceof ProductionIdentityError) throw error;
    return fail('credential_malformed');
  }
}

function parseBearerCredential(authorizationHeader: string | null): JwtParts {
  if (authorizationHeader === null) fail('credential_missing');
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader);
  if (match === null) fail('credential_malformed');
  const compact = match[1]!;
  const segments = compact.split('.');
  if (segments.length !== 3) fail('credential_malformed');
  const [encodedHeader, encodedClaims, encodedSignature] = segments as [string, string, string];
  const header = decodeJsonSegment(encodedHeader);
  const claims = decodeJsonSegment(encodedClaims);
  if (encodedSignature === '' || !/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
    fail('signature_invalid');
  }
  const signature = Buffer.from(encodedSignature, 'base64url');
  // Reject alternate base64url spellings. They can decode to the same bytes and otherwise make a
  // visibly tampered compact JWT appear to have a valid signature.
  if (signature.toString('base64url') !== encodedSignature) fail('signature_invalid');
  return {
    signingInput: `${encodedHeader}.${encodedClaims}`,
    signature,
    header,
    claims,
  };
}

function validAudience(value: unknown, audience: string): boolean {
  return value === audience || (Array.isArray(value) && value.some((item) => item === audience));
}

function claimSeconds(claims: Record<string, unknown>, name: 'exp' | 'nbf'): number {
  const value = claims[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('credential_malformed');
  return value;
}

function freezeClaims(value: unknown): void {
  if (!record(value) && !Array.isArray(value)) return;
  for (const child of Object.values(value)) freezeClaims(child);
  Object.freeze(value);
}

function scopeList(value: unknown): string[] {
  if (typeof value !== 'string') fail('credential_malformed');
  return [...new Set(value.split(/\s+/).filter(Boolean))];
}

function validateAct(claims: Record<string, unknown>, maximumDepth: number): void {
  if (claims.act === undefined) return;
  let current: unknown = claims.act;
  let depth = 0;
  while (current !== undefined) {
    if (!record(current) || typeof current.sub !== 'string' || current.sub === '') {
      fail('delegation_malformed');
    }
    depth += 1;
    if (depth > maximumDepth) fail('delegation_too_deep');
    current = current.act;
  }
}

function usableSigningKey(keys: readonly JsonWebKeyLike[], kid: string): JsonWebKeyLike {
  const key = keys.find(
    (candidate) =>
      candidate.kid === kid &&
      candidate.kty === 'RSA' &&
      (candidate.use === undefined || candidate.use === 'sig') &&
      (candidate.alg === undefined || candidate.alg === 'RS256') &&
      typeof candidate.n === 'string' &&
      typeof candidate.e === 'string',
  );
  if (key === undefined) fail('signing_key_not_found');
  return key;
}

export async function verifyProductionCredential(
  authorizationHeader: string | null,
  policy: ProductionCredentialPolicy,
  dependencies: ProductionCredentialDependencies,
): Promise<VerifiedCredential> {
  const parsed = parseBearerCredential(authorizationHeader);
  if (parsed.header.alg !== 'RS256' || !policy.algorithms.includes('RS256')) {
    fail('credential_malformed');
  }
  if (typeof parsed.header.kid !== 'string' || parsed.header.kid === '') {
    fail('credential_malformed');
  }

  let snapshot: JwksSnapshot;
  try {
    snapshot = await dependencies.jwks.load();
  } catch {
    return fail('jwks_unavailable');
  }
  const nowMs = dependencies.clock();
  if (
    !Number.isFinite(snapshot.fetchedAtMs) ||
    !Number.isFinite(snapshot.expiresAtMs) ||
    snapshot.fetchedAtMs > nowMs ||
    snapshot.expiresAtMs <= nowMs
  ) {
    fail('jwks_stale');
  }
  const signingKey = usableSigningKey(snapshot.keys, parsed.header.kid);
  let validSignature = false;
  try {
    validSignature = verify(
      'RSA-SHA256',
      Buffer.from(parsed.signingInput),
      createPublicKey({ key: signingKey, format: 'jwk' }),
      parsed.signature,
    );
  } catch {
    validSignature = false;
  }
  if (!validSignature) fail('signature_invalid');

  // Claims become authorization inputs only after signature verification.
  if (parsed.claims.iss !== policy.issuer) fail('issuer_mismatch');
  if (!validAudience(parsed.claims.aud, policy.audience)) fail('audience_mismatch');
  const nowSeconds = Math.floor(nowMs / 1_000);
  if (claimSeconds(parsed.claims, 'exp') <= nowSeconds) fail('credential_expired');
  if (parsed.claims.nbf !== undefined && claimSeconds(parsed.claims, 'nbf') > nowSeconds) {
    fail('credential_not_active');
  }
  if (typeof parsed.claims.sub !== 'string' || parsed.claims.sub === '') {
    fail('credential_malformed');
  }
  scopeList(parsed.claims.scope);

  freezeClaims(parsed.claims);
  const header = Object.freeze({ alg: 'RS256' as const, kid: parsed.header.kid });
  const credential: VerifiedCredential = {
    claims: parsed.claims,
    header,
  };
  Object.defineProperty(credential, verifiedPolicy, {
    value: policy,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(credential);
}

const PROTOCOL_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);

export function buildProductionRequestIdentity(
  credential: VerifiedCredential,
  input: {
    requiredScopes: string[];
    untrusted?: {
      actor?: unknown;
      principal?: unknown;
      scope?: unknown;
      delegation?: unknown;
    };
  },
  policy?: ProductionCredentialPolicy,
): ProductionRequestIdentity {
  // `untrusted` is accepted solely to make the trust boundary explicit. None of its values are
  // consulted. The credential policy is retained on the verified credential by the verifier's
  // caller in production; tests may use the policy registered below through the default path.
  void input.untrusted;
  const effectivePolicy = policy ?? (credential as Partial<PolicyBoundCredential>)[verifiedPolicy];
  if (effectivePolicy === undefined) fail('credential_malformed');

  const claims = credential.claims;
  validateAct(claims, effectivePolicy.maximumDelegationDepth);
  const subject = claims.sub;
  const authorizedParty = claims.azp;
  if (typeof subject !== 'string' || typeof authorizedParty !== 'string') {
    fail('credential_malformed');
  }
  const allScopes = scopeList(claims.scope);
  for (const required of input.requiredScopes) {
    if (!allScopes.includes(required)) fail('scope_insufficient');
  }
  const scopes = allScopes.filter((scope) => !PROTOCOL_SCOPES.has(scope));

  if (effectivePolicy.humanClientIds.includes(authorizedParty)) {
    if (claims.act !== undefined) fail('delegation_actor_not_allowed');
    return {
      actor: 'human',
      kind: 'human',
      principal: subject,
      scopes,
      humanApprovalEligible: true,
    };
  }
  if (!effectivePolicy.agentClientIds.includes(authorizedParty)) {
    fail('delegation_actor_not_allowed');
  }
  const allowedScopes = effectivePolicy.delegatedScopesByClient[authorizedParty] ?? [];
  if (scopes.some((scope) => !allowedScopes.includes(scope))) fail('delegation_scope_exceeded');
  const service =
    typeof claims.preferred_username === 'string' &&
    claims.preferred_username.startsWith('service-account-');
  return {
    actor: 'agent',
    kind: service ? 'service' : 'agent',
    principal: subject,
    scopes,
    humanApprovalEligible: false,
    ...(service
      ? {}
      : {
          delegation: {
            subject,
            actorClientId: authorizedParty,
            source: 'token-exchange-sub-azp' as const,
          },
        }),
  };
}
