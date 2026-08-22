'use client';
/**
 * 全站导航(T7 Phase B / spec 架构决定 5):骨架五面统一入口
 * (收件箱/事件流/BIOS/画布/舰队;发布向导经合同 links 动态进入,
 * 零 startRel 特权)。纯导航链接,每个可点元素带 data-nav(I3 基础)。
 * T9 Phase A:挂入 AppShell 顶栏(各页面不再各自引用)。
 */
const NAV_ITEMS: { label: string; href: string; nav: string }[] = [
  { label: '首页', href: '/', nav: 'home' },
  { label: '收件箱', href: '/entity?rel=inbox', nav: 'inbox' },
  { label: '事件流', href: '/events', nav: 'events' },
  { label: '画布', href: '/canvas', nav: 'canvas' },
  { label: '委托监控', href: '/delegations', nav: 'delegations' },
  { label: '定义管理', href: '/meta', nav: 'meta' },
];

export function SiteNav() {
  return (
    <nav aria-label="全站导航" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      {NAV_ITEMS.map((item) => (
        <a
          key={item.nav}
          href={item.href}
          data-nav={item.nav}
          className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
