import { defineConfig } from '@playwright/test';

/** Delegated real-LLM acceptance owns its Web/Worker stack; Temporal is an explicit prerequisite. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: ['s3.spec.ts', 't15-delegated-profile.spec.ts'],
  timeout: 420_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3110', trace: 'retain-on-failure' },
});
