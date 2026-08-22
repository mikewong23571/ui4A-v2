import { defineConfig } from '@playwright/test';

/** Focused T15 Phase G/H eval owns its isolated scenario server; never start the global webServer. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 't15-ai-first-phase-gh.spec.ts',
  timeout: 420_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
