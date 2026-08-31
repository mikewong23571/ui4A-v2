import { expect, test } from '@playwright/test';

const applications = Array.from({ length: 30 }, (_, index) => ({
  name: `future-${index}`,
  title: `应用 ${index + 1}`,
  intent: `未来能力说明 ${index + 1}`,
}));

for (const width of [390, 640, 768, 1512]) {
  test(`home caps at nine; directory grows independently at ${width}px`, async ({
    page,
  }, testInfo) => {
    let count = 7;
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/presence', (route) => route.fulfill({ json: {} }));
    await page.route('**/.well-known/ui4a.json', async (route) => {
      const original = await route.fetch();
      await route.fulfill({
        json: { ...(await original.json()), applications: applications.slice(0, count) },
      });
    });
    await page.goto('/?scope=old&thread=release-1&returnTo=%2Fthreads');
    const shelf = page.getByTestId('application-entry-strip');
    const entries = shelf.locator('a[data-nav^="local:app-entry:"]');
    await expect(entries).toHaveCount(7);
    const originalHeight = (await shelf.boundingBox())!.height;
    count = 30;
    await page.reload();
    await expect(entries).toHaveCount(9);
    await expect(entries).toHaveText(applications.slice(0, 9).map((app) => app.title));
    await expect(shelf).toContainText('30 个');
    expect((await shelf.boundingBox())!.height).toBe(originalHeight);
    const headerBox = (await page.getByRole('banner').boundingBox())!;
    const navBox = (await page.getByRole('navigation', { name: '全站导航' }).boundingBox())!;
    expect(navBox.y).toBeGreaterThanOrEqual(headerBox.y);
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });

    await shelf.getByRole('link', { name: '全部应用' }).press('Enter');
    await expect(page).toHaveURL(/\/applications\?scope=old&thread=release-1&returnTo=%2Fthreads/);
    const directory = page.getByRole('list', { name: '应用目录' });
    await expect(directory.getByRole('link')).toHaveCount(30);
    await expect(
      page
        .getByRole('navigation', { name: '全站导航' })
        .getByRole('link', { name: '应用', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await page.getByRole('searchbox', { name: '搜索应用' }).fill('future-29');
    await expect(directory.getByRole('link')).toHaveCount(1);
    await expect(directory).toContainText('未来能力说明 30');
    await expect(directory.getByRole('link')).toHaveAttribute(
      'href',
      '/canvas?scope=future-29&focus=workspace%3Aapp%3Afuture-29&thread=release-1&returnTo=%2Fthreads',
    );
    await page.getByRole('searchbox', { name: '搜索应用' }).fill('无匹配词');
    await expect(page.getByText('没有匹配的应用。')).toBeVisible();
    await page.getByRole('button', { name: '清除搜索' }).click();
    await expect(directory.getByRole('link')).toHaveCount(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`directory-${width}.png`) });
  });
}

test('real directory titles and landing match the authorized HTTP contract', async ({ page }) => {
  const sitemap = await (await page.request.get('/.well-known/ui4a.json')).json();
  const business = sitemap.applications.filter(
    (app: { presentation?: { traits?: string[] } }) =>
      !app.presentation?.traits?.includes('system-fallback'),
  );
  await page.goto('/applications');
  const directory = page.getByRole('list', { name: '应用目录' });
  await expect(directory.getByRole('link')).toHaveCount(business.length);
  for (const app of business) {
    await expect(directory.locator(`a[data-nav="local:app-entry:${app.name}"]`)).toContainText(
      app.title,
    );
    await expect(directory.locator(`a[data-nav="local:app-entry:${app.name}"]`)).toContainText(
      app.intent,
    );
  }
  const app = business[0];
  expect(app).toBeDefined();
  await directory.locator(`a[data-nav="local:app-entry:${app.name}"]`).click();
  await expect(page).toHaveURL(
    new RegExp(`/canvas\\?scope=${app.name}&focus=workspace%3Aapp%3A${app.name}`),
  );
  await expect(page.locator('[data-surface]')).toBeVisible({ timeout: 30_000 });
});
