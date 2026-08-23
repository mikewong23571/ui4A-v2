import { expect, test } from '@playwright/test';

test('T18 renderer discovers coding capability and exposes only human Flow actions', async ({
  page,
  request,
}) => {
  const sitemap = await request.get('/.well-known/ui4a.json');
  expect(sitemap.ok()).toBe(true);
  const contract = (await sitemap.json()) as {
    applications: { name: string }[];
    capabilities: { name: string; executor?: { class: string } }[];
  };
  expect(contract.applications.map((application) => application.name)).toContain('development');
  expect(contract.capabilities).toContainEqual(
    expect.objectContaining({
      name: 'coding.execute',
      executor: expect.objectContaining({ class: 'coding-agent' }),
    }),
  );

  const entity = await request.get('/api/entity?rel=software-change:main');
  expect(entity.ok()).toBe(true);
  const body = (await entity.json()) as { actions: { name: string }[] };
  expect(body.actions.map((action) => action.name)).toEqual(['start-implementation']);
  expect(body.actions.map((action) => action.name)).not.toContain('implementation-succeeded');

  await page.goto('/entity?rel=software-change%3Amain');
  await expect(page.getByText('待实施', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始编码实施', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});
