import { defineConfig } from '@playwright/test';

// 端口固定 3100(DECISIONS.md D5:本机 3000 被 ui4A v1 占用,不可杀)。
// webServer 由 Playwright 拉起根级 `pnpm dev`(过滤到 @ui4a/web 的 next dev);
// CI=true 时 reuseExistingServer=false,保证干净单次执行。
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'PORT=3100 pnpm dev',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
