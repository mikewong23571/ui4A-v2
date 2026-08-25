/**
 * T4 Phase D / Task D1 — S2 主链路 E2E(arch-brief §9.2、§11 铁律 5)。
 * 治理辅助场景(审批不委托 / 重放一致 / 跨站规则)见 s2-meta.spec.ts;
 * 共享合同客户端与场景 server 装置见 s2-kit.ts。
 *
 * S2 断言原文五要素,逐条落测:
 * ① 非法定义被拒且留痕(agent add-action to 不存在节点 → 422 guard 层,
 *    /api/events action-rejected 带原因);
 * ② 修正(to: done)→ submit → checks 八项过 → pending-approval(activation
 *    实体含机械 diff[新增 pin 可见]与 checks);
 * ③ 机械 diff 上人类批准:BIOS 页 /meta/activations → 详情 diff 可见 →
 *    approve(actor=human)→ definition-activated 留痕;
 * ④ sitemap 重生成:/.well-known/ui4a.json version 变化、ready 节点 action
 *    schema 含 pin;
 * ⑤ agent 下一步即可用新动作,无任何 prompt 改动(见下"零 prompt 口径")。
 *
 * 执行方式报告口径:
 * - agent 经 /_meta 合同 = runAgent + rule driver 起点显式 meta/flows
 *   (createContractClient 的 baseUrl 组合出 /_meta 前缀——agent 包零改动,
 *   同一循环协议走定义平面);向导预走/第二次激活的人类批准用直接 exec 序列
 *   (场景装置,身份仍是 human/bios)。
 * - 零 prompt 口径:文件级单例 driver(本文件全部 runAgent 共用同一实例),
 *   packages/agent 代码与动词词表零改动;新动作 pin 由 driver 经合同动态发现
 *   (目标动词只表达意图「置顶」,匹配的是激活后合同里出现的动作 title)。
 *   rule driver 的 done 启发式按动作名×词表桥接确认完成,中文意图动词(加动作/
 *   置顶)无法确认 done——这些提案循环用 maxSteps 预算单发执行,成功以
 *   successes(合同事实)断言。
 * - S2 语义澄清(Phase B 报告):「agent 下一步可用新动作」落在激活后出生/
 *   派生的实例上——v1 在途实例对新动作 undeclared。article-drafting 的向导是
 *   seed 单例、恒 born v1,故「激活后出生的实例 exec pin」由第二次修订实现:
 *   post-status 的 published 节点加 pin(自环 transition + set-field pinned),
 *   agent 在两次激活后发布的新文章(post 实例 born v2)即可 exec pin——这正是
 *   验收 2「B 场景文章上」与验收 4 在途/新实例对照的口径。
 */
import { runAgent } from '@ui4a/agent';
import { createRuleDriver } from '@ui4a/agent/testkit/rule-driver';
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './server-kit';
import {
  AGENT_PRINCIPAL,
  HUMAN_PRINCIPAL,
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
  opKinds,
  pinOnPublished,
  pinOnReady,
} from './s2-kit';

// 本文件用例指向场景 server(3110)。
test.use({ baseURL: SCENARIO_BASE });

/** 零 prompt 口径的载体:同一 driver 实例服务本文件全部 runAgent 调用。 */
const agentDriver = createRuleDriver();

// ---- 场景(串行复用 3110)------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译),30s 不够。
  test.setTimeout(180_000);
});

