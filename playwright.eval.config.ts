import { defineConfig } from '@playwright/test';

/**
 * 按需真实 LLM 门禁(T23 GR5 合并原 story-eval/t16-eval/llm-render/delegated-llm/phase-gh
 * 五套配置;被删 spec 专属的配置已随 T23 Phase D 退役)。
 *
 * 全部 spec 由 RUN_LLM_E2E / RUN_LLM_EVAL + 环境显式 provider profile 门控,默认 skip;
 * 各 spec 自起隔离场景 server 并钉住测试库,故本配置刻意不挂全局 webServer
 * (第二个 Next 进程会在场景前后快照之间启动同一数据库,污染安全证据与 fixture)。
 *
 * 运行:
 * RUN_LLM_EVAL=1 RUN_LLM_E2E=1 DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
 * TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
 * LLM_API_KEY=... LLM_BASE_URL=https://provider.example/v1 LLM_MODEL=provider-model \
 * CI=true pnpm eval:llm
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: [
    'glm-probe.spec.ts',
    'llm-render.spec.ts',
    'llm-smoke.spec.ts',
    'llm-thinking.spec.ts',
    't15-ai-first-phase-gh.spec.ts',
    't16-real-llm.spec.ts',
  ],
  timeout: 900_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
