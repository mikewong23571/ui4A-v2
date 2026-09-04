/**
 * T51 — 新生应用可见性恢复链路浏览器门(独立 spec,不依赖 t48 golden story)。
 *
 * 1. genesis approve 后,批准者本人在同一激活实体页看到 D70.1 披露回执
 *    (local 自报域 → immediately-visible 分支 + 前往应用目录入口);
 * 2. 「应用」目录出现新应用(批准即闭环,US1.3);
 * 3. /session「我的授权」面板渲染 local 投影(自报身份、无刷新授权动作,US2);
 * 4. 应用目录措辞不再宣称全集(US4)。
 *
 * 身份:local demo 自报域;relogin/IdP 两分支由路由合同测试锚定
 * (meta/exec route.activation-disclosure.test.ts),浏览器门不重复。
 */
import { expect, test, type Page } from '@playwright/test';

const LENS = 'publishing';

function bundlePayloadJson(name: string, title: string): string {
  return JSON.stringify(
    {
      schema: 'https://ui4a.dev/application-bundle/v1',
      bundle: { name, version: 1 },
      applications: [{ name, title, intent: 'T51 visibility recovery browser gate' }],
      capabilities: [],
      flows: [
        {
          name: `${name}-entry`,
          title: 'Recovery entry',
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

async function gotoMetaReady(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
}

test('approve 即披露:批准者在同一页面看到可见性回执并直达新应用', async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = Math.random().toString(36).slice(2, 8);
  const bundleName = `t51-recovery-${suffix}`;
  const appTitle = `T51 Recovery ${suffix}`;

  await test.step('起草并修正为 ready,提交 pending-approval', async () => {
    await gotoMetaReady(page, `/meta?scope=${LENS}`);
    await page.getByRole('link', { name: '打开 受治理草稿' }).click();
    await expect(page).toHaveURL(new RegExp(`rel=meta%2Fdrafts.*scope=${LENS}`));
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Create Draft' }).click();
    const form = page.locator('div[data-action="create"]');
    await expect(form).toBeVisible();
    await form
      .getByRole('combobox', { name: /kind/ })
      .selectOption({ label: 'application-bundle' });
    await form.getByRole('textbox', { name: /target/ }).fill(bundleName);
    await form.getByRole('textbox', { name: /payload/ }).fill(bundlePayloadJson(bundleName, appTitle));
    await form.locator('button[type="submit"]').click();
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });
    const member = page.locator('a[data-nav="meta:collection-member"]', { hasText: bundleName });
    await expect(member).toBeVisible({ timeout: 15_000 });
    await member.click();
    await expect(page).toHaveURL(/rel=draft%3A/);
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });

    await page.locator('button[data-action="submit"]').click();
    await expect(
      page.getByRole('main').locator('header').first(),
    ).toContainText('pending-approval', { timeout: 15_000 });
  });

  let draftId = '';
  await test.step('激活实体页 approve:同一页面出现披露回执(US1)', async () => {
    const draftRel = new URL(page.url()).searchParams.get('rel')!;
    draftId = draftRel.slice('draft:'.length);
    await gotoMetaReady(
      page,
      `/meta/entity?rel=${encodeURIComponent(`meta/activation:draft-${draftId}`)}&scope=${LENS}`,
    );
    await expect(page.getByRole('region', { name: '人类责任点' })).toBeVisible();

    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已请求' })).toBeVisible();
    await page.getByRole('button', { name: '确认并执行Approve' }).click();
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });

    // D70.1 披露回执:local 自报域授予集合=已装全集 → immediately-visible。
    const disclosure = page.getByTestId('activation-disclosure');
    await expect(disclosure).toBeVisible({ timeout: 15_000 });
    await expect(disclosure).toContainText('安装结果与你的会话授权');
    await expect(disclosure).toContainText(bundleName);
    await expect(disclosure).toContainText('已对当前会话可见');
    await expect(
      disclosure.getByRole('link', { name: '前往应用目录' }),
    ).toHaveAttribute('href', '/applications');
  });

  await test.step('应用目录:新应用可见,措辞诚实(US1.3/US4)', async () => {
    await page.goto('/applications');
    await expect(page.getByRole('heading', { name: '应用', level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('仅显示当前会话已授权的应用')).toBeVisible();
    const card = page.locator('a', { hasText: appTitle }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
  });

  await test.step('「我的授权」面板:local 投影可自查,无刷新动作(US2)', async () => {
    await page.goto('/session');
    await expect(page.getByRole('heading', { name: '我的授权', level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('本地演示(自报身份)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('local-user')).toBeVisible();
    // local 无登录通道:不渲染刷新授权(D70.4 限定 credential 模式)
    await expect(page.getByRole('link', { name: '刷新授权' })).toHaveCount(0);
  });
});
