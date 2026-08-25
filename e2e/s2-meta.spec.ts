/**
 * T4 Phase D — S2 治理辅助场景(arch-brief §9.2、§11 铁律 5;主链路见 s2.spec.ts,
 * 共享装置见 s2-kit.ts):
 * - meta approve 不委托:agent approve → 422 actor-is-human 拒且留痕,activation
 *   仍 pending,human 通道不受影响;
 * - 重放一致(验收 5 / I5):S2 全链事件 TRUNCATE 后原序回灌 → 重启 server 全量
 *   fold → 活跃定义 v2 含 pin、activation 终态(artifact hash)与在线一致;
 * - 跨站规则:业务 sitemap 无 _meta 入口;/_meta well-known 可达;业务/meta
 *   端点互拒非本面 rel。
 */
import { runAgent } from '@ui4a/agent';
import { createRuleDriver } from '@ui4a/agent/testkit/rule-driver';
import { expect, test } from '@playwright/test';

import { appendEvent, listEvents } from '../apps/web/src/db/events';
import { getPool } from '../apps/web/src/db/pool';
import { DATABASE_URL, SCENARIO_BASE, truncateEvents, withFreshServer } from './kits/server-kit';
import {
  AGENT_PRINCIPAL,
  HUMAN_PRINCIPAL,
  META_BASE,
  eventsOf,
  exec,
  execMeta,
  agentWalkWizardToReady,
  getEntity,
  getEvents,
  getMetaEntity,
  getSitemap,
  flowOf,
  metaAgentOptions,
  nodeActionsOf,
  pinOnPublished,
  pinOnReady,
  spawnScenarioServer,
} from './kits/s2-kit';

// 本文件全部用例指向场景 server(3110)。
test.use({ baseURL: SCENARIO_BASE });

/** 零 prompt 口径的载体:同一 driver 实例服务本文件全部 runAgent 调用。 */
const agentDriver = createRuleDriver();

// ---- 场景(串行复用 3110)------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译),30s 不够。
  test.setTimeout(180_000);
});

