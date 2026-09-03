import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { POST as exec } from './exec/route';
import { GET as entity } from './entity/route';
import type { ResolveRequestIdentityOptions } from '../../../auth/request-identity';

// D66.4 授权推导补充(T48)合同级验证:治理凭证(授予集合含 `governance`)的
// grantedApplications 展开为已安装 application 全集后,application-bundle 受治理
// 激活(D66.3)出生的新 app 无需 IdP/部署旁路即对同一凭证可达——meta entity
// 可读、且可作为合法显式 lens 走 Draft 写路径;逐 app token 语义不变。
const mocks = vi.hoisted(() => ({ resolveIdentity: vi.fn() }));

vi.mock('../../../auth/request-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth/request-identity')>();
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
const KEY_ID = 'ui4a-auth-fixture-governance-contract';

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

// 治理凭证:IdP 只断言稳定身份事实 + governance 授予,不含逐 app 词汇。
const GOVERNANCE_CREDENTIAL = token('openid ui4a:read ui4a:write ui4a:approve governance');
const PER_APP_CREDENTIAL = token('openid ui4a:read ui4a:write ui4a:approve ui4a:policy:publishing');

// 真实 resolveTrustedRequestIdentity(production 分支)+ 注入的凭证策略/依赖:
// 路由传出的 authorizedPolicyScopes(= Object.keys(snapshot.applications))原样
// 进入真实推导,展开逻辑在合同路径上真实执行。
async function installRealProductionIdentity(): Promise<void> {
  const actual = await vi.importActual<typeof import('../../../auth/request-identity')>(
    '../../../auth/request-identity',
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

function bundlePayload(bundleName: string): Record<string, unknown> {
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name: bundleName, version: 1 },
    applications: [
      { name: bundleName, title: 'Demo', intent: 'Demonstrate governance expansion reach' },
    ],
    capabilities: [],
    flows: [
      {
        name: `${bundleName}-entry`,
        title: 'Demo entry',
        app: bundleName,
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    ],
    seed: { rel: `seed:${bundleName}`, detail: { instances: {} } },
  };
}

function execRequest(credential: string, scope: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost:3100/_meta/api/exec?scope=${scope}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
    body: JSON.stringify(body),
  });
}

function createBundleDraft(
  credential: string,
  scope: string,
  bundleName: string,
  commandId: string,
) {
  return execRequest(credential, scope, {
    rel: 'meta/drafts',
    action: 'create',
    params: {
      kind: 'application-bundle',
      target: bundleName,
      commandId,
      payload: bundlePayload(bundleName),
    },
  });
}

async function activateBundleViaRoute(bundleName: string, prefix: string): Promise<string> {
  const created = await exec(
    createBundleDraft(GOVERNANCE_CREDENTIAL, 'governance', bundleName, `${prefix}:create`),
  );
  expect(created.status).toBe(200);
  const draftRel = String(
    ((await created.json()) as { entity: { properties: { rel: string } } }).entity.properties.rel,
  );
  const submitted = await exec(
    execRequest(GOVERNANCE_CREDENTIAL, 'governance', {
      rel: draftRel,
      action: 'submit',
      params: { commandId: `${prefix}:submit` },
    }),
  );
  expect(submitted.status).toBe(200);
  const activationRel = String(
    ((await submitted.json()) as { entity: { properties: { activation: string } } }).entity
      .properties.activation,
  );
  const approved = await exec(
    execRequest(GOVERNANCE_CREDENTIAL, 'governance', {
      rel: activationRel,
      action: 'approve',
      params: { commandId: `${prefix}:approve` },
    }),
  );
  expect(approved.status).toBe(200);
  return bundleName;
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  await installRealProductionIdentity();
});

describe('governance credential expansion across governed application genesis (D66.4)', () => {
  it('reaches a newly activated application immediately without IdP or deployment side channels', async () => {
    // 激活前:acme-portal 未安装,不在 authorizedPolicyScopes 内 → 展开也够不到
    // → lens 声明静默丢弃 → 422 lens 拒绝。
    const preActivation = await exec(
      createBundleDraft(GOVERNANCE_CREDENTIAL, 'acme-portal', 'acme-portal', 'gov:pre'),
    );
    expect(preActivation.status).toBe(422);
    expect(await preActivation.json()).toMatchObject({
      layer: 'schema-invalid',
      reason: expect.stringContaining('explicit authorized application lens'),
    });

    // 受治理 genesis:治理凭证在自身显式 lens(governance)下提案 → 提交 → 人类批准。
    await activateBundleViaRoute('acme-portal', 'gov:install');

    // 新 app 出生即进全集:同一治理凭证(未换发 token)立即可读其 meta entity,
    // 且 lens=acme-portal(token 外新 app)被接受并透传。
    const flowEntity = await entity(
      new Request(
        'http://localhost:3100/_meta/api/entity?rel=meta%2Fflow%3Aacme-portal-entry&scope=acme-portal',
        { headers: { authorization: `Bearer ${GOVERNANCE_CREDENTIAL}` } },
      ),
    );
    expect(flowEntity.status).toBe(200);
    expect(flowEntity.headers.get('x-ui4a-effective-scope')).toBe('acme-portal');

    // 同一 lens 也满足 meta exec Draft 写路径:不再 lens 拒绝,Draft 被接受并锁定
    // 在 acme-portal lens 下。
    const nextDraft = await exec(
      createBundleDraft(GOVERNANCE_CREDENTIAL, 'acme-portal', 'acme-partner', 'gov:next'),
    );
    expect(nextDraft.status).toBe(200);
    const nextBody = (await nextDraft.json()) as {
      entity: { properties: { rel: string; provenance: { commandId: string } } };
    };
    expect(nextBody.entity.properties.rel).toMatch(/^draft:/);
    expect(nextBody.entity.properties.provenance.commandId).toBe('gov:next');
  });

  it('keeps a per-app credential outside the governance expansion', async () => {
    await activateBundleViaRoute('acme-portal', 'perapp:install');

    // 逐 app token(ui4a:policy:publishing)不含 governance:即使新 app 已安装
    // (authorizedPolicyScopes 已生长),lens=acme-portal 仍静默丢弃 → 422。
    const perApp = await exec(
      createBundleDraft(PER_APP_CREDENTIAL, 'acme-portal', 'acme-partner', 'perapp:next'),
    );
    expect(perApp.status).toBe(422);
    expect(await perApp.json()).toMatchObject({
      layer: 'schema-invalid',
      reason: expect.stringContaining('explicit authorized application lens'),
    });
  });
});
