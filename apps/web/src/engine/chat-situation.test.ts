import { beforeEach, describe, expect, it } from 'vitest';

import { sliceSitemapDisclosure, type SitemapSummary } from '@ui4a/agent';
import { CHAT_VIEW_PROTOCOL_VERSION, type ClientViewReport } from '@ui4a/shared';

import type { TrustedRequestAuditContext } from '../auth/request-identity';
import { resolveStartRel } from '../chat/start-chain';
import { appendPresenceChange, ensurePresenceTables } from '@ui4a/db/presence';
import { appendEvent, ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { situationForChat } from './chat-situation';
import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const PRINCIPAL = 'user:client-view-lock';
/** 空业务 sitemap(上述断言只走 entry/站点兜底,不触碰存在性表与标题)。 */
const EMPTY_SITEMAP = {
  version: 'test',
  surfaces: [],
  flows: [],
  applications: [],
  capabilities: [],
};

/** 与本地 profile resolveTrustedRequestIdentity 产物同构的受信身份(D51:授予集合口径)。 */
function identityWith(
  overrides: Partial<Pick<TrustedRequestAuditContext, 'scopes' | 'grantedApplications'>> = {},
): TrustedRequestAuditContext {
  return {
    authorizationMode: 'self-reported-local-demo',
    actor: 'human',
    principal: PRINCIPAL,
    scopes: ['development', 'publishing'],
    grantedApplications: ['development', 'publishing'],
    channel: 'http',
    humanApprovalEligible: true,
    ...overrides,
  };
}

function clientView(
  presence: Partial<ClientViewReport['presence']> = {},
): NonNullable<Parameters<typeof situationForChat>[0]['clientView']> {
  return {
    schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
    presence: {
      clientInstanceId: 'client-view-lock',
      site: 'desk-view',
      scope: null,
      thread: null,
      focus: null,
      ...presence,
    },
  };
}

async function writeStoredPresence(site: string, scope: string): Promise<void> {
  const identity = { principal: PRINCIPAL, actor: 'human' as const, channel: 'test' };
  await appendPresenceChange(pool, { schemaVersion: 1, kind: 'site', value: site }, identity);
  await appendPresenceChange(pool, { schemaVersion: 1, kind: 'scope', value: scope }, identity);
}

beforeEach(async () => {
  await ensurePresenceTables(pool);
  await pool.query('TRUNCATE presence_current');
});

describe('chat situation adapter', () => {
  it('recognizes an explicitly selected installed application in local demo', async () => {
    const located = await situationForChat({
      principal: 'local-user',
      clientView: clientView({ scope: 'publishing' }),
    });
    expect(located.scope).toBe('publishing');
  });
  it('keeps local demo headless chat unlocated without a requested lens', async () => {
    const unlocated = await situationForChat({ principal: 'user:headless' });
    expect(unlocated).toMatchObject({ site: 'workstation', focus: null });
    expect(unlocated.scope).toBeUndefined();
    expect(unlocated.disclosure.scope).toBeUndefined();
  });

  it('accepts an explicit local-demo lens without deriving it from local grants', async () => {
    const located = await situationForChat({
      principal: 'user:headless',
      clientView: clientView({ scope: 'default' }),
    });
    expect(located.scope).toBe('default');
    expect(located.disclosure.scope).toBe('default');
  });

  it('does not turn the first credential grant into a headless Chat start location', async () => {
    const situation = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith({ grantedApplications: ['development', 'publishing'] }),
    });

    expect(situation.scope).toBeUndefined();
    expect(situation.disclosure.scope).toBeUndefined();
    expect(
      resolveStartRel({
        situation,
        snapshot: {
          instances: {},
          collections: {},
          applications: {
            development: {
              name: 'development',
              title: 'Development',
              intent: 'Develop software',
              entry: { target: 'flow:software-change', role: 'primary-task' },
            },
            publishing: {
              name: 'publishing',
              title: 'Publishing',
              intent: 'Publish content',
              entry: { target: 'flow:article-drafting', role: 'primary-create' },
            },
          },
        },
        sitemap: EMPTY_SITEMAP,
        granted: null,
      }),
    ).toEqual({ rel: 'applications' });
  });

  // T31 R9(←T29,D48 裁决 b):clientView.presence 进入 explicit 槽位是有意分层——
  // "显式"指请求明示信号的正典地位(时间最新、随请求给出),不是更高特权;
  // scope 越权始终由 grantedScopes 收口。以下行为测试钉死该语义。

  it('treats clientView presence values as request-explicit and lets them outrank stored presence', async () => {
    await writeStoredPresence('desk-stored', 'publishing');
    const situation = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith(),
      clientView: clientView({ site: 'desk-view', scope: 'development' }),
    });
    expect(situation.site).toBe('desk-view');
    expect(situation.scope).toBe('development');
    expect(situation.disclosure.scope).toBe(situation.scope);
  });

  it('moves the situation when the explicit slot changes while staying inside the grant envelope', async () => {
    // stored presence 固定在 development:flip 后的 explicit('publishing')若被降级
    // 出 explicit 槽位,回退会落在 development 而非 publishing,本测试即红。
    await writeStoredPresence('desk-stored', 'development');
    const flipped = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith(),
      clientView: clientView({ site: 'desk-next', scope: 'publishing' }),
    });
    expect(flipped.site).toBe('desk-next');
    expect(flipped.scope).toBe('publishing');
  });

  it('folds an out-of-envelope clientView scope back into the authorized grant set', async () => {
    await writeStoredPresence('desk-stored', 'publishing');
    const situation = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith(),
      clientView: clientView({ site: 'desk-view', scope: 'no-such-app' }),
    });
    expect(situation.scope).not.toBe('no-such-app');
    expect(situation.scope).toBe('publishing');
  });
});

