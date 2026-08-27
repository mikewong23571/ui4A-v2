'use client';

/**
 * T35 D-7/F-12(方案经用户认可):处境从"一行文字表"收敛为**状态芯片**——
 * 站点常显;scope/工作线/注视仅在有值时以 chip 呈现(默认态"未声明"不占版面);
 * 点芯片展开「当前在哪」弹层:全量字段 + 调整(scope 合法值提示 + 一句授权
 * 边界说明)+ 跨面桥(W3:线芯片弹层内切换工作线)。
 * 本组件渲染进 AppShell 顶栏行(不再单独占一条 bar),顶栏高度回归确定 h-12。
 */

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { PresenceValue } from '@ui4a/shared';

import { useLocationObservation } from '@/presence/location';
import { crossSiteFlowBridge, locationHrefWithChanges } from '@/presence/navigation';

const SITE_LABELS: Record<string, string> = {
  workstation: '工作站',
  meta: '定义站',
};

function displayValue(value: PresenceValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function usePopover(): {
  open: boolean;
  setOpen: (next: boolean) => void;
  ref: React.RefObject<HTMLDivElement | null>;
} {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const chipClassName =
  'flex max-w-40 items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent';

/** 线芯片弹层内的切线路径二(W3):我的线清单来自 threads 投影。 */
function ThreadSwitcher({ route, currentThreadId }: { route: string; currentThreadId: string }) {
  const [threads, setThreads] = useState<Array<{ rel: string; identity: string }> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/entity?rel=threads')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((body: { entities?: Array<{ properties: { rel: string; identity?: string } }> }) => {
        if (cancelled) return;
        setThreads(
          (body.entities ?? []).map((entity) => ({
            rel: String(entity.properties.rel ?? ''),
            identity: String(entity.properties.identity ?? entity.properties.rel ?? ''),
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (threads === null) return <p className="text-xs text-muted-foreground">读取我的线…</p>;
  const others = threads.filter((thread) => thread.rel !== `thread:${currentThreadId}`);
  if (others.length === 0) return <p className="text-xs text-muted-foreground">暂无其他工作线。</p>;
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-foreground">切换到其他工作线</p>
      {others.map((thread) => {
        const id = thread.rel.replace('thread:', '');
        return (
          <Link
            key={thread.rel}
            href={locationHrefWithChanges(route, { thread: id })}
            data-nav={`situation:switch-thread:${id}`}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {}}
          >
            {thread.identity.trim() !== '' ? thread.identity.trim() : thread.rel}
          </Link>
        );
      })}
    </div>
  );
}

/** 顶栏内的处境芯片行;弹层承载全量字段、调整与跨面桥。 */
export function SituationBar() {
  const { route, observation } = useLocationObservation();
  const bridge = crossSiteFlowBridge(route, observation.focus);
  const { open, setOpen, ref } = usePopover();
  const [scopeDraft, setScopeDraft] = useState('');

  const siteLabel = SITE_LABELS[displayValue(observation.site)] ?? displayValue(observation.site);

  return (
    <section
      aria-label="声明的处境"
      data-testid="situation-bar"
      ref={ref}
      className="relative ml-auto flex items-center gap-1.5"
    >
      {/* 站点常显 */}
      <span
        data-testid="situation-site"
        title={`站点:${siteLabel}`}
        className="rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-medium text-foreground"
      >
        {siteLabel}
      </span>
      {/* 有值才出现的芯片(F-12:默认态不占版面) */}
      {observation.scope !== null && (
        <Link
          href={locationHrefWithChanges(route, { scope: null })}
          data-testid="situation-scope"
          title={`scope ${displayValue(observation.scope)}(点击清除)`}
          data-nav="situation:clear-scope"
          className="max-w-32 truncate rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent"
        >
          {displayValue(observation.scope)}
        </Link>
      )}
      {observation.thread !== null && (
        <span
          data-testid="situation-thread"
          title={`工作线 ${displayValue(observation.thread)}`}
          className="max-w-32 truncate rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-foreground"
        >
          线 {displayValue(observation.thread)}
        </span>
      )}
      {observation.focus !== null && (
        <span
          data-testid="situation-focus"
          title={`注视 ${displayValue(observation.focus)}`}
          className="max-w-40 truncate rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-foreground"
        >
          注视 {displayValue(observation.focus)}
        </span>
      )}

      {/* 「当前在哪」弹层触发键 */}
      <button
        type="button"
        data-nav="local:situation-adjust"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        在哪
        <ChevronDown
          aria-hidden="true"
          className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="当前在哪"
          className="absolute right-0 top-full z-50 mt-2 grid w-80 gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <dl className="grid gap-1.5 text-xs">
            {(
              [
                ['site', '站点'],
                ['scope', 'scope'],
                ['thread', '工作线'],
                ['focus', '注视'],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  data-testid={`situation-${field}`}
                  className="max-w-48 truncate font-mono text-foreground"
                  title={displayValue(observation[field])}
                >
                  {displayValue(observation[field])}
                </dd>
              </div>
            ))}
          </dl>

          {bridge !== null && (
            <Link
              href={bridge.href}
              data-nav="situation:cross-site-flow"
              className="text-xs text-primary hover:underline"
            >
              {bridge.label}
            </Link>
          )}
          {observation.thread !== null && (
            <Link
              href={locationHrefWithChanges(route, { thread: null })}
              data-nav="situation:leave-thread"
              className="text-xs text-primary hover:underline"
            >
              退出工作线
            </Link>
          )}

          <div className="grid gap-1.5 border-t pt-2.5">
            <p className="text-xs font-medium text-foreground">调整 scope</p>
            <p className="text-[11px] text-muted-foreground">只影响你看到的内容,不改变权限。</p>
            <input
              value={scopeDraft}
              onChange={(event) => setScopeDraft(event.currentTarget.value)}
              placeholder={observation.scope ?? '如 publishing、todo'}
              data-nav="local:situation-scope-value"
              className="h-8 rounded-md border bg-background px-2 font-mono text-sm"
            />
            <div className="flex items-center gap-3">
              {scopeDraft.trim() !== '' && (
                <Link
                  href={locationHrefWithChanges(route, { scope: scopeDraft.trim() })}
                  data-nav="situation:set-scope"
                  className="text-xs text-primary hover:underline"
                >
                  应用 scope
                </Link>
              )}
              {observation.scope !== null && (
                <Link
                  href={locationHrefWithChanges(route, { scope: null })}
                  data-nav="situation:clear-scope"
                  className="text-xs text-primary hover:underline"
                >
                  清除 scope
                </Link>
              )}
            </div>
          </div>

          {observation.thread !== null && (
            <div className="border-t pt-2.5">
              <ThreadSwitcher route={route} currentThreadId={displayValue(observation.thread)} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Stable-height server fallback for the layout-level search-param Suspense boundary. */
export function SituationBarFallback() {
  return <div aria-hidden className="h-8 w-40" />;
}
