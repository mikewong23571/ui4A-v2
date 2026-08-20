import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ 是 Playwright 专属目录(*.spec.ts);vitest 只收应用单测(*.test.ts)。
    // 覆盖 exclude 会替换默认值,故须一并保留 node_modules/dist 的默认排除。
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