// (D51-窄披露)CLI 三纪律锚的 prompt 侧:内置 agent 的收窄只发生在披露装配层——
// 宽合同对照在 .well-known/ui4a.json/route.production-auth.test.ts '(D51-宽合同)'
// (HTTP 发现文档按授予并集返回 publishing 详情);此处锁定 lens=default 时喂给
// agent 的披露输入(scope/startRel → sliceSitemapDisclosure)不含 publishing 域
// surfaces 详情。lens 值只流向披露与落点,不进入任何鉴权判定。
describe('(D51-窄披露) prompt 披露输入', () => {
  const DISCLOSURE_SITEMAP: SitemapSummary = {
    version: 't33-disclosure-fixture',
    surfaces: [
      { rel: 'overview', title: '工作台总览', app: 'default' },
      { rel: 'articles', title: '文章列表', app: 'publishing' },
    ],
    applications: [
      {
        name: 'default',
        intent: 'default work',
        flows: [
          {
            name: 'welcome',
            title: 'Welcome',
            actions: [{ name: 'advance', title: 'Advance', node: 'start', guards: [] }],
          },
        ],
      },
      {
        name: 'publishing',
        intent: 'publish content',
        flows: [
          {
            name: 'article-drafting',
            title: 'Articles',
            actions: [{ name: 'publish', title: 'Publish', node: 'ready', guards: [] }],
          },
        ],
      },
    ],
    capabilities: [],
  };

  it('lens=default 时披露切片不含 publishing 域 surfaces/flow 详情', async () => {
    // 与 /api/chat 同构:clientView 显式声明 + identity 授予集合 → situation 单点装配。
    const situation = await situationForChat({
      principal: PRINCIPAL,
      identity: identityWith({ grantedApplications: ['default', 'publishing'] }),
      clientView: clientView({ scope: 'default' }),
    });
    expect(situation.scope).toBe('default');
    expect(situation.disclosure.scope).toBe('default');

    // 导航落点与披露 scope 出自同一 situation(route 的 runAgent options:
    // app=situation.scope, startRel=resolveStartRel(situation))。
    const startRel = resolveStartRel({
      situation,
      snapshot: {
        instances: {},
        collections: {},
        applications: {
          default: {
            name: 'default',
            title: 'Default',
            intent: 'overview',
            entry: { target: 'overview', role: 'primary-collection' },
          },
          publishing: {
            name: 'publishing',
            title: 'Publishing',
            intent: 'publish',
            entry: { target: 'articles', role: 'primary-collection' },
          },
        },
      },
      sitemap: EMPTY_SITEMAP,
      granted: null,
    });
    expect(startRel).toEqual({ rel: 'overview' });

    // prompts.ts describeSitemap 的装配输入:sliceSitemapDisclosure({scope, currentRel})。
    const disclosed = sliceSitemapDisclosure(DISCLOSURE_SITEMAP, {
      scope: situation.disclosure.scope,
      currentRel: startRel.rel,
    });
    // 其他已授权应用保留导航摘要,不复制执行细节。
    expect(disclosed.applications.map(({ name }) => name)).toEqual(['default', 'publishing']);
    expect(
      disclosed.applications
        .find(({ name }) => name === 'publishing')
        ?.flows.every((flow) => flow.actions === undefined),
    ).toBe(true);
    // publishing 保留路由所属应用,不携带动作详情。
    expect(disclosed.surfaces.find(({ rel }) => rel === 'articles')).toEqual({
      rel: 'articles',
      title: '文章列表',
      app: 'publishing',
    });
    // 宽合同对照:HTTP 发现文档仍按授予并集返回 publishing 详情(另锚
    // '(D51-宽合同)' 用例)——收窄只发生在 prompt 披露层,不是 HTTP 合同。
    expect(DISCLOSURE_SITEMAP.applications.map(({ name }) => name)).toEqual([
      'default',
      'publishing',
    ]);
  });
});

