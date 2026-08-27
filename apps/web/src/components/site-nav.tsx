'use client';
/**
 * T27 Workstation 导航：人的主任务常显，底层队列、审计与执行入口按需展开。
 * workstation 与 meta 是显式分区；raw 只是 T28 的查看模式，不在这里占入口。
 * 所有链接与触发键都带 data-nav，满足 I3 零白名单探针约束。
 * T35 F-18：当前项以路由前缀派生(aria-current + 视觉层级),一物一名可定位。
 * T35 F-19/F-13：系统区改为受控弹出层——Chevron 图标、路由变化/外点/Esc 收起。
 */
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const WORKSTATION_ITEMS = [
  { label: '我的事', href: '/', nav: 'home' },
  { label: '共同注视', href: '/canvas', nav: 'canvas' },
] as const;

const SYSTEM_ITEMS = [
  { label: '收件箱', href: '/entity?rel=inbox', nav: 'inbox' },
  { label: '事件流', href: '/events', nav: 'events' },
  { label: '委托监控', href: '/delegations', nav: 'delegations' },
] as const;

/** 路由前缀 → 当前项判定(单一映射表,零逐页特判)。 */
function isCurrent(pathname: string, href: string): boolean {
  const base = href.split('?')[0] ?? href;
  if (base === '/') return pathname === '/';
  return pathname === base || pathname.startsWith(`${base}/`);
}

function linkClassName(current: boolean): string {
  return `rounded-md px-2 py-1 text-sm transition-colors ${
    current
      ? 'bg-accent font-medium text-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  }`;
}

export function SiteNav() {
  const pathname = usePathname() ?? '/';
  const [systemOpen, setSystemOpen] = useState(false);
  const systemRef = useRef<HTMLDivElement>(null);
  const systemActive = SYSTEM_ITEMS.some((item) => isCurrent(pathname, item.href));

  // F-13:路由变化即收起(导航后菜单不再悬浮在上一页内容上)。
  useEffect(() => {
    setSystemOpen(false);
  }, [pathname]);

  // F-19:外点与 Esc 收起(受控弹出层的基本闭环)。
  useEffect(() => {
    if (!systemOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (systemRef.current !== null && !systemRef.current.contains(event.target as Node)) {
        setSystemOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSystemOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [systemOpen]);

  return (
    <nav aria-label="全站导航" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      <div role="group" aria-label="工作站" className="flex items-center gap-1">
        {WORKSTATION_ITEMS.map((item) => (
          <Link
            key={item.nav}
            href={item.href}
            data-nav={item.nav}
            aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
            className={linkClassName(isCurrent(pathname, item.href))}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div role="group" aria-label="定义站" className="flex items-center border-l pl-1">
        <Link
          href="/meta"
          data-nav="meta"
          aria-current={isCurrent(pathname, '/meta') ? 'page' : undefined}
          className={linkClassName(isCurrent(pathname, '/meta'))}
        >
          定义管理
        </Link>
      </div>

      <div ref={systemRef} role="group" aria-label="系统" className="relative border-l pl-1">
        <button
          type="button"
          data-nav="local:system-menu"
          aria-expanded={systemOpen}
          aria-haspopup="menu"
          onClick={() => setSystemOpen((open) => !open)}
          className={`${linkClassName(systemActive && !systemOpen)} flex cursor-pointer items-center gap-1`}
        >
          系统
          <ChevronDown
            aria-hidden="true"
            className={`size-3.5 transition-transform ${systemOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {systemOpen && (
          <div
            role="menu"
            aria-label="系统入口"
            className="absolute right-0 top-full z-50 mt-1.5 min-w-36 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
          >
            {SYSTEM_ITEMS.map((item) => (
              <Link
                key={item.nav}
                href={item.href}
                data-nav={item.nav}
                role="menuitem"
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                className={`block whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isCurrent(pathname, item.href)
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
