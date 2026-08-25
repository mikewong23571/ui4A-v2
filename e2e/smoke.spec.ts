import { expect, test } from '@playwright/test';

// T1 Phase 3 冒烟:证明 E2E 通路(Playwright → dev server → 页面/合同 API)可用。

test('首页返回 HTTP 200 且内容含 "UI4A"', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/UI4A/);
  await expect(page.getByRole('heading', { name: 'UI4A' })).toBeVisible();
});

test('/api/health 返回 readiness "ready"', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  // T22 readiness 口径:status "ok" 需要 optional 探针(temporal/keycloak/llm/runtime)全 ok,
  // dev/e2e 不接这些探针,恒为 degraded;serving 判据是 readiness "ready"。
  const body = (await response.json()) as { readiness: string; db: string };
  expect(body.readiness).toBe('ready');
  // postgres 由 docker compose 提供(测试前置 `docker compose up -d --wait`)
  expect(body.db).toBe('ok');
});
