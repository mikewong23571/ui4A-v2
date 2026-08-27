import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => test.setTimeout(180_000));

test('canonical flow bridges preserve the declared work line and keep alias failures honest', async ({
  page,
}) => {
  await withFreshServer(async () => {
    await page.goto(
      `${SCENARIO_BASE}/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1`,
    );
    const situation = page.getByRole('region', { name: '声明的处境' });
    await expect(situation.getByTestId('situation-site')).toHaveText('workstation');
    await expect(situation.getByTestId('situation-focus')).toHaveText('flow:article-drafting');
    const toMeta = situation.getByRole('link', { name: '在 meta 中编辑此定义' });
    await expect(toMeta).toHaveAttribute('data-nav', 'situation:cross-site-flow');
    await expect(toMeta).toHaveAttribute(
      'href',
      '/meta/flow/article-drafting?scope=publishing&thread=release-1',
    );

    await toMeta.click();
    await expect(page).toHaveURL(
      `${SCENARIO_BASE}/meta/flow/article-drafting?scope=publishing&thread=release-1`,
    );
    await expect(situation.getByTestId('situation-site')).toHaveText('meta');
    await expect(situation.getByTestId('situation-scope')).toHaveText('publishing');
    await expect(situation.getByTestId('situation-thread')).toHaveText('release-1');
    await expect(situation.getByTestId('situation-focus')).toHaveText('meta/flow:article-drafting');
    await expect(page.locator('section[aria-label="拓扑"]')).toBeVisible();

    const toWorkstation = situation.getByRole('link', { name: '查看活实例' });
    await expect(toWorkstation).toHaveAttribute(
      'href',
      '/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1',
    );
    await toWorkstation.click();
    await expect(page).toHaveURL(
      `${SCENARIO_BASE}/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1`,
    );
    await expect(page.locator('[data-surface]')).toHaveCount(1);
    await expect(page.locator('[data-testid="canvas-errors"]')).toHaveCount(0);
    await expect(situation.getByTestId('situation-site')).toHaveText('workstation');
    await expect(situation.getByTestId('situation-thread')).toHaveText('release-1');

    await page.goto(`${SCENARIO_BASE}/canvas?focus=post%3Apost-welcome&scope=publishing`);
    await expect(situation.getByRole('link', { name: /meta 中编辑|查看活实例/ })).toHaveCount(0);

    await page.goto(`${SCENARIO_BASE}/meta/flow/ghost?scope=publishing&thread=release-1`);
    await expect(page.getByText('定义 "meta/flow:ghost" 不存在(404)。')).toBeVisible();
    await situation.getByRole('link', { name: '查看活实例' }).click();
    await expect(page).toHaveURL(
      `${SCENARIO_BASE}/canvas?focus=flow%3Aghost&scope=publishing&thread=release-1`,
    );
    await expect(page.locator('[data-surface]')).toHaveCount(0);
    // T32 Q5:首屏固定人话,机制细节(实体缺失 message)进 why 抽屉。
    await expect(page.locator('[data-testid="canvas-errors"]')).toContainText(
      '部分内容暂时无法显示',
    );
    await page.getByRole('button', { name: '为什么这样展示' }).click();
    await expect(page.locator('[data-testid="canvas-why-diagnostics"]')).toContainText(
      '实体 "flow:ghost" 不存在',
    );
  });
});
