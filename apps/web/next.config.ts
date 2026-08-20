import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace 内的 TS 源码包需让 Next 一并转译(全栈共享通路 @ui4a/shared;
  // Phase C 起 /api/* 路由运行时引用 @ui4a/engine 的裁决与投影)
  transpilePackages: ['@ui4a/shared', '@ui4a/engine'],
};

export default nextConfig;
