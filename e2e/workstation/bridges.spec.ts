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
    await expect(situation.getByTestId('situation-site')).toHaveText('工作站');
    await expect(situation.getByTestId('situation-focus')).toHaveText('注视 flow:article-drafting');
    // T35 D-7:桥接链接收进「在哪」弹层——先开弹层再断言/点击。
    await situation.getByRole('button', { name: '在哪' }).click();
    const toMeta = situation.getByRole('link', { name: '在 meta 中编辑此定义' });
    await expect(toMeta).toHaveAttribute('data-nav', 'situation:cross-site-flow');
    await expect(toMeta).toHaveAttribute(
      'href',
      '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting&scope=publishing&thread=release-1',
    );

    await toMeta.click();
    await expect(page).toHaveURL(
      `${SCENARIO_BASE}/meta/entity?rel=meta%2Fflow%3Aarticle-drafting&scope=publishing&thread=release-1`,
    );
    // 弹层开合状态跨导航保持——收起以免条上芯片与弹层 dd 双命中。
    await situation.getByRole('button', { name: '在哪' }).click();
    await expect(situation.getByTestId('situation-site')).toHaveText('定义站');
    await expect(situation.getByTestId('situation-scope')).toHaveText('publishing');
    await expect(situation.getByTestId('situation-thread')).toHaveText('线 release-1');
    await expect(situation.getByTestId('situation-focus')).toHaveText(
      '注视 meta/flow:article-drafting',
    );
    await expect(page.locator('section[aria-label="拓扑"]')).toBeVisible();

    await situation.getByRole('button', { name: '在哪' }).click();
    const toWorkstation = situation.getByRole('link', { name: '查看活实例' });
    await expect(toWorkstation).toHaveAttribute(
      'href',
      '/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1',
    );
    await toWorkstation.click();
    await expect(page).toHaveURL(
      `${SCENARIO_BASE}/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1`,
    );
    await situation.getByRole('button', { name: '在哪' }).click();
    // Cold dev-compile grace window(与 t33-a 冷启动兜底同口径):非减窗不断言。
    await expect(page.locator('[data-surface]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator('[data-testid="canvas-errors"]')).toHaveCount(0);
    await expect(situation.getByTestId('situation-site')).toHaveText('工作站');
    await expect(situation.getByTestId('situation-thread')).toHaveText('线 release-1');

    await page.goto(`${SCENARIO_BASE}/canvas?focus=post%3Apost-welcome&scope=publishing`);
    await situation.getByRole('button', { name: '在哪' }).click();
    await expect(situation.getByRole('link', { name: /meta 中编辑|查看活实例/ })).toHaveCount(0);

    await page.goto(
      `${SCENARIO_BASE}/meta/entity?rel=meta%2Fflow%3Aghost&scope=publishing&thread=release-1`,
    );
    await expect(page.getByText('定义 "meta/flow:ghost" 不存在(404)。')).toBeVisible();
    await situation.getByRole('button', { name: '在哪' }).click();
    await situation.getByRole('link', { name: '查看活实例' }).click();
    await expect(page).toHaveURL(
      `${SCENARIO_BASE}/canvas?focus=flow%3Aghost&scope=publishing&thread=release-1`,
    );
    await expect(page.locator('[data-surface]')).toHaveCount(0);
    // T35 F-02:主 focus 不可解析走结构化空态(中性措辞 + 恢复出口);
    // 机制细节(实体缺失 message)进 why 抽屉。
    await expect(page.getByTestId('canvas-focus-unavailable')).toContainText('内容不存在或不可见');
    await page.getByRole('button', { name: '为什么这样展示' }).click();
    await expect(page.locator('[data-testid="canvas-why-diagnostics"]')).toContainText(
      '实体 "flow:ghost" 不存在',
    );
  });
});
