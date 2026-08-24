import type { NextConfig } from 'next';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: isProduction ? 'tsconfig.build.json' : 'tsconfig.json',
  },
  output: 'standalone',
  outputFileTracingRoot: resolve(webRoot, '../..'),
  // Next 16 Turbopack traces @swc/helpers' package.json through pnpm, but omits
  // its exported helper files unless the monorepo store path is explicit.
  outputFileTracingIncludes: {
    '/*': ['../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*'],
  },
  // workspace 内的 TS 源码包需让 Next 一并转译(全栈共享通路 @ui4a/shared;
  // Phase C 起 /api/* 路由运行时引用 @ui4a/engine 的裁决与投影;
  // Phase E 起 /api/chat 引用 @ui4a/agent 的循环与双 driver)
  transpilePackages: ['@ui4a/shared', '@ui4a/engine', '@ui4a/agent'],
  // E2E 场景 server 的独立构建目录(T2 Phase D):Next 16 的 next dev 对同一
  // 项目目录持单实例锁(.next/dev),Playwright webServer(3100)与 baseline
  // 场景自起 server(3110)并存时必须隔离 distDir,否则后者直接退出。
  // 仅测试辅助旋钮,不改变任何运行时合同语义。
  ...(process.env.UI4A_DIST_DIR !== undefined ? { distDir: process.env.UI4A_DIST_DIR } : {}),
  // _meta 站点(T4 Phase B,spec 决定 6):App Router 以 '_' 开头的目录是私有
  // 文件夹(不可路由),/_meta/* 经 rewrite 映射到内部 /api/meta/* 处理器。
  // canonical URL 恒 /_meta/*(业务面 sitemap 不携带 _meta 入口,跨站规则)。
  async rewrites() {
    return [
      { source: '/_meta/.well-known/ui4a.json', destination: '/api/meta/.well-known/ui4a.json' },
      { source: '/_meta/api/entity', destination: '/api/meta/entity' },
      { source: '/_meta/api/exec', destination: '/api/meta/exec' },
    ];
  },
};

export default nextConfig;