// ---------------------------------------------------------------------------
// T52 Phase 3:local grantedScopes 收缩钉测(chat-situation.ts 消费口径)。
// local 模式(无 identity)的授予集合 = Object.keys(snapshot.applications)——
// 应用停用经 fold 删键后自动收缩;显式 clientView scope 指向停用应用时不在
// 授予集合内,situation 折回未定位(注意力不产生授权,授权也不产生注意力)。
// ---------------------------------------------------------------------------
describe('T52 停用联动:local grantedScopes 随 applications 键收缩', () => {
  beforeEach(async () => {
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
  });

  it('停用后 local 授予集合不再含停用名;显式 scope 指向停用应用折回未定位', async () => {
    const engine = await getEngine(pool);
    const before = Object.keys(engine.getSnapshot().applications ?? {});
    expect(before).toContain('editorial');
    expect(before).toContain('publishing');

    await appendEvent(pool, {
      kind: 'application-deprecated',
      rel: 'meta/application:editorial',
      action: 'deprecate',
      actor: 'human',
      principal: 'system:governance',
      channel: 'meta',
      detail: { name: 'editorial', commandId: 'cmd:t52-chat-situation-pin' },
    });
    await engine.readSnapshot();

    // fold 删键 → local grantedScopes(= Object.keys(applications))收缩。
    const after = Object.keys(engine.getSnapshot().applications ?? {});
    expect(after).not.toContain('editorial');
    expect(after).toContain('publishing');

    const situation = await situationForChat({
      principal: 'user:t52-local-shrink',
      clientView: clientView({ scope: 'editorial' }),
    });
    expect(situation.scope).toBeUndefined();
    expect(situation.disclosure.scope).toBeUndefined();

    // 反向锚:未停用应用照常定位。
    const control = await situationForChat({
      principal: 'user:t52-local-shrink',
      clientView: clientView({ scope: 'publishing' }),
    });
    expect(control.scope).toBe('publishing');
  });
});
