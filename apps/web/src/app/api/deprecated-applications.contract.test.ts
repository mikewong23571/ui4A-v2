import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appendEvent, ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests, getEngine } from '../../engine/service';
import { GET as sessionGet } from './auth/session/route';
import { GET as businessEntityGet } from './entity/route';
import { GET as metaEntityGet } from './meta/entity/route';
import type { ResolveRequestIdentityOptions } from '../../auth/request-identity';

// T52 Phase 3(D71.3 反 fail-open)路由合同测试:应用停用(application-deprecated
// fold 级联:applications 删键、deprecatedApplications 审计表在场、同 app 定义
// 条目置废但键与 app 字段保留、实例保留)后的受众语义,真库 service 全链路:
//
// - US3 咽喉:business/meta 两面的 application: 直接读面归属经「active ∪
//   deprecated」双集解析出非空,任何授予集合(含治理展开)与之无交集 → 结构化
//   拒绝(403 scope_insufficient),不落空受众 fail-open 由投影层 404 兜底;
// - US3 授予内(停用名仍在凭证授予集合,如停用后未换发的逐 app token):受众
//   谓词放行(授予内零可见授权事件),实体缺位由投影如实 404;
// - US3 停用应用的实例/flow 面:经保留的 definitions/instances 归属解析非空,
//   无交集同样拒绝(钉测,不依赖本 Phase 改动);
// - US5 集合成员过滤面:meta/applications 与业务 applications 均不含停用成员;
// - US5 授予收缩钉测:authorizedPolicyScopes = Object.keys(snapshot.applications)
//   的内联点随停用自动收缩——治理会话(/api/auth/session)的 grantedApplications
//   不再含停用名。
const mocks = vi.hoisted(() => ({ resolveIdentity: vi.fn() }));

vi.mock('../../auth/request-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/request-identity')>();
  return {
    ...actual,
    resolveTrustedRequestIdentity: mocks.resolveIdentity,
  };
});

const pool = getPool(process.env.DATABASE_URL!);

const NOW_SECONDS = 1_788_739_200;
const NOW_MILLISECONDS = NOW_SECONDS * 1_000;
const ISSUER = 'https://auth.ui4a.mothership.internal/realms/ui4a';
const AUDIENCE = 'ui4a-api';
const KEY_ID = 'ui4a-auth-fixture-deprecated-audience';

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
  agentClientIds: [],
  delegatedScopesByClient: {},
  agentCredentialSourcesByClient: {},
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

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function token(scope: string): string {
  const encodedHeader = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KEY_ID }));
  const encodedClaims = base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'human-alice',
      azp: 'ui4a-web',
      scope,
      iat: NOW_SECONDS - 30,
      nbf: NOW_SECONDS - 30,
      exp: NOW_SECONDS + 300,
    }),
  );
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), SIGNING_KEY);
  return `${signingInput}.${base64Url(signature)}`;
}

// 治理凭证(D66.4 展开为 Object.keys(applications) 全集——停用即出局)与
// 停用 app 的逐 app 凭证(停用后未换发,授予集合仍含停用名)。governance
// 双词并给:plain 词驱动 D66.4 展开,ui4a:policy:governance 是会话面的
// 治理登录标志词(GOVERNANCE_LOGIN_SCOPE)。
const GOVERNANCE_CREDENTIAL = token(
  'openid ui4a:read ui4a:write governance ui4a:policy:governance',
);
const EDITORIAL_CREDENTIAL = token('openid ui4a:read ui4a:write ui4a:policy:editorial');

// 真实 resolveTrustedRequestIdentity(production 分支)+ 注入的凭证策略/依赖:
// 路由传出的 authorizedPolicyScopes(= Object.keys(snapshot.applications))原样
// 进入真实推导,停用后的授予收缩在合同路径上真实执行。
async function installRealProductionIdentity(): Promise<void> {
  const actual = await vi.importActual<typeof import('../../auth/request-identity')>(
    '../../auth/request-identity',
  );
  mocks.resolveIdentity.mockImplementation(
    (request: Request, options: ResolveRequestIdentityOptions) =>
      actual.resolveTrustedRequestIdentity(request, {
        ...options,
        profile: 'production',
        productionPolicy: POLICY,
        productionDependencies: VALID_DEPENDENCIES,
      }),
  );
}

/** 受治理停用事件(直接落库模拟治理裁决路径的伴随事件)+ 增量折入快照。 */
async function deprecateApplication(name: string, commandId: string): Promise<void> {
  const engine = await getEngine(pool);
  await appendEvent(pool, {
    kind: 'application-deprecated',
    rel: `meta/application:${name}`,
    action: 'deprecate',
    actor: 'human',
    principal: 'system:governance',
    channel: 'meta',
    detail: { name, commandId, reason: 'T52 Phase 3 audience contract fixture' },
  });
  await engine.readSnapshot();
}

function businessGet(rel: string, credential: string): Promise<Response> {
  return businessEntityGet(
    new Request(`http://localhost:3100/api/entity?rel=${encodeURIComponent(rel)}`, {
      headers: { authorization: `Bearer ${credential}` },
    }),
  );
}

function metaGet(rel: string, credential: string): Promise<Response> {
  return metaEntityGet(
    new Request(`http://localhost:3100/_meta/api/entity?rel=${encodeURIComponent(rel)}`, {
      headers: { authorization: `Bearer ${credential}` },
    }),
  );
}

