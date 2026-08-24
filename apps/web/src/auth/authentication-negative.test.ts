import { createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { applyTrustedIdentity, resolveTrustedRequestIdentity } from './request-identity';

const NOW_SECONDS = 1_788_739_200;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const ISSUER = 'https://auth.ui4a.mothership.internal/realms/ui4a';
const AUDIENCE = 'ui4a-api';
const KEY_ID = 'ui4a-auth-fixture-1';

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

interface VerifiedCredential {
  claims: Record<string, unknown>;
  header: { alg: 'RS256'; kid: string };
}

interface ProductionRequestIdentity {
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

interface ProductionIdentityModule {
  verifyProductionCredential(
    authorizationHeader: string | null,
    policy: typeof POLICY,
    dependencies: typeof VALID_DEPENDENCIES,
  ): Promise<VerifiedCredential>;
  buildProductionRequestIdentity(
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
  ): ProductionRequestIdentity;
}

const POLICY = {
  issuer: ISSUER,
  audience: AUDIENCE,
  algorithms: ['RS256'] as const,
  humanClientIds: ['ui4a-web'],
  agentClientIds: ['ui4a-agent'],
  delegatedScopesByClient: {
    'ui4a-agent': ['ui4a:read', 'ui4a:write'],
  },
  maximumDelegationDepth: 1,
};

const VALID_DEPENDENCIES = {
  clock: () => NOW_MILLISECONDS,
  jwks: {
    load: async () => ({
      keys: [PUBLIC_JWK],
      fetchedAtMs: NOW_MILLISECONDS - 1_000,
      expiresAtMs: NOW_MILLISECONDS + 60_000,
    }),
  },
};

const plannedModulePath = './production-request-identity';

async function plannedApi(): Promise<ProductionIdentityModule> {
  return (await import(plannedModulePath)) as ProductionIdentityModule;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const encodedHeader = base64Url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID, ...header }),
  );
  const encodedClaims = base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'human-alice',
      azp: 'ui4a-web',
      scope: 'openid ui4a:read ui4a:write ui4a:approve',
      iat: NOW_SECONDS - 30,
      nbf: NOW_SECONDS - 30,
      exp: NOW_SECONDS + 300,
      ...claims,
    }),
  );
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), createPrivateKey(PRIVATE_KEY));
  return `${signingInput}.${base64Url(signature)}`;
}

