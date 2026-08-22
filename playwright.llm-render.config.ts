import { defineConfig } from '@playwright/test';

/** Real render-surface eval owns the scenario server; avoid a competing global Next process. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'llm-render.spec.ts',
  timeout: 420_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
