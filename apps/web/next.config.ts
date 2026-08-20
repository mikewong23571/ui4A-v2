import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace 内的 TS 源码包需让 Next 一并转译(全栈共享通路 @ui4a/shared;
  // Phase C 起 /api/* 路由运行时引用 @ui4a/engine 的裁决与投影)
  transpilePackages: ['@ui4a/shared', '@ui4a/engine'],
  // E2E 场景 server 的独立构建目录(T2 Phase D):Next 16 的 next dev 对同一
  // 项目目录持单实例锁(.next/dev),Playwright webServer(3100)与 baseline
  // 场景自起 server(3110)并存时必须隔离 distDir,否则后者直接退出。
  // 仅测试辅助旋钮,不改变任何运行时合同语义。
  ...(process.env.UI4A_DIST_DIR !== undefined ? { distDir: process.env.UI4A_DIST_DIR } : {}),
};

export default nextConfig;
