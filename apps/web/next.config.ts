import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // workspace 内的 TS 源码包需让 Next 一并转译(全栈共享通路 @ui4a/shared)
  transpilePackages: ["@ui4a/shared"],
};

export default nextConfig;
