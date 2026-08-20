import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ 是 Playwright 专属目录(*.spec.ts);vitest 只收应用单测(*.test.ts)。
    // 覆盖 exclude 会替换默认值,故须一并保留 node_modules/dist 的默认排除。
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
    // DB 集成测试(events/replay)共用同一个 docker PG 库并以 TRUNCATE 自清理
    // (DECISIONS.md D2:不引 testcontainers),文件级并行会互相清库——串行执行。
    fileParallelism: false,
  },
});
