import { createPrivateKey, sign } from 'node:crypto';

import { actionRejectedEvent, approveConfirmation } from '@ui4a/engine';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';
import { describe, expect, it, vi } from 'vitest';

import { applyTrustedIdentity, resolveTrustedRequestIdentity } from './request-identity';

const NOW_SECONDS = 1_788_739_200;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const ISSUER = 'https://auth.ui4a.internal/realms/ui4a';
const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;
const AUDIENCE = 'ui4a-api';
const CLIENT_ID = 'ui4a-agent';
const CLIENT_SECRET = 'agent-client-secret-fixture';
const SUBJECT_TOKEN = 'opaque.human.subject-token';
const KEY_ID = 'ui4a-agent-auth-fixture-1';

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

interface AgentCredentialResult {
  authorizationHeader: string;
  expiresAtMs: number;
}

interface ProductionAgentTokenProvider {
  getClientCredential(): Promise<AgentCredentialResult>;
  exchangeDelegatedCredential(input: {
    subjectToken: string;
    requestedScopes: string[];
    untrustedTaskOverrides?: Record<string, unknown>;
  }): Promise<AgentCredentialResult>;
}

interface ProductionAgentTokenProviderModule {
  createProductionAgentTokenProvider(options: {
    tokenEndpoint: string;
    audience: string;
    clientId: string;
    clientSecret: string;
    registeredClientIds: string[];
    allowedScopes: string[];
    clock: () => number;
    fetcher: typeof fetch;
  }): ProductionAgentTokenProvider;
}

const plannedModulePath = './production-agent-token-provider';

async function plannedApi(): Promise<ProductionAgentTokenProviderModule> {
  return (await import(plannedModulePath)) as ProductionAgentTokenProviderModule;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function exchangedToken(claims: Record<string, unknown> = {}): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }));
  const payload = base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'human-alice',
      azp: CLIENT_ID,
      scope: 'ui4a:read ui4a:write development',
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

function tokenResponse(
  accessToken: string,
  options: { includeIssuedTokenType?: boolean; scope?: string } = {},
): Response {
  return Response.json({
    access_token: accessToken,
    ...(options.includeIssuedTokenType === false
      ? {}
      : { issued_token_type: 'urn:ietf:params:oauth:token-type:access_token' }),
    token_type: 'Bearer',
    expires_in: 300,
    scope: options.scope ?? 'ui4a:read ui4a:write development',
  });
}

function providerOptions(fetcher: typeof fetch, clientId = CLIENT_ID) {
  return {
    tokenEndpoint: TOKEN_ENDPOINT,
    audience: AUDIENCE,
    clientId,
    clientSecret: CLIENT_SECRET,
    registeredClientIds: [CLIENT_ID],
    allowedScopes: ['ui4a:read', 'ui4a:write', 'development'],
    clock: () => NOW_MILLISECONDS,
    fetcher,
  };
}

function formOf(init: RequestInit | undefined): URLSearchParams {
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
  return new URLSearchParams(String(init?.body));
}

