import { createPrivateKey, sign } from 'node:crypto';

import type { Sitemap } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';
import { describe, expect, it } from 'vitest';

import { assertRelInPolicyScope, relCoveredByPolicyScope } from './application-scope';
import { authenticationErrorResponse, resolveTrustedRequestIdentity } from './request-identity';

// T22 验证修复:credential 模式下未显式请求 scope 时,服务端按 rel 归属在已授予
// scope 中确定性选择(scopeCoverage);不扩大授权——无覆盖时回退 default/granted[0],
// 下游 assertRelInPolicyScope 照常 403。fixture 复用 authentication-negative 的
// 本地签名 token 形态。

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

const POLICY = {
  issuer: ISSUER,
  audience: AUDIENCE,
  algorithms: ['RS256'] as const,
  humanClientIds: ['ui4a-web'],
  agentClientIds: ['ui4a-agent'],
  delegatedScopesByClient: {
    'ui4a-agent': ['ui4a:read', 'ui4a:write'],
  },
};

const DEPENDENCIES = {
  clock: () => NOW_MILLISECONDS,
  jwks: {
    load: async () => ({
      keys: [PUBLIC_JWK],
      fetchedAtMs: NOW_MILLISECONDS - 1_000,
      expiresAtMs: NOW_MILLISECONDS + 60_000,
    }),
  },
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function token(claims: Record<string, unknown> = {}): string {
  const encodedHeader = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }));
  const encodedClaims = base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'human-alice',
      azp: 'ui4a-web',
      scope: 'openid ui4a:read ui4a:write',
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

const snapshot = {
  instances: {
    'article:a1': { rel: 'article:a1', flow: 'publish-article', node: 'draft', fields: {} },
  },
  definitions: {
    'publish-article': {
      name: 'publish-article',
      version: 1,
      status: 'active',
      definition: { name: 'publish-article', app: 'publishing' },
    },
    'moderate-comment': {
      name: 'moderate-comment',
      version: 1,
      status: 'active',
      definition: { name: 'moderate-comment', app: 'default' },
    },
  },
  applications: {
    default: { name: 'default', title: 'Default', intent: 'Default' },
    development: { name: 'development', title: 'Development', intent: 'Develop' },
    publishing: { name: 'publishing', title: 'Publishing', intent: 'Publish' },
  },
} as unknown as EngineSnapshot;

const sitemap: Sitemap = {
  version: 'fixture',
  surfaces: [
    { rel: 'articles', title: 'Articles', collection: true, app: 'publishing' },
    { rel: 'comments', title: 'Comments', collection: true, app: 'default' },
  ],
  flows: [],
  applications: [],
  capabilities: [],
} as unknown as Sitemap;

const AUTHORIZED_SCOPES = ['default', 'development', 'publishing'];

function coverageFor(...rels: string[]): (policyScope: string) => boolean {
  return (policyScope) =>
    rels.every((rel) =>
      relCoveredByPolicyScope({ snapshot, sitemap, plane: 'business' }, rel, policyScope),
    );
}

function resolve(
  rel: string,
  scope: string,
  options: { requestedScope?: string; defaultPolicyScope?: string } = {},
) {
  const query = options.requestedScope === undefined ? '' : `&scope=${options.requestedScope}`;
  return resolveTrustedRequestIdentity(
    new Request(`https://ui4a.internal/api/entity?rel=${encodeURIComponent(rel)}${query}`, {
      headers: { authorization: `Bearer ${token({ scope })}` },
    }),
    {
      profile: 'production',
      plane: 'business',
      requiredScopes: ['ui4a:read'],
      authorizedPolicyScopes: AUTHORIZED_SCOPES,
      defaultPolicyScope: options.defaultPolicyScope ?? 'development',
      productionPolicy: POLICY,
      productionDependencies: DEPENDENCIES,
      scopeCoverage: coverageFor(rel),
    },
  );
}

describe('credential 模式未显式 scope 时按 rel 归属选择已授予 scope', () => {
  it('articles(属 publishing)→ 跳过 default/development 选中 publishing', async () => {
    const identity = await resolve('articles', 'ui4a:read development publishing');
    expect(identity.policyScope).toBe('publishing');
  });

  it('comments(属 default)→ 选中 default', async () => {
    const identity = await resolve('comments', 'ui4a:read development default');
    expect(identity.policyScope).toBe('default');
  });

  it('未知 rel 被任意 scope 覆盖 → 取 granted 顺序的第一个(确定性)', async () => {
    const identity = await resolve('delegations', 'ui4a:read publishing development');
    expect(identity.policyScope).toBe('publishing');
  });

  it('无任何已授予 scope 覆盖 → 回退 default,下游照常 403(不扩大授权)', async () => {
    const identity = await resolve('articles', 'ui4a:read development');
    expect(identity.policyScope).toBe('development');
    let thrown: unknown;
    try {
      assertRelInPolicyScope({
        snapshot,
        sitemap,
        plane: 'business',
        rel: 'articles',
        policyScope: identity.policyScope,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'scope_insufficient' });
    expect(authenticationErrorResponse(thrown)?.status).toBe(403);
  });

  it('granted 为空时照旧 scope_insufficient(不进入覆盖选择)', async () => {
    await expect(resolve('articles', 'ui4a:read')).rejects.toMatchObject({
      code: 'scope_insufficient',
    });
  });

  it('显式 scope 参数语义完全不变:granted 即采纳,未授予仍 403', async () => {
    const explicit = await resolve('articles', 'ui4a:read development publishing', {
      requestedScope: 'development',
    });
    expect(explicit.policyScope).toBe('development');

    await expect(
      resolve('articles', 'ui4a:read development publishing', { requestedScope: 'governance' }),
    ).rejects.toMatchObject({ code: 'scope_insufficient' });
  });

  it('实例 rel 按 flow 归属判定覆盖(article:a1 → publishing)', async () => {
    const identity = await resolve('article:a1', 'ui4a:read development publishing');
    expect(identity.policyScope).toBe('publishing');
  });
});