test('meta approve 不委托:agent approve → 422 actor-is-human 拒且留痕,activation 仍 pending(human 通道不受影响)', async () => {
  await withFreshServer(async () => {
    // agent 经合同到达 pending(无改动修订:checks 对 v1 内容全过)
    const revise = await runAgent(
      agentDriver,
      { verb: 'revise', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(revise.outcome).toBe('done');
    const submit = await runAgent(
      agentDriver,
      { verb: 'submit', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(submit.outcome).toBe('done');
    expect((await getMetaEntity('meta/activation:a1')).properties).toMatchObject({
      status: 'pending-approval',
    });

    // agent approve → 422 guard(actor-is-human;铁律 5 审批不委托)
    const approve = await execMeta({
      rel: 'meta/activation:a1',
      action: 'approve',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(approve.status).toBe(422);
    const body = approve.json as { layer?: string; reason?: string };
    expect(body.layer).toBe('guard-failed');
    expect(body.reason).toContain('actor-is-human');

    // 留痕:action-rejected(actor=agent,原因入日志)
    const rejected = eventsOf(await getEvents(), 'action-rejected').filter(
      (event) => event.action === 'approve',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      rel: 'meta/activation:a1',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      reason: expect.stringContaining('actor-is-human'),
    });

    // 拒绝不改状态:activation 仍 pending、队列仍在、无 definition-activated
    expect((await getMetaEntity('meta/activation:a1')).properties).toMatchObject({
      status: 'pending-approval',
    });
    expect((await getMetaEntity('meta/activations')).properties).toMatchObject({ count: 1 });
    expect(eventsOf(await getEvents(), 'definition-activated')).toEqual([]);

    // human 通道不受影响:同一激活 human approve 仍 200(状态未被拒绝损坏)
    const human = await execMeta({
      rel: 'meta/activation:a1',
      action: 'approve',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'bios',
    });
    expect(human.status).toBe(200);
  });
});

test('重放一致:S2 全链事件 TRUNCATE 原序回灌 → 活跃定义 v2 含 pin、activation 终态与在线一致(I5)', async () => {
  /** 在线状态快照(结构断言的采集面;seq/ts 天然不同,不采集)。 */
  const captureState = async (): Promise<Record<string, unknown>> => {
    const sitemap = await getSitemap();
    const articleFlow = flowOf(sitemap, 'article-drafting');
    const postFlow = flowOf(sitemap, 'post-status');
    const articleMeta = await getMetaEntity('meta/flow:article-drafting');
    const postMeta = await getMetaEntity('meta/flow:post-status');
    const a1 = await getMetaEntity('meta/activation:a1');
    const a2 = await getMetaEntity('meta/activation:a2');
    const wizard = await getEntity('article-drafting:main');
    const post = await getEntity('post:replay-pinned-article');
    const events = await getEvents();
    return {
      sitemapVersion: sitemap.version,
      articleReadyActions: nodeActionsOf(articleFlow, 'ready').map((action) => action.name),
      postPublishedActions: nodeActionsOf(postFlow, 'published').map((action) => action.name),
      articleDefinition: {
        version: articleMeta.properties.version,
        status: articleMeta.properties.status,
      },
      postDefinition: { version: postMeta.properties.version, status: postMeta.properties.status },
      activations: [a1, a2].map((activation) => ({
        id: activation.properties.id,
        status: activation.properties.status,
        version: activation.properties.version,
        artifact: activation.properties.artifact,
        approvedBy: activation.properties['approved-by'],
      })),
      wizard: { node: wizard.properties.node, actions: wizard.actions.map((a) => a.name) },
      post: {
        node: post.properties.node,
        actions: post.actions.map((a) => a.name),
        fields: post.properties.fields,
      },
      eventTrail: events.map(
        (event) => `${event.kind}|${event.rel}|${event.action}|${event.actor}`,
      ),
    };
  };

  const rows = await (async () => {
    const server = await spawnScenarioServer();
    let log: Awaited<ReturnType<typeof listEvents>> = [];
    try {
      const agent = { actor: 'agent', principal: AGENT_PRINCIPAL, channel: 'e2e' } as const;
      const human = { actor: 'human', principal: HUMAN_PRINCIPAL, channel: 'bios' } as const;

      // —— S2 全链(直接 exec 序列;与主链路同一合同与裁决路径)——
      await agentWalkWizardToReady('replay wizard draft');
      expect(
        (await execMeta({ rel: 'meta/flow:article-drafting', action: 'revise', ...agent })).status,
      ).toBe(200);
      const badAdd = await execMeta({
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: pinOnReady('nonexistent-node'),
        ...agent,
      });
      expect(badAdd.status).toBe(422);
      const goodAdd = await execMeta({
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: pinOnReady('done'),
        ...agent,
      });
      expect(goodAdd.status).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/flow:article-drafting', action: 'submit', ...agent })).status,
      ).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/activation:a1', action: 'approve', ...human })).status,
      ).toBe(200);

      expect(
        (await execMeta({ rel: 'meta/flow:post-status', action: 'revise', ...agent })).status,
      ).toBe(200);
      expect(
        (
          await execMeta({
            rel: 'meta/flow:post-status',
            action: 'add-action',
            params: pinOnPublished(),
            ...agent,
          })
        ).status,
      ).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/flow:post-status', action: 'submit', ...agent })).status,
      ).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/activation:a2', action: 'approve', ...human })).status,
      ).toBe(200);

      // 业务面:发布(born v2)→ 在途 undeclared → 新文章 exec pin
      expect(
        (
          await exec({
            rel: 'article-drafting:main',
            action: 'publish',
            params: { title: 'replay pinned article' },
            ...agent,
          })
        ).status,
      ).toBe(200);
      const inFlightPin = await exec({
        rel: 'article-drafting:main',
        action: 'pin',
        ...agent,
      });
      expect(inFlightPin.status).toBe(400);
      const pinExec = await exec({ rel: 'post:replay-pinned-article', action: 'pin', ...agent });
      expect(pinExec.status).toBe(200);

      const before = await captureState();
      // 结构健全性:活跃定义 v2 含 pin、activation 终态 approved(防"两边都空"的假一致)
      expect(before.articleReadyActions).toEqual(['publish', 'pin']);
      expect(before.postPublishedActions).toContain('pin');
      expect(
        (before.activations as { status: string; artifact: string }[]).every(
          (activation) => activation.status === 'approved' && activation.artifact !== undefined,
        ),
      ).toBe(true);
      log = await listEvents(getPool(DATABASE_URL));
      expect(log.length).toBeGreaterThan(20);
      expect(log.some((event) => event.kind === 'definition-activated')).toBe(true);
    } finally {
      await server.kill();
    }
    return log;
  })();

  // —— TRUNCATE + 原序回灌(bigserial 重新编号;fold 只依赖全序)——
  await truncateEvents();
  const db = getPool(DATABASE_URL);
  for (const row of rows) {
    await appendEvent(db, {
      domain: row.domain ?? 'core',
      kind: row.kind,
      actor: row.actor ?? undefined,
      principal: row.principal ?? undefined,
      channel: row.channel ?? undefined,
      rel: row.rel ?? undefined,
      action: row.action ?? undefined,
      params: row.params,
      reason: row.reason ?? undefined,
      detail: row.detail ?? undefined,
    });
  }

  // —— 二次 boot(不 TRUNCATE):seed 迁移识别定义已在场,全量 fold 重放 ——
  const server2 = await spawnScenarioServer({ truncateFirst: false });
  try {
    const replayed = await getEvents();
    expect(replayed.map((event) => event.kind)).toEqual(rows.map((row) => row.kind));

    const before = await captureState();
    expect(before.articleReadyActions).toEqual(['publish', 'pin']);
    expect(before.postPublishedActions).toContain('pin');
    expect((before.activations as { status: string }[]).map((a) => a.status)).toEqual([
      'approved',
      'approved',
    ]);
    // 派生文章与在途向导按事件重放一致(pinned 状态、出生动作面)
    expect(before.post).toMatchObject({
      node: 'published',
      actions: ['unpublish', 'archive', 'pin'],
    });
    expect((before.post as { fields: Record<string, unknown> }).fields.pinned).toBe(true);
    expect(before.wizard).toMatchObject({ node: 'basic-info', actions: ['next', 'abandon'] });
  } finally {
    await server2.kill();
  }
});

test('跨站规则:业务 sitemap 无 _meta 入口;/_meta well-known 可达;业务/meta 端点互拒非本面 rel', async ({
  page,
}) => {
  await withFreshServer(async () => {
    // 业务 sitemap:导航枚举不含任何 meta 面(进入定义层必须显式意图)
    const sitemap = await getSitemap();
    expect(sitemap.surfaces.map((surface) => surface.rel).sort()).toEqual([
      'agent-runs',
      'articles',
      'comments',
      'flow:agent-definition-authoring',
      'flow:article-drafting',
      'flow:comment-moderation',
      'flow:post-status',
      'flow:software-change',
      'flow:writing-request',
      'inbox',
      'software-changes',
      'writing-requests',
    ]);

    // 业务实体 links 不携带 /_meta href
    const articles = await getEntity('articles');
    expect(
      (articles.links ?? []).every((link) => !link.href.includes('_meta')),
      '业务实体 links 不得携带 _meta 入口',
    ).toBe(true);

    // _meta 站点 sitemap 可访问:meta rel 面 + 定义实体随 definitions 动态列出
    const metaSitemapResponse = await fetch(`${META_BASE}/.well-known/ui4a.json`);
    expect(metaSitemapResponse.status).toBe(200);
    const metaSitemap = (await metaSitemapResponse.json()) as {
      site: string;
      surfaces: { rel: string }[];
    };
    expect(metaSitemap.site).toBe('meta');
    expect(metaSitemap.surfaces.map((surface) => surface.rel)).toEqual(
      expect.arrayContaining([
        'meta/self',
        'meta/flows',
        'meta/activations',
        'meta/flow:article-drafting',
        'meta/flow:post-status',
        'meta/flow:comment-moderation',
      ]),
    );

    // T13/T18:capability 定义面进 meta sitemap；业务面可另有 Run 资源。
    expect(metaSitemap.surfaces.map((surface) => surface.rel)).toEqual(
      expect.arrayContaining([
        'meta/capabilities',
        'meta/capability:draft',
        'meta/capability:notify',
        'meta/capability:clarify',
        'meta/capability:coding.execute',
        'meta/capability:writing.compose',
        'meta/capability:agent-definition.author',
      ]),
    );
    // 业务 sitemap 不得泄漏 capability definition 的 meta rel。
    expect(
      sitemap.surfaces.every((surface) => !surface.rel.startsWith('meta/')),
      '业务 sitemap 不得出现 meta 入口',
    ).toBe(true);
    // meta/capabilities 集合投影:全部已安装 seed 成员直达
    const capabilities = await getMetaEntity('meta/capabilities');
    expect(capabilities.properties).toMatchObject({ count: 6 });
    expect((capabilities.entities ?? []).map((sub) => sub.properties.name).sort()).toEqual([
      'agent-definition.author',
      'clarify',
      'coding.execute',
      'draft',
      'notify',
      'writing.compose',
    ]);

    // 业务端点对 meta rel 404(跨站不混,双向)
    expect(
      (await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent('meta/flows')}`)).status,
    ).toBe(404);
    expect(
      (
        await exec({
          rel: 'meta/flow:article-drafting',
          action: 'revise',
          actor: 'agent',
          principal: AGENT_PRINCIPAL,
          channel: 'e2e',
        })
      ).status,
    ).toBe(404);
    // _meta 端点对业务 rel 404
    expect(
      (
        await execMeta({
          rel: 'post:post-welcome',
          action: 'archive',
          actor: 'human',
          principal: HUMAN_PRINCIPAL,
          channel: 'bios',
        })
      ).status,
    ).toBe(404);

    // BIOS 页可达(React shell 200;空队列如实呈现)
    const response = await page.goto('/meta/activations');
    expect(response?.status()).toBe(200);
    await expect(page.getByText('队列为空(无待批准的定义激活)。')).toBeVisible();

    // BIOS capabilities 页(T13 Phase C):三个 seed 可见,链接进详情(属性投影可读)
    const capsResponse = await page.goto('/meta/capabilities');
    expect(capsResponse?.status()).toBe(200);
    for (const name of ['draft', 'notify', 'clarify']) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await page.getByRole('link', { name: 'draft', exact: true }).click();
    await expect(page).toHaveURL(/\/meta\/capability\/draft$/);
    await expect(page.getByText('extract', { exact: true })).toBeVisible();
  });
});