async function trustedIdentity(authorizationHeader: string, requiredScopes: string[]) {
  return resolveTrustedRequestIdentity(
    new Request('https://ui4a.internal/api/exec', {
      headers: { authorization: authorizationHeader },
    }),
    {
      profile: 'production',
      plane: 'business',
      requiredScopes,
      authorizedPolicyScopes: ['development'],
      defaultPolicyScope: 'development',
      productionPolicy: {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['RS256'],
        humanClientIds: ['ui4a-web'],
        agentClientIds: [CLIENT_ID],
        delegatedScopesByClient: {
          [CLIENT_ID]: ['ui4a:read', 'ui4a:write', 'development'],
        },
        maximumDelegationDepth: 1,
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
    },
  );
}

describe('production confidential Agent credential provider', () => {
  it('uses fixed server-owned Client Credentials fields and never exposes the client secret', async () => {
    const serviceToken = exchangedToken({
      sub: 'service-account-id',
      preferred_username: 'service-account-ui4a-agent',
      scope: 'ui4a:read development',
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      tokenResponse(serviceToken, { includeIssuedTokenType: false }),
    );
    const api = await plannedApi();
    const provider = api.createProductionAgentTokenProvider(providerOptions(fetcher));

    const credential = await provider.getClientCredential();

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [input, init] = fetcher.mock.calls[0]!;
    expect(String(input)).toBe(TOKEN_ENDPOINT);
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    );
    expect(Object.fromEntries(formOf(init))).toEqual({
      grant_type: 'client_credentials',
      audience: AUDIENCE,
      scope: 'ui4a:read ui4a:write development',
    });
    expect(JSON.stringify(credential)).not.toContain(CLIENT_SECRET);
    expect(credential).toEqual({
      authorizationHeader: `Bearer ${serviceToken}`,
      expiresAtMs: NOW_MILLISECONDS + 300_000,
    });
    await expect(trustedIdentity(credential.authorizationHeader, ['ui4a:read'])).resolves.toEqual({
      authorizationMode: 'credential',
      actor: 'agent',
      principal: 'service-account-id',
      scopes: ['ui4a:read', 'development'],
      policyScope: 'development',
      channel: 'oidc',
      humanApprovalEligible: false,
    });
  });

  it('fails closed for an unknown configured client and an over-scoped exchange before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = await plannedApi();
    expect(() =>
      api.createProductionAgentTokenProvider(providerOptions(fetcher, 'unknown-agent')),
    ).toThrow(expect.objectContaining({ code: 'agent_client_unknown' }));

    const provider = api.createProductionAgentTokenProvider(providerOptions(fetcher));
    await expect(
      provider.exchangeDelegatedCredential({
        subjectToken: SUBJECT_TOKEN,
        requestedScopes: ['ui4a:read', 'ui4a:approve'],
      }),
    ).rejects.toMatchObject({ code: 'agent_scope_exceeded' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects task attempts to override provider, model, cwd, or grants before token exchange', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = await plannedApi();
    const provider = api.createProductionAgentTokenProvider(providerOptions(fetcher));

    await expect(
      provider.exchangeDelegatedCredential({
        subjectToken: SUBJECT_TOKEN,
        requestedScopes: ['ui4a:read'],
        untrustedTaskOverrides: {
          provider: 'attacker-provider',
          model: 'attacker-model',
          cwd: '/host',
          grants: ['ui4a:approve'],
        },
      }),
    ).rejects.toMatchObject({ code: 'agent_deployment_override_forbidden' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('RFC 8693 delegated Agent identity and audit', () => {
  it('fixes the exchange request and narrows the subject credential to requested scopes', async () => {
    const accessToken = exchangedToken();
    const fetcher = vi.fn<typeof fetch>(async () =>
      tokenResponse(accessToken, { scope: 'ui4a:read development' }),
    );
    const api = await plannedApi();
    const provider = api.createProductionAgentTokenProvider(providerOptions(fetcher));

    const credential = await provider.exchangeDelegatedCredential({
      subjectToken: SUBJECT_TOKEN,
      requestedScopes: ['ui4a:read', 'development'],
    });

    const [input, init] = fetcher.mock.calls[0]!;
    expect(String(input)).toBe(TOKEN_ENDPOINT);
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    );
    expect(Object.fromEntries(formOf(init))).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: SUBJECT_TOKEN,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: AUDIENCE,
      scope: 'ui4a:read development',
    });
    expect(credential.authorizationHeader).toBe(`Bearer ${accessToken}`);
    expect(JSON.stringify(credential)).not.toContain(SUBJECT_TOKEN);
    expect(JSON.stringify(credential)).not.toContain(CLIENT_SECRET);
  });

  it('fails closed when the exchange endpoint expands the requested scopes', async () => {
    const accessToken = exchangedToken();
    const fetcher = vi.fn<typeof fetch>(async () =>
      tokenResponse(accessToken, { scope: 'ui4a:read ui4a:write' }),
    );
    const api = await plannedApi();
    const provider = api.createProductionAgentTokenProvider(providerOptions(fetcher));

    await expect(
      provider.exchangeDelegatedCredential({
        subjectToken: SUBJECT_TOKEN,
        requestedScopes: ['ui4a:read'],
      }),
    ).rejects.toMatchObject({ code: 'agent_token_response_invalid' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('derives canonical sub+azp delegation, records it in exec audit, and rejects Agent approval', async () => {
    const accessToken = exchangedToken();
    const fetcher = vi.fn<typeof fetch>(async () => tokenResponse(accessToken));
    const api = await plannedApi();
    const provider = api.createProductionAgentTokenProvider(providerOptions(fetcher));
    const credential = await provider.exchangeDelegatedCredential({
      subjectToken: SUBJECT_TOKEN,
      requestedScopes: ['ui4a:read', 'ui4a:write', 'development'],
    });
    const identity = await trustedIdentity(credential.authorizationHeader, ['ui4a:write']);
    expect(identity).toEqual({
      authorizationMode: 'credential',
      actor: 'agent',
      principal: 'human-alice',
      scopes: ['ui4a:read', 'ui4a:write', 'development'],
      policyScope: 'development',
      channel: 'oidc',
      humanApprovalEligible: false,
      delegation: {
        subject: 'human-alice',
        actorClientId: CLIENT_ID,
        source: 'token-exchange-sub-azp',
      },
    });

    const trustedExec = applyTrustedIdentity(
      { rel: 'post:first', action: 'archive', actor: 'human', principal: 'forged-root' },
      identity,
    );
    expect(
      actionRejectedEvent(trustedExec, { layer: 'guard-failed', reason: 'fixture rejection' }),
    ).toMatchObject({
      actor: 'agent',
      principal: 'human-alice',
      channel: 'oidc',
      identity: {
        authorizationMode: 'credential',
        scopes: ['ui4a:read', 'ui4a:write', 'development'],
        humanApprovalEligible: false,
        delegation: {
          subject: 'human-alice',
          actorClientId: CLIENT_ID,
          source: 'token-exchange-sub-azp',
        },
      },
    });

    const snapshot: EngineSnapshot = {
      instances: {
        'post:first': { rel: 'post:first', flow: 'posts', node: 'online', fields: {} },
      },
      collections: {},
      confirmations: {
        'confirmation:c1': {
          id: 'c1',
          targetRel: 'post:first',
          targetAction: 'archive',
          proposedBy: { actor: 'agent', principal: 'human-alice' },
          status: 'pending',
        },
      },
    };
    expect(
      approveConfirmation(
        snapshot,
        'c1',
        {
          actor: trustedExec.actor ?? 'human',
          principal: trustedExec.principal,
          identity: trustedExec.identity,
        },
        { flows: {}, guards: seedGuardRegistry },
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
  });
});
