'use client';
/**
 * 全站导航(T7 Phase B / spec 架构决定 5):骨架五面统一入口
 * (收件箱/事件流/BIOS/画布/舰队;发布向导经合同 links 动态进入,
 * 零 startRel 特权)。纯导航链接,每个可点元素带 data-nav(I3 基础)。
 */
const NAV_ITEMS: { label: string; href: string; nav: string }[] = [
  { label: '首页', href: '/', nav: 'home' },
  { label: '收件箱', href: '/entity?rel=inbox', nav: 'inbox' },
  { label: '事件流', href: '/events', nav: 'events' },
  { label: '画布', href: '/canvas', nav: 'canvas' },
  { label: '舰队', href: '/delegations', nav: 'delegations' },
  { label: 'BIOS', href: '/meta', nav: 'meta' },
];

export function SiteNav() {
  return (
    <nav aria-label="全站导航" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {NAV_ITEMS.map((item) => (
        <a
          key={item.nav}
          href={item.href}
          data-nav={item.nav}
          className="text-blue-600 hover:underline"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
