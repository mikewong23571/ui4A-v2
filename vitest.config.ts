import path from 'node:path';

import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';

export default defineConfig({
  resolve: {
    alias: {
      // apps/web 的 tsconfig paths(@/* → apps/web/src/*):Phase F 起组件测试直接
      // import 页面/组件,须与 Next 的别名口径一致(仅测试解析,不影响构建)。
      '@': path.resolve(__dirname, 'apps/web/src'),
    },
  },
  test: {
    // e2e/ 是 Playwright 专属目录(*.spec.ts);vitest 只收应用单测(*.test.ts)。
    // 覆盖 exclude 会替换默认值,故须一并保留 node_modules/dist 的默认排除。
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
    // 单测不得 TRUNCATE 本地开发库。global setup 幂等创建独立库，现有 DB
    // 集成测试继续按文件串行自清理；CI 可用 TEST_DATABASE_URL 覆盖目标。
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ['./vitest.global-setup.ts'],
    fileParallelism: false,
  },
});
