import { defineConfig } from '@playwright/test';

/** T16 real-LLM stories own an isolated scenario server and test database. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 't16-real-llm.spec.ts',
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
