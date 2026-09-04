/**
 * T48 Phase 6c — application-bundle 受治理出生的浏览器 golden story(回归镜像)。
 *
 * 人类只在 /meta 走合同完成一个全新 application 的出生:
 * 1. /meta?scope=<已装 app> 作 lens → 导航 Drafts 集合;
 * 2. 集合动作 Create Draft(kind=application-bundle):先提交缺字段 payload,
 *    断言 Draft 落痕为 invalid(issues + checks FAIL,拒绝留痕不是异常);
 * 3. revise 修正为合法最小 bundle → ready,机械 diff(bundle-inventory)可读;
 * 4. submit → pending-approval;
 * 5. 激活实体页(meta/activation:draft-*)human-only approve(两步确认门);
 * 6. 断言:applications 集合出现新 app、业务 sitemap 出现新 flow 入口;
 *    且两者仅在 approve 之后出现(创建/提交阶段反向断言不含新名)。
 *
 * 身份:local demo 自报域,浏览器提交即 human 通道(actor=human、principal=
 * local-user、channel=bios),approve 的 actor-is-human 由该通道满足;协议层
 * agent 不可 approve 已有单测覆盖,不在本文件重复。
 * 数据:共享测试库可能残留既有 app,bundle 名取随机后缀避免冲突。
 */
import { expect, test, type Page } from '@playwright/test';

const LENS = 'publishing';

/** 合法最小 bundle(engine/drafts/application-bundle.test.ts fixture 同形,全新名)。 */
function bundlePayloadJson(name: string, title: string): string {
  return JSON.stringify(
    {
      schema: 'https://ui4a.dev/application-bundle/v1',
      bundle: { name, version: 1 },
      applications: [{ name, title, intent: 'T48 browser golden story: governed genesis' }],
      capabilities: [],
      flows: [
        {
          name: `${name}-entry`,
          title: 'Golden entry',
          app: name,
          initial: 'start',
          nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
          fields: [],
        },
      ],
      seed: { rel: `seed:${name}`, detail: { instances: {} } },
    },
    null,
    2,
  );
}

/** 缺字段 payload:schema 词不对 → parse-error issue(拒绝留痕起手,guard 不拒)。 */
const INVALID_PAYLOAD_JSON = JSON.stringify(
  { schema: 'https://example.com/not-a-bundle' },
  null,
  2,
);

async function installedApplicationNames(page: Page): Promise<string[]> {
  const response = await page.request.get('/_meta/api/entity?rel=meta%2Fapplications');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    entities?: { properties?: { name?: unknown } }[];
  };
  return (body.entities ?? []).map((member) => String(member.properties?.name ?? ''));
}

/** 站点 sitemap 的 surface rel 清单(meta 站点带 lens 查询参数)。 */
async function sitemapSurfaceRels(page: Page, site: 'business' | 'meta'): Promise<string[]> {
  const response =
    site === 'meta'
      ? await page.request.get(`/_meta/.well-known/ui4a.json?scope=${LENS}`)
      : await page.request.get('/.well-known/ui4a.json');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { surfaces: { rel: string }[] };
  return body.surfaces.map((surface) => surface.rel);
}

