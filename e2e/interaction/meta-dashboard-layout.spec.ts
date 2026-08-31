import { expect, test } from '@playwright/test';

const surfaces = [
  { rel: 'meta/decisions', title: '待决定', groupRole: 'responsibility' },
  { rel: 'meta/drafts', title: '受治理草稿', groupRole: 'candidate' },
  { rel: 'meta/flows', title: '流程定义', groupRole: 'definition' },
  { rel: 'meta/applications', title: '应用定义', groupRole: 'definition' },
  { rel: 'meta/capabilities', title: '能力目录', groupRole: 'definition' },
  { rel: 'meta/future-assets', title: '未来定义资产', groupRole: 'definition' },
  { rel: 'meta/self', title: '定义生命周期', groupRole: 'system' },
];

test.beforeEach(async ({ page }) => {
  // Layout fixtures do not change the development event log or depend on its inventory.
  await page.route('**/api/presence', (route) => route.fulfill({ json: {} }));
  await page.route('**/_meta/.well-known/ui4a.json*', (route) =>
    route.fulfill({
      json: {
        protocolVersion: '1',
        version: 'layout-fixture',
        site: 'meta',
        authorizedScopes: ['governance'],
        authorizationMode: 'credential',
        surfaces: surfaces.map(({ groupRole, ...surface }) => ({
          ...surface,
          collection: surface.rel !== 'meta/self',
          presentation: { version: 1, groupRole, priority: 'normal' },
        })),
      },
    }),
  );
  await page.route('**/_meta/api/entity?*', (route) => {
    const rel = new URL(route.request().url()).searchParams.get('rel');
    return route.fulfill({
      json: {
        class: ['collection'],
        properties: { rel, count: rel === 'meta/decisions' ? 0 : 3 },
        actions: [],
        links: [],
        entities: [],
        'guard-results': [],
      },
    });
  });
});

for (const width of [390, 768, 1512, 1920]) {
  test(`Meta subtitles precede responsive resource grids at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/meta?scope=governance');
    await expect(page.getByTestId('meta-content-ready')).toBeVisible();
    const groups = page.getByRole('main').getByRole('region');
    await expect(groups.getByRole('heading')).toHaveText(['候选与异常', '定义资产', '系统自举']);
    for (const heading of await groups.getByRole('heading').all()) {
      await expect(heading).toHaveCSS('border-bottom-width', '1px');
      await expect(heading).toHaveCSS('border-bottom-style', 'solid');
    }
    const boxes = await groups.evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, bottom } = element.getBoundingClientRect();
        const heading = element.querySelector('h2')!.getBoundingClientRect();
        const firstCard = element
          .querySelector('[data-testid="meta-surface"]')!
          .getBoundingClientRect();
        return {
          x,
          y,
          width,
          bottom,
          headingBottom: heading.bottom,
          cardTop: firstCard.top,
          cardX: firstCard.x,
        };
      }),
    );
    const [candidate, definition, system] = boxes;
    for (const box of boxes) {
      expect(Math.abs(box.width - candidate.width)).toBeLessThanOrEqual(1);
      expect(box.cardTop).toBeGreaterThan(box.headingBottom);
      expect(box.cardX).toBe(box.x);
    }
    expect(definition.x).toBe(candidate.x);
    expect(definition.y).toBeGreaterThan(candidate.bottom);
    expect(system.y).toBeGreaterThan(definition.bottom);
    const cards = await groups.getByTestId('meta-surface').evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    for (const card of cards) {
      // A singleton must not stretch wider than entries in a populated group.
      expect(Math.abs(card.width - cards[0].width)).toBeLessThanOrEqual(1);
      expect(card.height).toBeLessThanOrEqual(88);
    }
    expect(cards[0].height).toBeLessThanOrEqual(64);
    const assets = cards.slice(1, 5);
    if (width >= 1024) {
      for (const [index, asset] of assets.entries()) {
        expect(asset.y).toBe(assets[0].y);
        if (index > 0) expect(asset.x).toBeGreaterThan(assets[index - 1].x);
      }
    } else if (width >= 640) {
      expect(assets[1].y).toBe(assets[0].y);
      expect(assets[2].y).toBeGreaterThan(assets[0].y);
      expect(assets[3].y).toBe(assets[2].y);
    } else {
      for (const [index, asset] of assets.entries()) {
        expect(asset.x).toBe(candidate.x);
        if (index > 0) expect(asset.y).toBeGreaterThan(assets[index - 1].y);
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByRole('link', { name: '打开 未来定义资产' })).toHaveAttribute(
      'href',
      '/meta/entity?rel=meta%2Ffuture-assets&scope=governance',
    );
    await page.screenshot({ path: testInfo.outputPath(`meta-${width}.png`), fullPage: true });
  });
}
