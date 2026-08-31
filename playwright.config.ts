import { defineConfig } from '@playwright/test';
import { assertIsolatedTemporal, assertTestDatabase } from './e2e/kits/test-isolation';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://ui4a:ui4a@localhost:5433/ui4a_test';
const temporalAddress = process.env.TEMPORAL_ADDRESS ?? 'localhost:7235';
assertTestDatabase(databaseUrl);
assertIsolatedTemporal(temporalAddress);
process.env.DATABASE_URL = databaseUrl;
process.env.TEST_DATABASE_URL = databaseUrl;
process.env.TEMPORAL_ADDRESS = temporalAddress;

// 端口固定 3100(DECISIONS.md D5:本机 3000 被 ui4A v1 占用,不可杀)。
// webServer 由 Playwright 拉起根级 `pnpm dev`(过滤到 @ui4a/web 的 next dev);
// CI=true 时 reuseExistingServer=false,保证干净单次执行。
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  // 单 worker:baseline/chat/llm-smoke 的场景 server 共用 3110 端口与同一 PG
  // (TRUNCATE seed-reset),文件级并行会互相杀 server——串行执行(T2 Phase E)。
  workers: process.env.CI ? 1 : undefined,
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
