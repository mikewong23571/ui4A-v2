/**
 * T2 Phase F / Task F3 — 人类路径 UI E2E B1/B2/B3(arch-brief §5 双执行者口径)。
 *
 * 同一场景的第二遍:人类走 renderer(浏览器表单),agent 走 HTTP 合同(baseline.spec)。
 * 浏览器真实走查:RJSF 表单逐字段填写、按钮提交、guard 投影、集合导航;
 * 断言落在业务结果 + /api/events 留痕(actor=human, principal=local-user,
 * channel=renderer)——同一份日志的另一种足迹。
 *
 * 复用 server-kit:每场景 TRUNCATE + 自起 3110 场景 server(独立 distDir)。
 */
import { expect, test, type Page } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

// 本文件全部用例指向场景 server(3110),与 baseline/chat 同源复用。
test.use({ baseURL: SCENARIO_BASE });

// T40 F-02:实体页 h1 = 实例身份;属性表「状态」行 = 当前节点中文标题(向导步骤名
// 与业务状态词同源,与列表成员状态词一致),裸 node 枚举退守 raw 层不再上表。
async function expectNodeStatusRow(page: Page, nodeTitle: string): Promise<void> {
  await expect(
    page
      .locator('section[aria-label="属性"] tr')
      .filter({ has: page.locator('th', { hasText: '状态' }) }),
  ).toContainText(nodeTitle);
}

// ---- 事件日志读取形状(/api/events)--------------------------------------

interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
}

interface EntityShape {
  properties: Record<string, unknown>;
  entities?: EntityShape[];
}

async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { events: LoggedEvent[] };
  return body.events;
}

async function getEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

function executed(events: LoggedEvent[], action: string): LoggedEvent[] {
  return events.filter((event) => event.kind === 'action-executed' && event.action === action);
}

// ---- 场景 -------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译)+ 浏览器走查,30s 不够。
  test.setTimeout(180_000);
});

test('B1 委托发布(人类):三步向导表单逐字段填写 → 发布 → 列表出现新文章', async ({ page }) => {
  await withFreshServer(async () => {
    // 保留的实体路由直达发布 flow；首页不承担应用内容入口合同。
    await page.goto('/entity?rel=flow%3Aarticle-drafting');

    // 第一步 basic-info:title(text);D50:参数表单默认收起,先打开
    // 起步时尚无草稿标题,实例身份 = 向导标题(T40 F-02)。
    await expect(page.locator('h1')).toHaveText('文章发布向导');
    await expectNodeStatusRow(page, '基本信息');
    await page
      .locator('[data-action-group-item="next"] button[data-presentation-action="open-form"]')
      .click();
    await page.getByRole('textbox', { name: /文章标题/ }).fill('人类的第三篇');
    await page.locator('[data-action-group-item="next"] form button[data-action="next"]').click();

    // 第二步 classification:category(select 下拉)+ tags(text)
    await expectNodeStatusRow(page, '分类');
    await page
      .locator('[data-action-group-item="next"] button[data-presentation-action="open-form"]')
      .click();
    await page.getByRole('combobox', { name: /分类/ }).selectOption('tech');
    await page.getByRole('textbox', { name: /标签/ }).fill('human-e2e');
    await page.locator('[data-action-group-item="next"] form button[data-action="next"]').click();

    // 第三步 content:body(textarea 文本域)
    await expectNodeStatusRow(page, '正文');
    await page
      .locator('[data-action-group-item="next"] button[data-presentation-action="open-form"]')
      .click();
    await page.getByRole('textbox', { name: /正文/ }).fill('第三篇正文:由人类经三步向导发布。');
    await page.locator('[data-action-group-item="next"] form button[data-action="next"]').click();

    // ready 节点:publish 表单(slug 来源 title)→ 发布
    await expectNodeStatusRow(page, '就绪');
    await page
      .locator('[data-action-group-item="publish"] button[data-presentation-action="open-form"]')
      .click();
    await page.getByRole('textbox', { name: /文章标题/ }).fill('人类的第三篇');
    // 触发键与提交键同名;提交按钮按结构定位(铁律 3 的 data-action 挂点)
    await page.locator('form button[data-action="publish"]').click();

    // 向导循环语义(D11):发布后回到基本信息(起草下一篇),不再是 done 终态
    await expectNodeStatusRow(page, '基本信息');

    // 文章集合合同可导航，且新文章实体真实存在并处于 published。
    await page.goto('/entity?rel=articles');
    const articles = await getEntity('articles');
    expect(articles.properties.count).toBe(3);
    const created = page.locator('section[aria-label="成员"] a[data-rel^="post:"]', {
      hasText: '人类的第三篇',
    });
    await expect(created).toBeVisible();
    // T40 F-02:成员行状态词为节点中文标题(已发布),裸 node 枚举不进读面。
    await expect(created).toContainText('已发布');

    // B1 字段保真(D24):向导分类步所填 category/tags 经 set-field 落在向导
    // 实例上,publish 只带 title 参数——合并语义下必须出现在发布文章实体上。
    const createdRel = await created.getAttribute('data-rel');
    const entity = await getEntity(createdRel ?? '');
    const fields = entity.properties.fields as Record<string, unknown> | undefined;
    expect(fields?.category).toBe('tech');
    expect(fields?.tags).toBe('human-e2e');

    // 日志留痕:publish 由 human 执行,principal/channel 为 renderer 口径
    const events = await getEvents();
    const publishes = executed(events, 'publish');
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.actor).toBe('human');
    expect(publishes[0]!.principal).toBe('local-user');
    expect(publishes[0]!.channel).toBe('renderer');
    expect(publishes[0]!.rel).toBe('article-drafting:main');
  });
});

