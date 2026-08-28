/**
 * 统一页面壳(T9 Phase A / DECISIONS D16):sticky 顶栏(品牌 + 版本 +
 * 全站导航)+ 统一内容栅格(max-w-5xl)。专业工程工具风:细边框、
 * 信息密度高、语义令牌配色(深浅色跟随系统)。
 *
 * 每页恰好一个 <main>(由本壳提供):e2e/i3.spec.ts 的 fuzz 注入依赖
 * document.querySelector('main');各页面最外层一律为 div/fragment。
 * 顶栏所有可点元素带 data-nav(I3 交互必背书)。
 *
 * aside 槽位(T9 Phase B / B4):assistant 工作台 sidebar——顶栏之下的
 * flex 行里主区 flex-1 让宽,aside(悬浮聊天的 sidebar 态)贴右全高;
 * main 唯一性不变。
 */
import { Suspense, type ReactNode } from 'react';

import { APP_NAME, VERSION } from '@ui4a/shared';

import { SiteNav } from '@/components/site-nav';
import { SituationBar, SituationBarFallback } from '@/components/stage/situation-bar';

export function AppShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* 窄视口允许换行(响应式无横向溢出;常规宽度恢复 D-7 单行 h-12 定高)。 */}
        <div className="mx-auto flex min-h-12 w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-1 sm:h-12 sm:flex-nowrap sm:py-0">
          <a href="/" data-nav="home" className="flex shrink-0 items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
            <span className="text-xs text-muted-foreground">v{VERSION}</span>
          </a>
          <SiteNav />
          {/* T35 D-7:处境芯片进顶栏行——"你在哪"常显为芯片,顶栏高度确定 h-12。 */}
          <Suspense fallback={<SituationBarFallback />}>
            <SituationBar />
          </Suspense>
        </div>
      </header>
      <div className="flex w-full flex-1">
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
        {aside}
      </div>
    </>
  );
}
