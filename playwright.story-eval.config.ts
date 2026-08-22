import { defineConfig } from '@playwright/test';

/**
 * Real-LLM story evaluation owns its isolated scenario server and test database lifecycle.
 * It deliberately has no global Playwright webServer: a second Next process would boot the same
 * database between a story's before/after snapshots and corrupt both safety evidence and fixtures.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 't15-ai-first-baseline.spec.ts',
  timeout: 900_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