function bearer(jwt = token()): string {
  return `Bearer ${jwt}`;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('production credential verification negative corpus', () => {
  it.each([
    ['missing token', null, 'credential_missing'],
    ['empty bearer token', 'Bearer ', 'credential_malformed'],
    ['wrong scheme', `Basic ${base64Url('alice:password')}`, 'credential_malformed'],
    ['malformed compact JWT', 'Bearer not-a-jwt', 'credential_malformed'],
  ])('rejects %s', async (_name, authorization, code) => {
    const api = await plannedApi();
    await expectCode(
      api.verifyProductionCredential(authorization, POLICY, VALID_DEPENDENCIES),
      code,
    );
  });

  it.each([
    ['expired', { exp: NOW_SECONDS - 1 }, 'credential_expired'],
    ['not active yet', { nbf: NOW_SECONDS + 1 }, 'credential_not_active'],
    ['wrong issuer', { iss: 'https://issuer.invalid/realms/ui4a' }, 'issuer_mismatch'],
    ['wrong audience', { aud: 'other-api' }, 'audience_mismatch'],
  ])('rejects a correctly signed token that is %s', async (_name, claims, code) => {
    const api = await plannedApi();
    await expectCode(
      api.verifyProductionCredential(bearer(token(claims)), POLICY, VALID_DEPENDENCIES),
      code,
    );
  });

  it('rejects a bad signature before trusting any claim', async () => {
    const api = await plannedApi();
    const valid = token();
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('A') ? 'B' : 'A'}`;
    await expectCode(
      api.verifyProductionCredential(bearer(tampered), POLICY, VALID_DEPENDENCIES),
      'signature_invalid',
    );
  });

  it('rejects an unknown kid instead of accepting another cached key', async () => {
    const api = await plannedApi();
    await expectCode(
      api.verifyProductionCredential(
        bearer(token({}, { kid: 'unknown-key' })),
        POLICY,
        VALID_DEPENDENCIES,
      ),
      'signing_key_not_found',
    );
  });

  it('fails closed when JWKS is unavailable', async () => {
    const api = await plannedApi();
    await expectCode(
      api.verifyProductionCredential(bearer(), POLICY, {
        ...VALID_DEPENDENCIES,
        jwks: { load: async () => Promise.reject(new Error('offline')) },
      }),
      'jwks_unavailable',
    );
  });

  it('fails closed when the JWKS cache is stale', async () => {
    const api = await plannedApi();
    await expectCode(
      api.verifyProductionCredential(bearer(), POLICY, {
        ...VALID_DEPENDENCIES,
        jwks: {
          load: async () => ({
            keys: [PUBLIC_JWK],
            fetchedAtMs: NOW_MILLISECONDS - 120_000,
            expiresAtMs: NOW_MILLISECONDS - 1,
          }),
        },
      }),
      'jwks_stale',
    );
  });

  it('rejects insufficient scope after cryptographic verification', async () => {
    const api = await plannedApi();
    const credential = await api.verifyProductionCredential(
      bearer(token({ scope: 'openid ui4a:read' })),
      POLICY,
      VALID_DEPENDENCIES,
    );
    expect(() =>
      api.buildProductionRequestIdentity(credential, { requiredScopes: ['ui4a:write'] }),
    ).toThrow(expect.objectContaining({ code: 'scope_insufficient' }));
  });

  it('does not treat an Istio coarse-gate marker as an application credential', async () => {
    const api = await plannedApi();
    const request = new Request('https://ui4a.mothership.internal/api/entity', {
      headers: {
        'x-envoy-authenticated': 'true',
        'x-jwt-payload': base64Url(JSON.stringify({ sub: 'human-alice' })),
      },
    });
    await expectCode(
      api.verifyProductionCredential(
        request.headers.get('authorization'),
        POLICY,
        VALID_DEPENDENCIES,
      ),
      'credential_missing',
    );
  });
});

describe('canonical production request identity negative corpus', () => {
  it('ignores forged actor, principal, scope, and delegation request fields', async () => {
    const api = await plannedApi();
    const credential = await api.verifyProductionCredential(
      bearer(
        token({
          azp: 'ui4a-agent',
          scope: 'ui4a:read ui4a:write',
        }),
      ),
      POLICY,
      VALID_DEPENDENCIES,
    );
    const identity = api.buildProductionRequestIdentity(credential, {
      requiredScopes: ['ui4a:write'],
      untrusted: {
        actor: 'human',
        principal: 'root-admin',
        scope: ['root:*'],
        delegation: [{ actor: 'root-admin' }],
      },
    });
    expect(identity).toEqual({
      actor: 'agent',
      kind: 'agent',
      principal: 'human-alice',
      scopes: ['ui4a:read', 'ui4a:write'],
      humanApprovalEligible: false,
      delegation: {
        subject: 'human-alice',
        actorClientId: 'ui4a-agent',
        source: 'token-exchange-sub-azp',
      },
    });
    expect(
      applyTrustedIdentity(
        { rel: 'post:first', action: 'archive', actor: 'human', principal: 'forged' },
        {
          authorizationMode: 'credential',
          actor: 'agent',
          principal: identity.principal,
          scopes: identity.scopes,
          policyScope: 'development',
          channel: 'oidc',
          humanApprovalEligible: identity.humanApprovalEligible,
          delegation: identity.delegation,
        },
      ),
    ).toMatchObject({
      actor: 'agent',
      principal: 'human-alice',
      channel: 'oidc',
      identity: {
        authorizationMode: 'credential',
        scopes: ['ui4a:read', 'ui4a:write'],
        humanApprovalEligible: false,
        delegation: {
          subject: 'human-alice',
          actorClientId: 'ui4a-agent',
          source: 'token-exchange-sub-azp',
        },
      },
    });
  });

  it.each([
    ['string act', { act: 'ui4a-agent' }, 'delegation_malformed'],
    ['missing act.sub', { act: {} }, 'delegation_malformed'],
    [
      'nested act',
      { act: { sub: 'ui4a-agent', act: { sub: 'other-agent' } } },
      'delegation_too_deep',
    ],
    ['unregistered azp', { azp: 'unknown-agent' }, 'delegation_actor_not_allowed'],
    [
      'over-scoped exchange',
      { azp: 'ui4a-agent', scope: 'ui4a:read ui4a:write ui4a:approve' },
      'delegation_scope_exceeded',
    ],
  ])('rejects %s', async (_name, claims, code) => {
    const api = await plannedApi();
    const credential = await api.verifyProductionCredential(
      bearer(token(claims)),
      POLICY,
      VALID_DEPENDENCIES,
    );
    expect(() =>
      api.buildProductionRequestIdentity(credential, { requiredScopes: ['ui4a:read'] }),
    ).toThrow(expect.objectContaining({ code }));
  });

  it.each([
    [
      'agent exchanged token',
      { sub: 'human-alice', azp: 'ui4a-agent', scope: 'ui4a:read ui4a:write' },
      'agent',
    ],
    [
      'service account token',
      {
        sub: 'service-account-id',
        azp: 'ui4a-agent',
        preferred_username: 'service-account-ui4a-agent',
        scope: 'ui4a:read',
      },
      'service',
    ],
  ])('never grants human approval to an %s', async (_name, claims, kind) => {
    const api = await plannedApi();
    const credential = await api.verifyProductionCredential(
      bearer(token(claims)),
      POLICY,
      VALID_DEPENDENCIES,
    );
    const identity = api.buildProductionRequestIdentity(credential, {
      requiredScopes: ['ui4a:read'],
    });
    expect(identity).toMatchObject({ kind, humanApprovalEligible: false });
    expect(identity.actor).not.toBe('human');
  });

  it('uses verified human sub plus exchanging client azp as canonical provenance without act', async () => {
    const api = await plannedApi();
    const credential = await api.verifyProductionCredential(
      bearer(token({ sub: 'human-alice', azp: 'ui4a-agent', scope: 'ui4a:read' })),
      POLICY,
      VALID_DEPENDENCIES,
    );
    expect(
      api.buildProductionRequestIdentity(credential, { requiredScopes: ['ui4a:read'] }),
    ).toMatchObject({
      actor: 'agent',
      principal: 'human-alice',
      humanApprovalEligible: false,
      delegation: {
        subject: 'human-alice',
        actorClientId: 'ui4a-agent',
        source: 'token-exchange-sub-azp',
      },
    });
    expect(credential.claims).not.toHaveProperty('act');
  });
});

describe('current route identity debt (executable Red evidence)', () => {
  it('must stop accepting ordinary body actor/principal as trusted production identity', async () => {
    const context = await resolveTrustedRequestIdentity(
      new Request('https://ui4a.mothership.internal/api/exec', {
        headers: { authorization: bearer(token({ scope: 'ui4a:read ui4a:approve publishing' })) },
      }),
      {
        profile: 'production',
        plane: 'business',
        requiredScopes: ['ui4a:approve'],
        authorizedPolicyScopes: ['publishing', 'governance'],
        defaultPolicyScope: 'publishing',
        productionPolicy: POLICY,
        productionDependencies: VALID_DEPENDENCIES,
        untrusted: {
          actor: 'agent',
          principal: 'root-admin',
          scope: ['root:*'],
          delegation: [{ actor: 'root-admin' }],
        },
      },
    );
    expect(context).toMatchObject({
      actor: 'human',
      principal: 'human-alice',
      policyScope: 'publishing',
      authorizationMode: 'credential',
      humanApprovalEligible: true,
    });
    expect(context.scopes).not.toContain('root:*');
    expect(context).not.toHaveProperty('delegation');
  });

  it('must stop ordinary headers/query from overriding production principal or scope', async () => {
    const context = await resolveTrustedRequestIdentity(
      new Request(
        'https://ui4a.mothership.internal/_meta/api/entity?rel=meta%2Fflows&scope=governance',
        {
          headers: {
            authorization: bearer(token({ scope: 'ui4a:read publishing' })),
            'x-ui4a-principal': 'root-admin',
            'x-ui4a-policy-scope': 'governance',
          },
        },
      ),
      {
        profile: 'production',
        plane: 'meta',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['publishing', 'governance'],
        defaultPolicyScope: 'publishing',
        productionPolicy: POLICY,
        productionDependencies: VALID_DEPENDENCIES,
      },
    );
    expect(context).toMatchObject({
      principal: 'human-alice',
      policyScope: 'publishing',
      authorizationMode: 'credential',
    });
  });
});
