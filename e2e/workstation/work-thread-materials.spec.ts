/**
 * 工作线材料/固定视图与归档回顾(T56 P4.1 常驻覆盖;G3 浏览器门禁)。
 *
 * - **US06 材料与固定视图**(FR5):经「相关材料」覆盖层的对象选择器添加/
 *   重复添加/移出,membership 与 HTTP 合同一致;pin = 固定视图快捷入口
 *   (本机呈现偏好)与 membership 语义分离:pin-only 单列固定视图区、不入
 *   材料计数;detach 失败(运输层注入 403,非产品改动)不假成功、不清 pin、
 *   拒绝原因可读、零业务事件。
 * - **US04 归档回顾**(FR6):archived 线合同无声明写动作 → 添加/移出控件
 *   不显示;仍有待决责任时责任卡不隐藏、动作可提交;completed 线同理只读;
 *   普通材料卡无验收/决定语义字段(不冒充成果),固定视图取消不依赖合同动作。
 */
import { expect, test, type Page } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

import {
  cleanupNotifyWorkflows,
  createFullThreadFixture,
  execAction,
  memberCard,
  openThreadOverview,
  runId,
  saveShot,
} from './work-thread-fixtures';

async function threadContext(page: Page, threadId: string): Promise<string[]> {
  const response = await page.request.get(`${SCENARIO_BASE}/api/entity?rel=thread%3A${threadId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { properties: { context: string[] } };
  return body.properties.context;
}

test.describe.configure({ mode: 'serial' });

test.describe('work-thread materials', () => {
  test('US06 材料与固定视图:选择器添加/重复禁选/移出与 HTTP 一致;pin-only 不入材料;detach 失败不清 pin', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const thread = runId();
      await execAction(page, 'threads', 'create', {
        commandId: thread,
        goal: '材料与固定视图语义走查',
      });
      await execAction(page, `thread:${thread}`, 'attach', {
        category: 'context',
        rel: 'articles',
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await openThreadOverview(page, thread);
      const materials = page.getByRole('button', { name: /相关材料/ });
      await materials.click();
      const dialog = page.getByTestId('thread-materials-dialog');
      await expect(page.getByTestId('desk-working-set-count')).toHaveText('关联（1）');

      // 添加(comment:c1,community 集合成员)后:覆盖层条目、壳条计数与 HTTP 同源。
      await page.getByTestId('desk-add-material').click();
      await page.getByTestId('desk-selector-pick:comment:c1').click();
      await expect(page.getByTestId('desk-working-set-count')).toHaveText('关联（2）');
      await expect(dialog.locator('[data-desk-entry="comment:c1"]')).toBeVisible();
      expect(await threadContext(page, thread)).toEqual(['articles', 'comment:c1']);
      await expect(materials).toHaveText(/相关材料（2）/, { timeout: 15_000 });

      // 重复添加被拒:选择器保持开启,同候选禁选并标注「已在本线」,不可产生
      // 第二次 attach。
      const pick = page.getByTestId('desk-selector-pick:comment:c1');
      await expect(pick).toBeDisabled();
      await expect(pick).toContainText('已在本线');

      // 两者都有 = 成员且已固定:只列一次,移出与取消固定两个动作并存。
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=comment%3Ac1`);
      await expect(page.locator('[data-surface]').first()).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: '📌 固定视图' }).click();
      await openThreadOverview(page, thread);
      await page.getByRole('button', { name: /相关材料/ }).click();
      const pinnedRow = dialog.locator('[data-desk-entry="comment:c1"]');
      await expect(pinnedRow).toHaveCount(1);
      await expect(dialog.getByTestId('desk-remove:comment:c1')).toBeAttached();
      await expect(dialog.getByTestId('desk-unpin:comment:c1')).toBeAttached();

      // detach 失败注入(运输层,非产品改动):成员保留、pin 不被顺手清除、
      // 拒绝原因可读、零业务事件。
      await page.route('**/api/exec', async (route) => {
        const body = route.request().postDataJSON() as { action?: string };
        if (body.action === 'detach') {
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
              layer: 'guard',
              reason: 'guard 不满足: thread-owner=false(注入)',
            }),
          });
          return;
        }
        await route.continue();
      });
      await dialog.getByTestId('desk-remove:comment:c1').click();
      await expect(page.getByTestId('desk-failure')).toContainText(
        'guard 不满足: thread-owner=false',
      );
      await expect(dialog.locator('[data-desk-entry="comment:c1"]')).toHaveCount(1);
      await expect(dialog.getByTestId('desk-unpin:comment:c1')).toBeAttached();
      expect(await threadContext(page, thread)).toEqual(['articles', 'comment:c1']);
      await page.unroute('**/api/exec');

      // 解除注入后移出成功:comment:c1 只剩固定视图偏好 → pin-only 单列固定视图区,
      // 明确不冒充材料(计数只算成员);HTTP references.context 不含 pin-only。
      await dialog.getByTestId('desk-remove:comment:c1').click();
      await expect(page.getByTestId('desk-working-set-count')).toHaveText('关联（1）');
      await expect(dialog.locator('[data-desk-entry="comment:c1"]')).toHaveCount(0);
      const pinOnly = dialog.locator('[data-pinned-entry="comment:c1"]');
      await expect(pinOnly).toBeVisible();
      await expect(dialog.getByTestId('desk-pinned')).toContainText('固定视图');
      expect(await threadContext(page, thread)).toEqual(['articles']);
      await saveShot(page, 'p4-us06-materials-pin');
    });
  });

  test('US04 归档回顾:archived/completed 线写控件不显示,待决责任不隐藏,普通材料不冒充成果', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await cleanupNotifyWorkflows();
    await withFreshServer(async () => {
      const fixture = await createFullThreadFixture(page, runId());
      await execAction(page, `thread:${fixture.thread}`, 'archive');

      await page.setViewportSize({ width: 1440, height: 900 });
      await openThreadOverview(page, fixture.thread);
      const main = page.locator('main');
      await expect(main).toContainText('已归档');

      // 归档线:添加/移出写控件不显示(写不可提交路径存在即失败)。
      await page.getByRole('button', { name: /相关材料/ }).click();
      const dialog = page.getByTestId('thread-materials-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('desk-add-material')).toHaveCount(0);
      await expect(dialog.getByTestId('desk-remove:articles')).toHaveCount(0);

      // 仍有待决责任时不隐藏:待决责任卡动作仍在(archived 不裁剪责任呈现)。
      const duty = memberCard(page, fixture.pending);
      await expect(duty).toBeVisible();
      await expect(duty).toHaveAttribute('data-word', 'member-card');
      await expect(duty.getByRole('button', { name: '批准' })).toBeVisible();

      // 普通材料不冒充成果:材料卡无验收/决定语义字段(决定面板与回执只属责任卡)。
      const material = memberCard(page, 'articles');
      await expect(material).toBeVisible();
      await expect(material).toHaveAttribute('data-word', 'member-row');
      await expect(material.locator('[data-testid="decision-info"]')).toHaveCount(0);
      await expect(material.locator('[data-decision-row="receipt"]')).toHaveCount(0);

      // 固定视图取消是本机呈现偏好,不依赖合同动作,归档线照常可取消。
      await page.evaluate(
        ([key]) => {
          window.localStorage.setItem(key, JSON.stringify(['post:first-post']));
        },
        [`ui4a.thread.pins.${fixture.thread}`],
      );
      await page.reload();
      await page.getByRole('button', { name: /相关材料/ }).click();
      await expect(page.getByTestId('desk-pinned')).toBeVisible();
      await expect(page.getByTestId('desk-unpin:post:first-post')).toBeAttached();
      await saveShot(page, 'p4-us04-archived-line');

      // completed 线:状态任务语「已完成」;写控件跟随合同声明(completed
      // 仍声明 attach/detach,控件可用 ≠ archived 的零动作合同)。
      const done = runId();
      await execAction(page, 'threads', 'create', {
        commandId: done,
        goal: '已完成线的只读回顾',
      });
      await execAction(page, `thread:${done}`, 'attach', { category: 'context', rel: 'articles' });
      await execAction(page, `thread:${done}`, 'complete');
      await openThreadOverview(page, done);
      await expect(page.locator('main')).toContainText('已完成');
      await page.getByRole('button', { name: /相关材料/ }).click();
      await expect(page.getByTestId('desk-add-material')).toBeVisible();
    });
    await cleanupNotifyWorkflows();
  });
});
