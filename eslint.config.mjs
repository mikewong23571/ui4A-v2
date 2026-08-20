import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

// 根级统一 lint(仓库布局见 DECISIONS.md D3):
// - apps/web 保持 eslint-config-next 语义(与 create-next-app 生成的包内 flat config 等价);
// - apps/worker 与 packages/shared 不含 React/Next,用 typescript-eslint 平配置;
// - e2e 目录(Node 环境 Playwright spec)同样走 typescript-eslint。
export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/out/**',
    '**/build/**',
    '**/dist/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '**/blob-report/**',
    '**/next-env.d.ts',
  ]),
  {
    files: ['apps/web/src/**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [nextCoreWebVitals, nextTypescript],
  },
  {
    files: [
      'apps/worker/src/**/*.ts',
      'packages/shared/src/**/*.ts',
      'e2e/**/*.ts',
      // 根级 Node 环境配置文件(不属任何 workspace 的 tsconfig 范围)
      'playwright.config.ts',
      'vitest.config.ts',
    ],
    extends: [tseslint.configs.recommended],
    rules: {
      // recommended 里默认 warn;质量门要求出现违例即失败,提升为 error。
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
]);
