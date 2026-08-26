import path from 'node:path';

import { defineConfig } from 'vitest/config';

import { dbTestFiles } from './vitest.db-tests.list';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';

// Vitest 4: inline `test.projects` 不继承根 test 配置(包括 resolve.alias、
// test.env、exclude),必须显式共享或逐 project 重复;`extends: true` 会把根
// globalSetup 合并进每个 project(全局 setup 将按 project 重复执行 → advisory
// lock 自锁),故不用 extends,globalSetup 只留在根配置 → core project 恰好
// 执行一次并覆盖整个 run。
const WEB_ALIAS = {
  // apps/web 的 tsconfig paths(@/* → apps/web/src/*):Phase F 起组件测试直接
  // import 页面/组件,须与 Next 的别名口径一致(仅测试解析,不影响构建)。
  '@': path.resolve(__dirname, 'apps/web/src'),
};
// 覆盖 exclude 会替换默认值,故须一并保留 node_modules/dist 的默认排除。
const EXCLUDE = ['e2e/**', '**/node_modules/**', '**/dist/**'];
// 触库测试的目录 glob(新增测试文件自动归入 db project,须保持完全包含于 db 集合,
// 否则同一文件会同时被两个 project 执行;glob 只收 *.test.{ts,tsx},避免把目录
// 内的非测试源码当成 suite)。
const DB_DIR_GLOBS = [
  'apps/web/src/engine/service-tests/**/*.test.{ts,tsx}',
  'apps/worker/src/agents/coding/**/*.test.{ts,tsx}',
];
// unit project 的 DATABASE_URL 指向不可达地址:误分到 unit 的触库测试会在此
// 响亮失败,作为分类正确的自检。
const UNIT_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5499/ui4a_nope';
const LLM_ENV = { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' };

export default defineConfig({
  resolve: {
    alias: WEB_ALIAS,
  },
  test: {
    // 单测不得 TRUNCATE 本地开发库。global setup 幂等创建独立库,现有 DB
    // 集成测试继续按文件串行自清理；CI 可用 TEST_DATABASE_URL 覆盖目标。
    // 普通单元/集成测试不得因本机 .env.local 意外调用真实模型。真实 LLM
    // baseline/story eval 由门控 Playwright 命令显式注入完整 profile。
    // 本层配置作用于 core project(无测试文件),仅承载 globalSetup 等全局项。
    exclude: EXCLUDE,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      ...LLM_ENV,
    },
    globalSetup: ['./vitest.global-setup.ts'],
    projects: [
      {
        resolve: { alias: WEB_ALIAS },
        test: {
          // 触库测试:共享同一个测试库,按文件 TRUNCATE 自清理,必须串行。
          name: 'db',
          include: [...dbTestFiles, ...DB_DIR_GLOBS],
          exclude: EXCLUDE,
          fileParallelism: false,
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            ...LLM_ENV,
          },
        },
      },
      {
        resolve: { alias: WEB_ALIAS },
        test: {
          // 纯单元/集成测试:不触库,恢复默认文件级并行。
          name: 'unit',
          include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          exclude: [...EXCLUDE, ...dbTestFiles, ...DB_DIR_GLOBS],
          env: {
            DATABASE_URL: UNIT_DATABASE_URL,
            ...LLM_ENV,
          },
        },
      },
    ],
  },
});