test('B2 点名下线(人类):直达 post-welcome → 下线;first-post 不受影响', async ({ page }) => {
  await withFreshServer(async () => {
    // 保留的实体路由直达目标文章，不依赖首页成员快照。
    await page.goto('/entity?rel=post%3Apost-welcome');
    // T40 F-02:h1 = 实例身份(文章标题);节点中文状态词在属性表「状态」行。
    await expect(page.locator('h1')).toHaveText('欢迎来到 UI4A');
    await expectNodeStatusRow(page, '已发布');
    await expect(page.getByRole('button', { name: '下线', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '下线', exact: true }).click();

    // 精确下线这一篇:节点 offline(状态行中文词;裸 node 行退守 raw,不再上表)
    await expectNodeStatusRow(page, '已下线');

    // guard 投影(声明层):offline 节点未声明 unpublish → 按钮不存在;
    // 该节点唯一声明动作是 republish
    await expect(page.getByRole('button', { name: '下线', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新发布' })).toBeVisible();

    // 精确业务实体状态：另一篇不受影响，目标文章已下线。
    expect((await getEntity('post:first-post')).properties.node).toBe('published');
    expect((await getEntity('post:post-welcome')).properties.node).toBe('offline');

    // 日志:unpublish 由 human 执行,rel 精确为 post-welcome
    const events = await getEvents();
    const unpublishes = executed(events, 'unpublish');
    expect(unpublishes).toHaveLength(1);
    expect(unpublishes[0]!.rel).toBe('post:post-welcome');
    expect(unpublishes[0]!.actor).toBe('human');
    expect(unpublishes[0]!.channel).toBe('renderer');
  });
});

test('B3 审核队列(人类):逐条 approve 至 pending 清零;c4 终态无重复按钮', async ({ page }) => {
  await withFreshServer(async () => {
    // 保留的评论集合路由可导航；pending 状态来自成员实体，而非首页摘要。
    // T40 F-02:成员行状态词为节点中文标题(待处理),裸 node 枚举不进读面。
    await page.goto('/entity?rel=comments');
    await expect(page.locator('section[aria-label="成员"] a', { hasText: '待处理' })).toHaveCount(
      3,
    );
    await expect(page.getByText('成员(4)')).toBeVisible();

    // c4 已 approved:终态节点零声明动作 → 详情页无任何动作按钮(approve 不重复)
    await page.click('a[data-rel="comment:c4"]');
    await expectNodeStatusRow(page, '已通过');
    await expect(page.locator('main button[data-action]')).toHaveCount(0);

    // 逐条 approve 3 条 pending(每次从队列点进成员 → 通过 → 回队列)
    for (let round = 0; round < 3; round += 1) {
      await page.goto('/entity?rel=comments');
      const pending = page.locator('section[aria-label="成员"] a', { hasText: '待处理' });
      await expect(pending).toHaveCount(3 - round);
      await pending.first().click();
      await page.getByRole('button', { name: '通过' }).click();
      await expectNodeStatusRow(page, '已通过');
    }

    // 队列清空:无 pending 成员
    await page.goto('/entity?rel=comments');
    await expect(page.locator('section[aria-label="成员"] a', { hasText: '待处理' })).toHaveCount(
      0,
    );

    // 日志:恰好 3 次 approve(c1/c2/c3),全部 human;c4 零处理痕迹
    const events = await getEvents();
    const approves = executed(events, 'approve');
    expect(approves).toHaveLength(3);
    expect(approves.map((event) => event.rel).sort()).toEqual([
      'comment:c1',
      'comment:c2',
      'comment:c3',
    ]);
    expect(approves.every((event) => event.actor === 'human')).toBe(true);
    const c4Touches = events.filter(
      (event) =>
        event.rel === 'comment:c4' && (event.action === 'approve' || event.action === 'reject'),
    );
    expect(c4Touches, 'c4(已 approved)不得被重复处理').toEqual([]);
  });
});
