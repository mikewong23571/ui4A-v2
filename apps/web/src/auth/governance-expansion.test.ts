import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { resolveTrustedRequestIdentity } from './request-identity';

// D66.4 授权推导补充(T48):credential 分支中,凭证授予集合含 `governance`
// scope 时,grantedApplications 展开为「当前已安装 application 全集」;不含
// governance 时 token 逐 app 语义不变;`scopes` 字段始终保留 token 原词。
const NOW_SECONDS = 1_788_739_200;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const ISSUER = 'https://auth.ui4a.mothership.internal/realms/ui4a';
const AUDIENCE = 'ui4a-api';
const KEY_ID = 'ui4a-auth-fixture-governance';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SIGNING_KEY = createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' }));
const PUBLIC_JWK = {
  ...(publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }),
  use: 'sig',
  alg: 'RS256',
  kid: KEY_ID,
};

const POLICY = {
  issuer: ISSUER,
  audience: AUDIENCE,
  algorithms: ['RS256'] as const,
  humanClientIds: ['ui4a-web'],
  agentClientIds: ['ui4a-agent', 'ui4a-cli'],
  delegatedScopesByClient: {
    'ui4a-agent': ['ui4a:read', 'ui4a:write', 'ui4a:policy:publishing', 'governance'],
    'ui4a-cli': ['ui4a:read', 'ui4a:write', 'ui4a:policy:publishing'],
  },
  agentCredentialSourcesByClient: {
    'ui4a-agent': 'token-exchange-sub-azp' as const,
    'ui4a-cli': 'device-authorization-sub-azp' as const,
  },
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

// 与运行时快照口径一致:路由传入 authorizedPolicyScopes = Object.keys(snapshot
// .applications)——此处即「当前已安装 application 全集」的 fixture(乱序以
// 同时证明展开结果的排序确定性)。
const INSTALLED_APPLICATIONS = [
  'editorial',
  'governance',
  'publishing',
  'community',
  'default',
  'development',
] as const;

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
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), SIGNING_KEY);
  return `${signingInput}.${base64Url(signature)}`;
}

function bearer(jwt: string): string {
  return `Bearer ${jwt}`;
}

function resolve(url: string, authorization: string) {
  return resolveTrustedRequestIdentity(new Request(url, { headers: { authorization } }), {
    profile: 'production',
    plane: 'meta',
    requiredScopes: ['ui4a:read'],
    authorizedPolicyScopes: INSTALLED_APPLICATIONS,
    productionPolicy: POLICY,
    productionDependencies: VALID_DEPENDENCIES,
  });
}

describe('governance grant expansion of grantedApplications (D66.4)', () => {
  it('expands a governance grant to the deduped, sorted installed application universe', async () => {
    const context = await resolve(
      'https://ui4a.internal/_meta/api/entity',
      bearer(token({ scope: 'openid ui4a:read governance' })),
    );

    expect(context.authorizationMode).toBe('credential');
    expect(context.grantedApplications).toEqual([
      'community',
      'default',
      'development',
      'editorial',
      'governance',
      'publishing',
    ]);
    // scopes 字段保持 token 原词:推导不污染审计事实。
    expect(context.scopes).toEqual(['ui4a:read', 'governance']);
  });

  it('keeps per-app token semantics without a governance grant (human and agent device tokens)', async () => {
    const human = await resolve(
      'https://ui4a.internal/_meta/api/entity',
      bearer(token({ scope: 'openid ui4a:read ui4a:policy:publishing' })),
    );
    expect(human.grantedApplications).toEqual(['publishing']);

    const cliDevice = await resolve(
      'https://ui4a.internal/_meta/api/entity',
      bearer(
        token({ azp: 'ui4a-cli', scope: 'openid ui4a:read ui4a:write ui4a:policy:publishing' }),
      ),
    );
    expect(cliDevice.actor).toBe('agent');
    expect(cliDevice.grantedApplications).toEqual(['publishing']);
  });

  it('accepts an expansion-only installed application as a declared lens, still drops the rest', async () => {
    const inUniverse = await resolve(
      'https://ui4a.internal/_meta/api/entity?rel=meta%2Fflows&scope=editorial',
      bearer(token({ scope: 'openid ui4a:read governance' })),
    );
    // editorial 不在 token 中,只在展开后的授予集合内 → 合法 lens。
    expect(inUniverse.policyScope).toBe('editorial');

    const outsideUniverse = await resolve(
      'https://ui4a.internal/_meta/api/entity?rel=meta%2Fflows&scope=finance',
      bearer(token({ scope: 'openid ui4a:read governance' })),
    );
    // 展开不改变 D51 丢弃规则:未安装应用仍静默视为未声明。
    expect(outsideUniverse.policyScope).toBeUndefined();
  });

  it('still fails with scope_insufficient when the token grants no application at all', async () => {
    await expect(
      resolve(
        'https://ui4a.internal/_meta/api/entity',
        bearer(token({ scope: 'openid ui4a:read' })),
      ),
    ).rejects.toMatchObject({ code: 'scope_insufficient' });
  });
});