test('golden path: 人类在 /meta 受治理出生一个全新 application', async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = Math.random().toString(36).slice(2, 8);
  const bundleName = `t48-golden-${suffix}`;
  const appTitle = `T48 Golden ${suffix}`;
  const flowEntryRel = `flow:${bundleName}-entry`;

  await test.step('lens 进入 /meta,导航到 Drafts 集合(反向前置:新名未安装)', async () => {
    expect(await installedApplicationNames(page)).not.toContain(bundleName);
    await page.goto(`/meta?scope=${LENS}`);
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('link', { name: '打开 受治理草稿' }).click();
    await expect(page).toHaveURL(new RegExp(`rel=meta%2Fdrafts.*scope=${LENS}`));
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('status', { name: '集合结果摘要' })).toBeVisible();
  });

  await test.step('集合动作 Create Draft:kind=application-bundle + 缺字段 payload', async () => {
    await expect(page.getByRole('heading', { name: '集合动作' })).toBeVisible();
    // 触发键展开参数表单(D50:默认收起,打开是零业务事件)
    await page.getByRole('button', { name: 'Create Draft' }).click();
    const form = page.locator('div[data-action="create"]');
    await expect(form).toBeVisible();
    // RJSF v6 enum select 的 option value 是索引,label 才是枚举值——按 label 选
    await form
      .getByRole('combobox', { name: /kind/ })
      .selectOption({ label: 'application-bundle' });
    await form.getByRole('textbox', { name: /target/ }).fill(bundleName);
    await form.getByRole('textbox', { name: /payload/ }).fill(INVALID_PAYLOAD_JSON);
    await form.locator('button[type="submit"]').click();
    // 执行结果回执出现;集合成员刷新出目标名的新 Draft 卡片
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });
    const member = page.locator('a[data-nav="meta:collection-member"]', { hasText: bundleName });
    await expect(member).toBeVisible({ timeout: 15_000 });
    await member.click();
    await expect(page).toHaveURL(/rel=draft%3A/);
  });

  await test.step('Draft 详情:invalid 留痕(issues + checks FAIL),再 revise 修正', async () => {
    const header = page.getByRole('main').locator('header').first();
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: bundleName, level: 1 })).toBeVisible();
    await expect(header).toContainText('invalid');
    await expect(header).toContainText('application-bundle');
    // 拒绝留痕:校验 issue(parse-error)与 checks FAIL 如实呈现
    await expect(page.getByText(/\d+ 个阻塞问题/)).toBeVisible();
    await expect(page.getByText('parse-error').first()).toBeVisible();
    const checks = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Checks' }) });
    await expect(checks).toContainText('bundle-parseable');
    await expect(checks).toContainText('FAIL');

    // revise:payload 换成合法最小 bundle(baseVersion 由客户端从 version 观察)
    await page.getByRole('button', { name: 'Revise Draft' }).click();
    const reviseForm = page.locator('div[data-action="revise"]');
    await expect(reviseForm).toBeVisible();
    await reviseForm
      .getByRole('textbox', { name: /payload/ })
      .fill(bundlePayloadJson(bundleName, appTitle));
    await reviseForm.locator('button[type="submit"]').click();
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });

    // 修正后:ready、零阻塞、机械 diff(inventory 级)可读、checks 全过
    await expect(header).toContainText('ready', { timeout: 15_000 });
    await expect(header).toContainText('v2/');
    await expect(page.getByText('当前版本没有阻塞问题')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('pre').filter({ hasText: 'bundle-inventory' })).toBeVisible();
    await expect(checks).toContainText('PASS');
    await expect(checks).not.toContainText('FAIL');
  });

  await test.step('submit → pending-approval,激活实体页两步确认 approve', async () => {
    await page.locator('button[data-action="submit"]').click();
    const header = page.getByRole('main').locator('header').first();
    await expect(header).toContainText('pending-approval', { timeout: 15_000 });
    await expect(page.getByText('Human-only decision')).toBeVisible();

    // 反向断言:approve 之前,新 app/新 flow 只存在于提案里,尚未出生
    const draftRel = new URL(page.url()).searchParams.get('rel')!;
    const draftId = draftRel.slice('draft:'.length);
    expect(await installedApplicationNames(page)).not.toContain(bundleName);
    expect(await sitemapSurfaceRels(page, 'business')).not.toContain(flowEntryRel);

    // 激活实体页(canonical rel):human-only 决策动作区
    await page.goto(
      `/meta/entity?rel=${encodeURIComponent(`meta/activation:draft-${draftId}`)}&scope=${LENS}`,
    );
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('heading', { name: `激活 draft-${draftId}`, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: '人类责任点' })).toBeVisible();

    // requires-confirmation=high:先请求,再确认执行
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已请求' })).toBeVisible();
    await page.getByRole('button', { name: '确认并执行Approve' }).click();
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });
    // 决策终态:激活实体不再声明 approve/reject
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  });

  await test.step('出生完成:applications 集合含新 app,sitemap 含新 flow 入口', async () => {
    await page.goto(`/meta/entity?rel=meta%2Fapplications&scope=${LENS}`);
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator('a[data-nav="meta:collection-member"]', { hasText: appTitle }),
    ).toBeVisible({ timeout: 15_000 });
    expect(await installedApplicationNames(page)).toContain(bundleName);
    expect(await sitemapSurfaceRels(page, 'business')).toContain(flowEntryRel);
    expect(await sitemapSurfaceRels(page, 'meta')).toContain(`meta/application:${bundleName}`);
  });
});