test('S2 主链路:非法定义拒且留痕 → 修正 → submit/pending(diff+checks)→ BIOS 人类批准 → sitemap bump → 在途 v1 undeclared → agent 零 prompt 用新动作 pin', async ({
  page,
}) => {
  await withFreshServer(async () => {
    // ---- 基线:激活前的业务 sitemap(ready 只有 publish;无任何 _meta 入口)----
    const sitemapBefore = await getSitemap();
    expect(
      nodeActionsOf(flowOf(sitemapBefore, 'article-drafting'), 'ready').map((a) => a.name),
    ).toEqual(['publish']);
    expect(
      sitemapBefore.surfaces.every((surface) => !surface.rel.startsWith('meta/')),
      '业务 sitemap 不得出现 _meta/meta 入口(跨站规则)',
    ).toBe(true);

    // ---- 在途 v1 实例装置:agent 把 seed 向导走到 ready(激活前出生)----------
    await agentWalkWizardToReady('s2 wizard draft');

    // ---- ① 前置:agent 经 /_meta 合同 revise(active v1 → draft)--------------
    const revise = await runAgent(
      agentDriver,
      { verb: 'revise', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(revise.outcome, `轨迹:${JSON.stringify(opKinds(revise.steps))}`).toBe('done');
    expect(revise.successes.map((entry) => entry.action)).toEqual(['revise']);
    expect((await getMetaEntity('meta/flow:article-drafting')).properties).toMatchObject({
      status: 'draft',
      version: 1,
    });

    // ---- ① 非负例:add-action 的 to 指向不存在节点 → 422 拒且留痕 -------------
    const bad = await runAgent(
      agentDriver,
      {
        verb: '加动作',
        resource: 'article-drafting',
        fields: pinOnReady('nonexistent-node'),
      },
      metaAgentOptions(),
    );
    expect(bad.outcome, '非法提案应终局 failed(引擎拒后无可行路径)').toBe('failed');
    expect(bad.successes).toEqual([]);
    const rejectedStep = bad.steps.find((step) => step.outcome === 'rejected');
    expect(rejectedStep?.op).toMatchObject({ kind: 'exec', action: 'add-action' });
    expect(rejectedStep?.rejection).toMatchObject({ layer: 'guard-failed' });
    expect(rejectedStep?.rejection?.reason).toContain('to-exists');

    const rejectedEvents = eventsOf(await getEvents(), 'action-rejected').filter(
      (event) => event.action === 'add-action',
    );
    expect(rejectedEvents, '非法定义拒绝必须留痕(I6)').toHaveLength(1);
    expect(rejectedEvents[0]).toMatchObject({
      rel: 'meta/flow:article-drafting',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
    });
    expect(rejectedEvents[0].reason).toContain('to-exists');

    // ---- ② 修正:to: done → 通过;submit → checks 八项过 → pending-approval ----
    const good = await runAgent(
      agentDriver,
      { verb: '加动作', resource: 'article-drafting', fields: pinOnReady('done') },
      metaAgentOptions(2), // 单发预算:执行成功即达成本提案(done 启发式不覆盖中文动词)
    );
    expect(good.successes.map((entry) => entry.action)).toEqual(['add-action']);
    expect(good.steps.at(-1)?.outcome).toBe('executed');

    const submit = await runAgent(
      agentDriver,
      { verb: 'submit', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(submit.outcome, `轨迹:${JSON.stringify(opKinds(submit.steps))}`).toBe('done');
    expect(submit.successes.map((entry) => entry.action)).toEqual(['submit']);

    // activation 实体:pending-approval + checks 八项全过 + 机械 diff(纯数据)
    const activation = await getMetaEntity('meta/activation:a1');
    expect(activation.properties).toMatchObject({
      id: 'a1',
      flow: 'article-drafting',
      status: 'pending-approval',
      version: 2,
      'requested-by': { actor: 'agent', principal: AGENT_PRINCIPAL },
    });
    const checks = activation.properties.checks as { name: string; pass: boolean }[];
    expect(checks.map((check) => check.name).sort()).toEqual([
      'app-known',
      'capability-registered',
      'edge-targets-exist',
      'effect-known',
      'executor-profile-valid',
      'field-types-known',
      'guards-registered',
      'initial-exists',
      'submission-policy-valid',
      'terminal-reachable',
    ]);
    expect(checks.every((check) => check.pass)).toBe(true);

    const diff = activation.properties.diff as {
      algorithm: string;
      before: { nodes: { name: string; actions: { name: string }[] }[] };
      after: { nodes: { name: string; actions: { name: string }[] }[] };
      changed: { added: unknown[]; deleted: unknown[]; updated: unknown[] };
    };
    expect(diff.algorithm).toBe('deep-object-diff');
    const afterReady = diff.after.nodes.find((node) => node.name === 'ready');
    expect(afterReady?.actions.map((action) => action.name)).toEqual(['publish', 'pin']);
    expect(JSON.stringify(diff.changed.added), '机械 diff 的新增视角应含 pin').toContain('pin');
    const beforeReady = diff.before.nodes.find((node) => node.name === 'ready');
    expect(beforeReady?.actions.map((action) => action.name)).toEqual(['publish']);

    // 定义实体随 lifecycle 转 pending-approval;事件链 revise→edited→submitted(actor=agent)
    expect((await getMetaEntity('meta/flow:article-drafting')).properties).toMatchObject({
      status: 'pending-approval',
    });
    const eventsMid = await getEvents();
    expect(eventsOf(eventsMid, 'definition-revised')).toHaveLength(1);
    expect(eventsOf(eventsMid, 'definition-revised')[0]).toMatchObject({
      rel: 'meta/flow:article-drafting',
      actor: 'agent',
    });
    const submitted = eventsOf(eventsMid, 'definition-submitted');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ rel: 'meta/flow:article-drafting', actor: 'agent' });
    expect(submitted[0].detail).toMatchObject({ name: 'article-drafting', passed: true });

    // ---- ③ human BIOS 批准(UI 走查:队列 → 详情 diff → approve)-------------
    await page.goto('/meta/activations');
    await expect(page.getByText('激活队列(待审 1)')).toBeVisible();
    await expect(page.locator('a[href="/meta/activation/a1"]')).toContainText(
      'a1 · article-drafting → v2 · 提议 agent',
    );
    await page.click('a[href="/meta/activation/a1"]');

    // 详情:checks 八行全过;机械 diff 可见且含 pin(react-diff-view 内建渲染,验收 6)
    await expect(page.getByRole('heading', { name: '激活 a1' })).toBeVisible();
    const checkRows = page.locator('section[aria-label="不变式检查"] tbody tr');
    await expect(checkRows).toHaveCount(10);
    for (let index = 0; index < 10; index += 1) {
      await expect(checkRows.nth(index)).toContainText('通过');
    }
    const diffSection = page.locator('section[aria-label="机械 diff"]');
    // diff 只呈现变更路径(deep-object-diff 视角):新增动作 pin 的声明全文可见
    await expect(diffSection).toContainText('pin');
    await expect(diffSection).toContainText('置顶');
    await expect(diffSection).toContainText('"to":"done"');

    // approve(renderer 恒 human;guard actor-is-human 对 BIOS 面放行)
    await page.click('button[data-action="approve"]');
    await expect(page.locator('button[data-action="approve"]')).toHaveCount(0);
    await expect(
      page.locator('section[aria-label="属性"] tbody tr', { hasText: 'approved' }).first(),
    ).toBeVisible();

    // 事件链:definition-activated(actor=human、principal=local-user、channel=bios)
    const activated = eventsOf(await getEvents(), 'definition-activated');
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({
      rel: 'meta/flow:article-drafting',
      action: 'approve',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'bios',
    });
    expect(activated[0].detail).toMatchObject({
      name: 'article-drafting',
      version: 2,
      activationId: 'a1',
      decidedBy: { actor: 'human', principal: HUMAN_PRINCIPAL },
    });

    // ---- ③' BIOS 拓扑图(T13 验收 2):/meta/flow/<name> 与 /meta/self 只读拓扑可见
    await page.goto('/meta/flow/article-drafting');
    const topology = page.locator('section[aria-label="拓扑"]');
    await expect(topology).toBeVisible();
    // 节点标注 title;边标注 action 名(v2 已激活:ready 节点 publish/pin 双边)。
    await expect(topology).toContainText('基本信息');
    await expect(topology).toContainText('就绪');
    await expect(topology).toContainText('publish');
    await expect(topology).toContainText('pin');
    // 只读口径:拓扑区不提供任何编辑入口(无拖拽连线 handle 交互按钮)。
    await expect(topology.locator('button')).toHaveCount(0);
    // /meta/self 同形投影:definition-lifecycle 拓扑同样渲染。
    await page.goto('/meta/self');
    const selfTopology = page.locator('section[aria-label="拓扑"]');
    await expect(selfTopology).toBeVisible();
    await expect(selfTopology).toContainText('待批准');

    // ---- ③'' 版本两版对比(T13 Phase B 验收 3):版本区 v1/v2 可见,选 v1×v2 →
    // 机械 diff 含 pin(v2 新增动作;只读对比,数据来自版本子实体嵌入全文)----
    await page.goto('/meta/flow/article-drafting');
    const versionSection = page.locator('section[aria-label="版本历史"]');
    await expect(versionSection).toBeVisible();
    await expect(versionSection.locator('tr[data-version="1"]')).toBeVisible();
    await expect(versionSection.locator('tr[data-version="2"]')).toBeVisible();
    await versionSection.locator('select[data-compare="base"]').selectOption('1');
    await versionSection.locator('select[data-compare="candidate"]').selectOption('2');
    const versionDiff = versionSection.locator('[data-bios="diff"]');
    await expect(versionDiff).toBeVisible();
    await expect(versionDiff).toContainText('pin');

    // ---- ④ sitemap 重生成(version 变化;ready 节点 action schema 含 pin)------
    const sitemapAfter = await getSitemap();
    expect(sitemapAfter.version).not.toBe(sitemapBefore.version);
    const readyActions = nodeActionsOf(flowOf(sitemapAfter, 'article-drafting'), 'ready');
    expect(readyActions.map((action) => action.name)).toEqual(['publish', 'pin']);
    const pinSchema = readyActions.find((action) => action.name === 'pin');
    expect(pinSchema?.fields, 'sitemap 的 action 摘要应携带参数 schema').toHaveProperty('type');

    // ---- 在途 v1:向导(born v1)对新动作 undeclared,按出生定义走完 -----------
    const wizard = await getEntity('article-drafting:main');
    expect(wizard.actions.map((action) => action.name)).toEqual(['publish']);
    const inFlightPin = await exec({
      rel: 'article-drafting:main',
      action: 'pin',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(inFlightPin.status).toBe(400);
    expect((inFlightPin.json as { layer?: string }).layer).toBe('undeclared');
    const undeclaredEvents = eventsOf(await getEvents(), 'action-rejected').filter(
      (event) => event.action === 'pin',
    );
    expect(undeclaredEvents).toHaveLength(1);

    // ---- 第二次修订:post-status published 节点加 pin(激活后出生实例的载体)--
    const revise2 = await runAgent(
      agentDriver,
      { verb: 'revise', resource: 'post-status' },
      metaAgentOptions(),
    );
    expect(revise2.outcome).toBe('done');
    const pin2 = await runAgent(
      agentDriver,
      { verb: '加动作', resource: 'post-status', fields: pinOnPublished() },
      metaAgentOptions(2),
    );
    expect(pin2.successes.map((entry) => entry.action)).toEqual(['add-action']);
    const submit2 = await runAgent(
      agentDriver,
      { verb: 'submit', resource: 'post-status' },
      metaAgentOptions(),
    );
    expect(submit2.outcome).toBe('done');

    const activation2 = await getMetaEntity('meta/activation:a2');
    expect(activation2.properties).toMatchObject({
      id: 'a2',
      flow: 'post-status',
      status: 'pending-approval',
      version: 2,
    });
    // human 经同一 /_meta 合同批准(身份与 BIOS 面同源:actor=human/channel=bios)
    const approve2 = await execMeta({
      rel: 'meta/activation:a2',
      action: 'approve',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'bios',
    });
    expect(approve2.status).toBe(200);
    expect((await getMetaEntity('meta/flow:post-status')).properties).toMatchObject({
      status: 'active',
      version: 2,
    });

    // ---- ⑤ agent 零 prompt 用新动作(同一 driver 会话,无任何常量变化)--------
    // 新目标「发布」:agent 在两次激活后发布新文章 → post 实例 born v2。
    const publish = await runAgent(
      agentDriver,
      {
        verb: '发布',
        fields: {
          title: 's2 pinned article',
          category: 'tech',
          tags: 's2',
          body: 'S2:激活后出生的实例即可用新动作,零 prompt 改动。',
        },
      },
      {
        baseUrl: SCENARIO_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        startRel: 'articles',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
      },
    );
    expect(publish.outcome, `轨迹:${JSON.stringify(opKinds(publish.steps))}`).toBe('done');
    expect(publish.successes.map((entry) => entry.action)).toEqual(['publish']);

    // 新文章 born v2:动作面含 pin(S2 语义澄清:新动作落在激活后出生的实例上);
    // 对照:seed 的 v1 出生文章(post-welcome)无 pin(在途按出生定义)。
    const newPost = await getEntity('post:s2-pinned-article');
    expect(newPost.properties).toMatchObject({ node: 'published' });
    expect(newPost.actions.map((action) => action.name)).toEqual(['unpublish', 'archive', 'pin']);
    expect((await getEntity('post:post-welcome')).actions.map((action) => action.name)).toEqual([
      'unpublish',
      'archive',
    ]);

    // 新目标「置顶」:目标动词只表达意图;pin 由 driver 经合同动态发现并 exec。
    const pinRun = await runAgent(
      agentDriver,
      { verb: '置顶', resource: 's2-pinned-article' },
      {
        baseUrl: SCENARIO_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        startRel: 'articles',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
        maxSteps: 2,
      },
    );
    expect(pinRun.successes.map((entry) => entry.action)).toEqual(['pin']);

    // 文章实体出现 pin 相关状态(set-field pinned;投影摊平为裸值)与事件
    const pinned = await getEntity('post:s2-pinned-article');
    expect((pinned.properties.fields as Record<string, unknown>).pinned).toBe(true);
    const pinEvents = eventsOf(await getEvents(), 'action-executed').filter(
      (event) => event.action === 'pin',
    );
    expect(pinEvents).toHaveLength(1);
    expect(pinEvents[0]).toMatchObject({
      rel: 'post:s2-pinned-article',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
  });
});
