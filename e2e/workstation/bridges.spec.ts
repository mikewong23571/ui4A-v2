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
    await expect(situation.getByTestId('situation-focus')).toHaveText('文章发布向导');
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
    await expect(situation.getByTestId('situation-scope')).toHaveText('内容发布');
    await expect(situation.getByTestId('situation-thread')).toHaveText('无法读取');
    await expect(situation.getByTestId('situation-focus')).toHaveText('文章发布向导');
    // URL 与 situation 会先于 canonical entity fetch 完成更新；等待 shell 明确提交
    // 合同内容，再验证声明标题与拓扑，避免把过渡期空 main 当成缺少拓扑。
    const canonicalFlow = page.getByTestId('meta-content-ready');
    await expect(canonicalFlow).toBeVisible({ timeout: 30_000 });
    await expect(
      canonicalFlow.getByRole('heading', { level: 1, name: '文章发布向导' }),
    ).toBeVisible();
    await expect(canonicalFlow.locator('section[aria-label="拓扑"]')).toBeVisible();

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
    await expect(situation.getByTestId('situation-thread')).toHaveText('无法读取');

    await page.goto(`${SCENARIO_BASE}/canvas?focus=post%3Apost-welcome&scope=publishing`);
    await situation.getByRole('button', { name: '在哪' }).click();
    await expect(situation.getByRole('link', { name: /meta 中编辑|查看活实例/ })).toHaveCount(0);

    await page.goto(
      `${SCENARIO_BASE}/meta/entity?rel=meta%2Fflow%3Aghost&scope=publishing&thread=release-1`,
    );
    // T39 canonical shell 对不存在与当前授权视角不可见使用同一中性恢复面；
    // API 仍必须诚实返回 404，UI 不泄漏存在性细节。
    const missingMeta = await page.request.get(
      `${SCENARIO_BASE}/_meta/api/entity?rel=${encodeURIComponent('meta/flow:ghost')}`,
    );
    expect(missingMeta.status()).toBe(404);
    const missingAlert = page.getByRole('alert').filter({
      has: page.getByRole('heading', { name: '合同不存在或当前视角下定位失败' }),
    });
    await expect(missingAlert).toBeVisible();
    await expect(missingAlert).toContainText('跨 principal 资源仍按不存在处理');
    await situation.getByRole('button', { name: '在哪' }).click();
    await situation.getByRole('link', { name: '查看活实例' }).click();
    await expect(page).toHaveURL(
      `${SCENARIO_BASE}/canvas?focus=flow%3Aghost&scope=publishing&thread=release-1`,
    );
    const missingFlow = await page.request.get(
      `${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent('flow:ghost')}`,
    );
    expect(missingFlow.status()).toBe(404);
    await expect(page.locator('[data-surface]')).toHaveCount(0);
    // Thread desk 的独立投影可能先后呈现不可读或空工作集，不用于判断 alias；
    // 404 API + 零 surface 承担缺失语义，Canvas 仍提供中性恢复入口。
    await expect(page.getByRole('heading', { level: 1, name: '共同注视' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新载入' })).toHaveAttribute(
      'data-nav',
      'local:canvas-reload',
    );
  });
});
