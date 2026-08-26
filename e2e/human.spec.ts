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
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

// 本文件全部用例指向场景 server(3110),与 baseline/chat 同源复用。
test.use({ baseURL: SCENARIO_BASE });

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

    // 第一步 basic-info:title(text)
    await expect(page.locator('h1')).toHaveText('基本信息');
    await page.getByRole('textbox', { name: /文章标题/ }).fill('人类的第三篇');
    await page.getByRole('button', { name: '下一步', exact: true }).click();

    // 第二步 classification:category(select 下拉)+ tags(text)
    await expect(page.locator('h1')).toHaveText('分类');
    await page.getByRole('combobox', { name: /分类/ }).selectOption('tech');
    await page.getByRole('textbox', { name: /标签/ }).fill('human-e2e');
    await page.getByRole('button', { name: '下一步', exact: true }).click();

    // 第三步 content:body(textarea 文本域)
    await expect(page.locator('h1')).toHaveText('正文');
    await page.getByRole('textbox', { name: /正文/ }).fill('第三篇正文:由人类经三步向导发布。');
    await page.getByRole('button', { name: '完成编辑', exact: true }).click();

    // ready 节点:publish 表单(slug 来源 title)→ 发布
    await expect(page.locator('h1')).toHaveText('就绪');
    await page.getByRole('textbox', { name: /文章标题/ }).fill('人类的第三篇');
    await page.getByRole('button', { name: '发布', exact: true }).click();

    // 向导循环语义(D11):发布后回到基本信息(起草下一篇),不再是 done 终态
    await expect(page.locator('h1')).toHaveText('基本信息');

    // 文章集合合同可导航，且新文章实体真实存在并处于 published。
    await page.goto('/entity?rel=articles');
    const articles = await getEntity('articles');
    expect(articles.properties.count).toBe(3);
    const created = page.locator('section[aria-label="成员"] a[data-rel^="post:"]', {
      hasText: '人类的第三篇',
    });
    await expect(created).toBeVisible();
    await expect(created).toContainText('published');

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
    await expect(page.locator('h1')).toHaveText('已发布');
    await expect(page.getByRole('button', { name: '下线' })).toBeVisible();

    await page.getByRole('button', { name: '下线' }).click();

    // 精确下线这一篇:节点 offline
    await expect(page.locator('h1')).toHaveText('已下线');
    await expect(page.getByText('节点 offline')).toBeVisible();

    // guard 投影(声明层):offline 节点未声明 unpublish → 按钮不存在;
    // 该节点唯一声明动作是 republish
    await expect(page.getByRole('button', { name: '下线' })).toHaveCount(0);
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
    await page.goto('/entity?rel=comments');
    await expect(page.locator('section[aria-label="成员"] a', { hasText: 'pending' })).toHaveCount(
      3,
    );
    await expect(page.getByText('成员(4)')).toBeVisible();

    // c4 已 approved:终态节点零声明动作 → 详情页无任何动作按钮(approve 不重复)
    await page.click('a[data-rel="comment:c4"]');
    await expect(page.locator('h1')).toHaveText('已通过');
    await expect(page.locator('main button')).toHaveCount(0);

    // 逐条 approve 3 条 pending(每次从队列点进成员 → 通过 → 回队列)
    for (let round = 0; round < 3; round += 1) {
      await page.goto('/entity?rel=comments');
      const pending = page.locator('section[aria-label="成员"] a', { hasText: 'pending' });
      await expect(pending).toHaveCount(3 - round);
      await pending.first().click();
      await page.getByRole('button', { name: '通过' }).click();
      await expect(page.getByText('节点 approved')).toBeVisible();
    }

    // 队列清空:无 pending 成员
    await page.goto('/entity?rel=comments');
    await expect(page.locator('section[aria-label="成员"] a', { hasText: 'pending' })).toHaveCount(
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