function sessionProjection(credential: string): Promise<Response> {
  return sessionGet(
    new Request('http://localhost:3100/api/auth/session', {
      headers: { authorization: `Bearer ${credential}` },
    }),
  );
}

/** 集合成员直达 href → rel(entityHref 不编码,按查询参数语义解析)。 */
function memberRels(entity: { entities?: { href?: string }[] }): string[] {
  return (entity.entities ?? []).flatMap(({ href }) => {
    const rel = href === undefined ? undefined : new URL(href, 'http://x').searchParams.get('rel');
    return rel === null || rel === undefined ? [] : [rel];
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
  await installRealProductionIdentity();
});

describe('deprecated application audience semantics (T52 P3 / D71.3)', () => {
  it('US3 business: 停用后 application: 直接读面对治理展开凭证结构化拒绝,停用前可读', async () => {
    // 停用前对照:editorial 已安装,治理展开含之 → 受众内可读。
    const before = await businessGet('application:editorial', GOVERNANCE_CREDENTIAL);
    expect(before.status).toBe(200);

    await deprecateApplication('editorial', 'audience:business:deprecate');

    // fail-open 封堵:归属经双集解析出非空(editorial),治理展开(= 活跃全集)
    // 与之无交集 → 咽喉结构化拒绝,而非空受众放行后由投影层 404 兜底。
    const denied = await businessGet('application:editorial', GOVERNANCE_CREDENTIAL);
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({ error: { code: 'scope_insufficient' } });

    // 授予内(stale 逐 app 凭证):受众谓词放行,实体缺位如实 404
    //(授予内零可见授权事件)。
    const stale = await businessGet('application:editorial', EDITORIAL_CREDENTIAL);
    expect(stale.status).toBe(404);
  });

  it('US3 meta: meta/application: 经 /_meta/api/entity 存在性口径同源(治理 403 / 授予内 404)', async () => {
    await deprecateApplication('editorial', 'audience:meta:deprecate');

    const denied = await metaGet('meta/application:editorial', GOVERNANCE_CREDENTIAL);
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({ error: { code: 'scope_insufficient' } });

    const stale = await metaGet('meta/application:editorial', EDITORIAL_CREDENTIAL);
    expect(stale.status).toBe(404);
  });

  it('US3 停用应用的实例/flow 面归属非空:治理展开凭证同样拒绝(钉测)', async () => {
    await deprecateApplication('editorial', 'audience:faces:deprecate');
    // writing-request:main 为 editorial 的种子实例(级联保留),flow: 别名经
    // 保留的定义条目(app 字段在)解析——两面对无交集授予都是确定性拒绝。
    for (const rel of ['writing-request:main', 'flow:writing-request']) {
      const denied = await businessGet(rel, GOVERNANCE_CREDENTIAL);
      expect(denied.status, rel).toBe(403);
      await expect(denied.json()).resolves.toEqual({ error: { code: 'scope_insufficient' } });
    }
    // 授予内(stale 逐 app 凭证)实例仍可读:停用不清实例,受众判定不变。
    const staleInstance = await businessGet('writing-request:main', EDITORIAL_CREDENTIAL);
    expect(staleInstance.status).toBe(200);
  });

  it('US5 集合成员过滤:meta/applications 与业务 applications 均不含停用成员', async () => {
    await deprecateApplication('editorial', 'audience:collections:deprecate');

    const meta = await metaGet('meta/applications', GOVERNANCE_CREDENTIAL);
    expect(meta.status).toBe(200);
    const metaBody = (await meta.json()) as {
      properties: { count: number };
      entities: { href: string }[];
    };
    expect(memberRels(metaBody)).not.toContain('meta/application:editorial');
    expect(memberRels(metaBody)).toContain('meta/application:publishing');
    // 集合自洽:count = 成员数,停用名不在其中(walkthrough 之外另有 todo/
    // ideas/security 等已装 bundle 应用,不钉具体总数)。
    expect(metaBody.properties.count).toBe(memberRels(metaBody).length);

    const business = await businessGet('applications', GOVERNANCE_CREDENTIAL);
    expect(business.status).toBe(200);
    const businessBody = (await business.json()) as { entities: { href: string }[] };
    expect(memberRels(businessBody)).not.toContain('application:editorial');
    expect(memberRels(businessBody)).toContain('application:publishing');
  });

  it('US5 授予收缩钉测:治理会话 grantedApplications 随停用自动不含停用名', async () => {
    const before = await sessionProjection(GOVERNANCE_CREDENTIAL);
    expect(before.status).toBe(200);
    expect(
      ((await before.json()) as { grantedApplications: string[] }).grantedApplications,
    ).toContain('editorial');

    await deprecateApplication('editorial', 'audience:shrink:deprecate');

    const after = await sessionProjection(GOVERNANCE_CREDENTIAL);
    expect(after.status).toBe(200);
    const body = (await after.json()) as {
      grantedApplications: string[];
      governanceExpansion: boolean;
    };
    // authorizedPolicyScopes = Object.keys(snapshot.applications) 内联点:
    // 键删除即收缩,治理展开(D66.4)随之够不到停用名。
    expect(body.grantedApplications).not.toContain('editorial');
    expect(body.grantedApplications).toEqual(
      expect.arrayContaining(['governance', 'publishing', 'community', 'development', 'default']),
    );
    expect(body.governanceExpansion).toBe(true);
  });
});
