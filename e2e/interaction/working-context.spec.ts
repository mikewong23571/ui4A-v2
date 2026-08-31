import { expect, test, type APIRequestContext } from '@playwright/test';
import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

async function exec(
  request: APIRequestContext,
  rel: string,
  action: string,
  params: Record<string, unknown>,
) {
  const response = await request.post(`${SCENARIO_BASE}/api/exec`, {
    data: { rel, action, params, actor: 'human', principal: 'local-user', channel: 'e2e' },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test('working context stays legible and switches the actual workline on desktop and mobile', async ({
  page,
  request,
}, info) => {
  test.setTimeout(180_000);
  await withFreshServer(
    async () => {
      for (const [id, goal] of [
        ['shared-context', '核对公告与评论'],
        ['next-context', '下一件事'],
      ] as const) {
        await exec(request, 'threads', 'create', { id, goal, goalSource: `message:${id}` });
      }
      for (const rel of ['post:post-welcome', 'comments']) {
        await exec(request, 'thread:shared-context', 'attach', { category: 'context', rel });
      }
      for (const width of [1512, 390]) {
        await page.setViewportSize({ width, height: 950 });
        await page.goto(
          `${SCENARIO_BASE}/entity?rel=thread%3Ashared-context&thread=shared-context&scope=publishing`,
        );
        const bar = page.getByTestId('situation-bar');
        await expect(bar.getByTestId('situation-scope')).toHaveText('内容发布');
        await expect(bar.getByTestId('situation-thread')).toHaveText('核对公告与评论');
        await bar.getByRole('button', { name: '在哪', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '当前在哪' });
        await expect(dialog.getByRole('combobox', { name: '应用', exact: true })).toBeVisible();
        await expect(dialog.getByRole('option', { name: '内容发布', exact: true })).toHaveCount(1);
        await expect(
          dialog.getByRole('navigation', { name: '关联对象' }).getByRole('link'),
        ).toHaveCount(2);
        await expect(dialog.getByRole('navigation', { name: '关联对象' })).toContainText(
          '欢迎来到 UI4A',
        );
        await expect(dialog.getByRole('navigation', { name: '关联对象' })).toContainText('评论');
        await expect(dialog).not.toContainText('scope');
        expect(await dialog.locator('p').count()).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`context-${width}.png`) });
        await dialog.locator('a[data-nav="situation:switch-thread:next-context"]').click();
        await expect(page).toHaveURL(/rel=thread%3Anext-context.*thread=next-context/);
        await expect(bar.locator('span[data-testid="situation-thread"]')).toHaveText('下一件事');
        await expect(dialog.getByTestId('situation-focus')).toHaveText('下一件事');
        await expect(bar.locator('span[data-testid="situation-focus"]')).toHaveCount(0);
      }
    },
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});
