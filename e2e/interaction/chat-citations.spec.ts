import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

function citationSse(): string {
  const frames = [
    {
      type: 'step',
      message: { role: 'assistant', text: 'post:ghost 只是正文诱饵，不是引用。' },
      activity: { op: 'answer' },
    },
    {
      type: 'final',
      payload: {
        sessionId: 'e2e-citations',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'answered',
        summary: 'post:ghost 只是正文诱饵，不是引用。',
        steps: [],
        successes: [],
        sources: [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
      },
    },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => test.setTimeout(180_000));

test('structured citation click focuses the same Canvas entity and preserves only scope/thread', async ({
  page,
}) => {
  await withFreshServer(async () => {
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: citationSse(),
      });
    });
    await page.goto(
      `${SCENARIO_BASE}/entity?rel=articles&scope=publishing&thread=release-1&mode=raw`,
    );
    await page.getByRole('button', { name: '展开聊天窗' }).click();
    await page.getByPlaceholder('输入目标…').fill('总结第一篇');
    await page.getByRole('button', { name: '发送' }).click();

    const citation = page.locator('[data-nav="citation:post:first-post"]');
    await expect(citation).toHaveCount(1);
    await expect(citation).toContainText('/properties/fields/body');
    await expect(page.locator('[data-nav="citation:post:ghost"]')).toHaveCount(0);
    await expect(citation).not.toHaveAttribute('aria-current', 'location');

    await citation.click();
    await expect
      .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
      .toBe('/canvas?focus=post%3Afirst-post&scope=publishing&thread=release-1');
    await expect(page.locator('[data-surface][data-active="true"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('situation-focus')).toHaveText('post:first-post');
    await expect(citation).toHaveAttribute('aria-current', 'location');

    await page.getByRole('button', { name: '查看原始合同' }).click();
    await expect(page.getByTestId('raw-contract-json')).toContainText('"rel": "post:first-post"');
  });
});

test('authorized entity exposes its exact Siren contract through the local raw lens', async ({
  page,
}) => {
  await withFreshServer(async () => {
    await page.goto(`${SCENARIO_BASE}/entity?rel=articles&scope=publishing`);
    await page.getByRole('button', { name: '查看原始合同' }).click();
    await expect(page.getByTestId('raw-contract-json')).toContainText('"rel": "articles"');
    await expect(page.locator('header nav').getByText('raw', { exact: false })).toHaveCount(0);
  });
});
