import { APP_NAME, VERSION } from '@ui4a/shared';

// T1 工程基建阶段的极简占位页:验证 web 侧能消费 @ui4a/shared(全栈共享通路)。
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-sm text-zinc-500">v{VERSION} — 占位首页</p>
    </main>
  );
}
