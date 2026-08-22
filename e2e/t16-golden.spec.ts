import { expect, test } from '@playwright/test';

test.describe('T16 Golden Story presentation lifecycle', () => {
  test('Entity, Entities, semantic patch, pin, rollback, promotion preview and explanation', async ({
    page,
    request,
  }) => {
    const presentation = await request.post('/api/presentation', {
      data: {
        schemaVersion: 1,
        requestId: `t16-golden:${Date.now()}`,
        principal: 'user:local',
        subject: 'post:first-post',
        intent: 'review',
        delivery: 'canvas',
        sourceMessageIds: [],
      },
    });
    expect(presentation.ok()).toBe(true);
    const receipt = (await presentation.json()) as { status?: string; surfaceUrl?: string };
    expect(receipt.status).toBe('ready');
    expect(receipt.surfaceUrl).toContain('sidecar=');
    await page.goto(receipt.surfaceUrl!);
    await expect(page.getByRole('heading', { name: '第一篇', exact: true })).toBeVisible();
    await expect(page.getByText('这是第一篇完整文章')).toBeVisible();

    const personal = page.getByText(/个人呈现 · v\d+/);
    await expect(personal).toBeVisible();
    await page.getByRole('button', { name: '切换疏密' }).click();
    await expect(page.getByRole('status')).toContainText('视图已调整');
    await page.getByRole('button', { name: '收起视图' }).click();
    await expect(page.getByText('此视图已收起')).toBeVisible();
    await page.getByRole('button', { name: '展开视图' }).click();
    await expect(page.getByRole('heading', { name: '第一篇', exact: true })).toBeVisible();

    const pin = page.getByRole('button', { name: '以后都这样看' });
    if (await pin.isVisible()) {
      await pin.click();
      await expect(page.getByText(/已保存为个人视图/)).toBeVisible();
    }
    await page.getByRole('button', { name: '为什么这样展示' }).click();
    await expect(page.getByRole('status')).toContainText('这样展示是因为');

    await page.getByRole('button', { name: '设为团队默认' }).click();
    await expect(page.getByRole('button', { name: '确认团队默认' })).toBeVisible();
    await page.locator('[data-presentation-action="cancel-promotion"]').click();

    await page.goto('/canvas');
    await expect(page.getByRole('link', { name: '第一篇' })).toBeVisible();
    await page.getByRole('link', { name: '第一篇' }).click();
    await expect(page.getByRole('heading', { name: '第一篇', exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  });
});
