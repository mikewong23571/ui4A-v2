'use client';
/**
 * T27 Workstation 导航：人的主任务常显，底层队列、审计与执行入口按需展开。
 * workstation 与 meta 是显式分区；raw 只是 T28 的查看模式，不在这里占入口。
 * 所有链接与原生 summary 都带 data-nav，满足 I3 零白名单探针约束。
 */
import Link from 'next/link';

const WORKSTATION_ITEMS = [
  { label: '我的事', href: '/', nav: 'home' },
  { label: '共同注视', href: '/canvas', nav: 'canvas' },
] as const;

const SYSTEM_ITEMS = [
  { label: '收件箱', href: '/entity?rel=inbox', nav: 'inbox' },
  { label: '事件流', href: '/events', nav: 'events' },
  { label: '委托监控', href: '/delegations', nav: 'delegations' },
] as const;

const linkClassName =
  'rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

export function SiteNav() {
  return (
    <nav aria-label="全站导航" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      <div role="group" aria-label="工作站" className="flex items-center gap-1">
        {WORKSTATION_ITEMS.map((item) => (
          <Link key={item.nav} href={item.href} data-nav={item.nav} className={linkClassName}>
            {item.label}
          </Link>
        ))}
      </div>

      <div role="group" aria-label="定义站" className="flex items-center border-l pl-1">
        <Link href="/meta" data-nav="meta" className={linkClassName}>
          定义管理
        </Link>
      </div>

      <details aria-label="系统" className="group relative border-l pl-1">
        <summary
          data-nav="local:system-menu"
          className={`${linkClassName} flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}
        >
          系统
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="absolute right-0 top-full z-50 mt-1 grid min-w-28 gap-1 rounded-md border bg-popover p-1 shadow-md">
          {SYSTEM_ITEMS.map((item) => (
            <Link
              key={item.nav}
              href={item.href}
              data-nav={item.nav}
              className={`${linkClassName} whitespace-nowrap`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
