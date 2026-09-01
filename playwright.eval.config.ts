import { defineConfig } from '@playwright/test';

const evalSpecs = [
  'glm-probe',
  'llm-render',
  'llm-smoke',
  'llm-thinking',
  'scoped-context',
  'working-context',
  'capability-boundary',
  't15-ai-first-phase-gh',
  't16-real-llm',
] as const;

/**
 * 按需真实 LLM 门禁(T23 GR5 合并原 story-eval/t16-eval/llm-render/delegated-llm/phase-gh
 * 五套配置;被删 spec 专属的配置已随 T23 Phase D 退役)。
 *
 * 全部 spec 由 RUN_LLM_E2E / RUN_LLM_EVAL + 环境显式 provider profile 门控,默认 skip;
 * 各 spec 自起隔离场景 server 并钉住测试库,故本配置刻意不挂全局 webServer。
 * 每个 standing spec 是独立 project:失败不会把其他文件标成 not run，进程级
 * composition cache 也不跨 spec。全局 workers=1 仍保证共享 3110/测试库严格串行。
 *
 * 运行:
 * RUN_LLM_EVAL=1 RUN_LLM_E2E=1 DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
 * TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
 * LLM_API_KEY=... LLM_BASE_URL=https://provider.example/v1 LLM_MODEL=provider-model \
 * CI=true pnpm eval:llm
 */
export default defineConfig({
  testDir: 'e2e',
  projects: evalSpecs.map((name) => ({ name, testMatch: `eval/${name}.spec.ts` })),
  timeout: 900_000,
  fullyParallel: false,
  workers: 1,
  // Real providers occasionally terminate or time out a single request; retry the whole isolated
  // standing case with a fresh worker/server while keeping every semantic assertion unchanged.
  retries: 2,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
