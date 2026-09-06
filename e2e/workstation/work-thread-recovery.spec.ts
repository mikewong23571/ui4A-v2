/**
 * 工作线安全与诚实恢复(T56 P4.1 常驻覆盖;G3 浏览器门禁;US10/FR9)。
 *
 * - **空线(Fixture C)**:无材料/active/approval/event,创建原文通过只读来源可追溯;
 *   不出现裸来源输入字段;空态引导走声明 emptyMeaning,
 *   禁止「无进行中工作」类全称否定(D78 决定 3)。
 * - **不可读对象**:focus 不可解析 → 结构化中性空态「内容不存在或不可见」
 *   +「返回首页」恢复出口;线仍可读时材料计数不被连坐。
 * - **跨 principal(D51 口径)**:他人线在 HTTP 读层是 403 结构化 denied
 *   (scope_insufficient),在呈现层按存在性隐藏表达(404 口径):零名称/
 *   计数泄漏、材料计数不伪称 0、恢复出口可达。经 x-ui4a-principal 头在独立
 *   browser context 打开(local 自报身份域,与 t33 a/b/e 景同机)。
 */
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

import { openThreadOverview, runId, saveShot } from './work-thread-fixtures';

test.describe.configure({ mode: 'serial' });

test.describe('work-thread recovery', () => {
  test('US10 空线与不可读对象:空态引导非说明书,创建原文可追溯,缺失对象中性空态有恢复出口', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const thread = runId();
      await page.request.post(`${SCENARIO_BASE}/api/exec`, {
        data: {
          rel: 'threads',
          action: 'create',
          params: { commandId: thread, goal: '空线起步走查' },
          actor: 'human',
          principal: 'local-user',
          channel: 'e2e',
        },
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await openThreadOverview(page, thread);
      const main = page.locator('main');
      // 目标为主内容;无材料/责任成员;创建原文另有只读来源,不重复状态。
      await expect(main.getByText('空线起步走查')).toBeVisible();
      await expect(page.locator('[data-word="member-card"], [data-word="member-row"]')).toHaveCount(
        0,
      );
      await expect(main).not.toContainText('目标来源');
      await expect(main).toContainText('进行中');
      await expect(main).not.toContainText('停在「进行中」');
      const source = await page.request.get(
        `${SCENARIO_BASE}/api/entity?rel=thread-input:${thread}`,
      );
      expect(source.ok()).toBe(true);
      expect(await source.json()).toMatchObject({
        actions: [],
        properties: { text: '空线起步走查' },
      });
      // 「被裁剪 vs 真空」不可辨 → 禁止全称否定文案(D78 决定 3)。
      await expect(main).not.toContainText('无进行中工作');
      await expect(main).not.toContainText('没有任何');
      await saveShot(page, 'p4-us10-empty-line');

      // 不可读对象(缺失 focus):中性空态 + 恢复出口;线仍可读 → 材料计数如实(0)。
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=post%3Aghost`);
      const unavailable = page.getByTestId('canvas-focus-unavailable');
      await expect(unavailable).toBeVisible({ timeout: 30_000 });
      await expect(unavailable).toContainText('内容不存在或不可见');
      await expect(unavailable.getByRole('link', { name: '返回首页' })).toBeVisible();
      await expect(page.getByRole('button', { name: '相关材料（0）' })).toBeVisible();
      await page.getByRole('button', { name: '页面工具' }).click();
      await expect(page.getByRole('button', { name: '重新载入' })).toBeVisible();
    });
  });

  test('US10 跨 principal:HTTP 读层 403 结构化 denied,呈现层存在性隐藏,零泄漏且有恢复出口', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const secret = runId();
      const secretGoal = '跨 principal 隐藏性走查';
      // 他人(user:mallory)的线,带一条 context(若泄漏即计数/名称可见)。
      await page.request.post(`${SCENARIO_BASE}/api/exec`, {
        data: {
          rel: 'threads',
          action: 'create',
          params: { commandId: secret, goal: secretGoal },
          actor: 'human',
          principal: 'user:mallory',
          channel: 'e2e',
        },
      });
      await page.request.post(`${SCENARIO_BASE}/api/exec`, {
        data: {
          rel: `thread:${secret}`,
          action: 'attach',
          params: { category: 'context', rel: 'articles' },
          actor: 'human',
          principal: 'user:mallory',
          channel: 'e2e',
        },
      });

      // HTTP 层:owner 读 200;local-user 读 → 403 结构化 denied(D51 失败语义)。
      const own = await page.request.get(`${SCENARIO_BASE}/api/entity?rel=thread%3A${secret}`, {
        headers: { 'x-ui4a-principal': 'user:mallory' },
      });
      expect(own.status()).toBe(200);
      const other = await page.request.get(`${SCENARIO_BASE}/api/entity?rel=thread%3A${secret}`);
      expect(other.status()).toBe(403);
      const deniedBody = (await other.json()) as { error?: { code?: string } | string };
      const deniedCode =
        typeof deniedBody.error === 'object' ? deniedBody.error?.code : deniedBody.error;
      expect(String(deniedCode)).toContain('scope_insufficient');

      // 浏览器层:独立 context(自报 user:casey,非 owner)打开他人线 →
      // 存在性隐藏,零名称泄漏、材料计数不伪称 0、恢复出口可达。
      const otherContext = await browser.newContext({
        extraHTTPHeaders: { 'x-ui4a-principal': 'user:casey' },
      });
      const caseyPage = await otherContext.newPage();
      await caseyPage.setViewportSize({ width: 1440, height: 900 });
      await caseyPage.goto(`${SCENARIO_BASE}/canvas?thread=${secret}&focus=thread%3A${secret}`);
      const main = caseyPage.locator('main');
      await expect(
        main.getByTestId('canvas-focus-unavailable').or(main.getByTestId('canvas-errors')),
      ).toBeVisible({ timeout: 30_000 });
      await expect(main).not.toContainText(secretGoal);
      await expect(
        caseyPage.locator('[data-word="member-card"], [data-word="member-row"]'),
      ).toHaveCount(0);
      await expect(caseyPage.getByRole('button', { name: '相关材料', exact: true })).toBeVisible();
      await saveShot(caseyPage, 'p4-us10-cross-principal-hidden');
      await otherContext.close();

      // owner 自己照常可读(零可见授权事件;不被他人访问影响):mallory
      // context 打开自己的线,surface 正常、材料计数如实。
      const ownerContext = await browser.newContext({
        extraHTTPHeaders: { 'x-ui4a-principal': 'user:mallory' },
      });
      const ownerPage = await ownerContext.newPage();
      await ownerPage.setViewportSize({ width: 1440, height: 900 });
      await openThreadOverview(ownerPage, secret);
      await expect(ownerPage.locator('main').getByText(secretGoal)).toBeVisible();
      await expect(ownerPage.getByRole('button', { name: '相关材料（1）' })).toBeVisible();
      await ownerContext.close();
    });
  });
});
