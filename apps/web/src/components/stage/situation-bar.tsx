'use client';

/** Existing situation chips and popover consume authorized contract labels. */

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useLocationObservation } from '@/presence/location';
import { crossSiteFlowBridge, locationHrefWithChanges } from '@/presence/navigation';

import {
  applicationOptions,
  contextEntityEndpoint,
  contextReferenceHref,
  situationDocumentLabel,
  situationFocusLabel,
  threadOptions,
  useSituationDocument,
  useThreadContextReferences,
  workspaceFocusLabel,
} from './situation-contract';

const SITE_LABELS: Record<string, string> = {
  workstation: '工作站',
  meta: '定义站',
};

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

/** 线芯片弹层内的切线路径二(W3):我的线清单来自 threads 投影。 */
function ThreadSwitcher({ route, currentThreadId }: { route: string; currentThreadId: string }) {
  const document = useSituationDocument('/api/entity?rel=threads', route);
  if (document.status === 'loading')
    return <p className="text-xs text-muted-foreground">读取中…</p>;
  if (document.status === 'error')
    return <p className="text-xs text-destructive">无法读取工作线</p>;
  const others = threadOptions(document.value).filter(
    (thread) => thread.rel !== `thread:${currentThreadId}`,
  );
  if (others.length === 0) return null;
  return (
    <div className="grid gap-1 border-t pt-2.5">
      <p className="text-xs font-medium text-foreground">切换到其他工作线</p>
      {others.map((thread) => {
        const id = thread.rel.replace('thread:', '');
        return (
          <Link
            key={thread.rel}
            href={contextReferenceHref(route, thread.rel)}
            data-nav={`situation:switch-thread:${id}`}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {thread.title}
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
  const [scopeDraft, setScopeDraft] = useState(observation.scope ?? '');
  const threadId = observation.thread?.startsWith('thread:')
    ? observation.thread.slice('thread:'.length)
    : observation.thread;

  const site = observation.site;
  const siteLabel = SITE_LABELS[site] ?? site;
  const refreshKey = `${route}\0${open}`;
  const applications = useSituationDocument('/.well-known/ui4a.json', refreshKey);
  const options = applicationOptions(applications.value);
  const applicationLabel =
    observation.scope === null
      ? '已授权应用'
      : (options.find((option) => option.name === observation.scope)?.title ??
        (applications.status === 'loading' ? '读取中…' : '无法读取'));
  const thread = useSituationDocument(
    threadId === null ? null : contextEntityEndpoint(`thread:${threadId}`),
    refreshKey,
  );
  const focusEndpoint =
    typeof observation.focus === 'string' ? contextEntityEndpoint(observation.focus) : null;
  const focus = useSituationDocument(focusEndpoint, refreshKey);
  const metaDiscovery = useSituationDocument(
    focusEndpoint?.startsWith('/_meta/') ? '/_meta/.well-known/ui4a.json' : null,
    refreshKey,
  );
  const references = useThreadContextReferences(thread.value, open && thread.status === 'ready');
  const threadLabel = observation.thread === null ? '未进入工作线' : situationDocumentLabel(thread);
  const focusLabel =
    observation.focus === null
      ? '未聚焦对象'
      : typeof observation.focus === 'string'
        ? (workspaceFocusLabel(observation.focus, options) ??
          situationFocusLabel(
            focus,
            observation.focus,
            focusEndpoint?.startsWith('/_meta/') ? metaDiscovery : applications,
          ))
        : `已选 ${observation.focus.selection.length} 个对象`;

  const situationDetails = [
    ['site', '站点', siteLabel],
    ['scope', '应用', applicationLabel],
    ['thread', '工作线', threadLabel],
    ['focus', '当前对象', focusLabel],
  ] as const;

  return (
    <section
      aria-label="声明的处境"
      data-testid="situation-bar"
      ref={ref}
      className="relative ml-auto flex min-w-0 max-w-full items-center gap-1.5"
    >
      {/* 站点常显 */}
      <span
        data-testid="situation-site"
        title={`站点:${siteLabel}`}
        className="shrink-0 rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-medium text-foreground"
      >
        {siteLabel}
      </span>
      {/* 有值才出现的芯片(F-12:默认态不占版面) */}
      {observation.scope !== null && (
        <Link
          href={locationHrefWithChanges(route, { scope: null })}
          data-testid="situation-scope"
          aria-label={`当前应用 ${applicationLabel}`}
          title={`当前应用 ${applicationLabel}(点击清除)`}
          data-nav="situation:clear-scope"
          className="min-w-0 max-w-32 truncate rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent"
        >
          {applicationLabel}
        </Link>
      )}
      {observation.thread !== null && (
        <span
          data-testid="situation-thread"
          title={`工作线 ${threadLabel}`}
          className="min-w-0 max-w-32 truncate rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-foreground"
        >
          {threadLabel}
        </span>
      )}
      {observation.focus !== null &&
        (threadId === null || observation.focus !== `thread:${threadId}`) && (
          <span
            data-testid="situation-focus"
            title={`当前对象 ${focusLabel}`}
            className="min-w-0 max-w-40 truncate rounded-full border bg-card px-2.5 py-0.5 text-[11px] text-foreground"
          >
            {focusLabel}
          </span>
        )}

      {/* 「当前在哪」弹层触发键 */}
      <button
        type="button"
        data-nav="local:situation-adjust"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (!open) setScopeDraft(observation.scope ?? '');
          setOpen(!open);
        }}
        className="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
          className="absolute right-0 top-full z-50 mt-2 grid max-h-[70dvh] w-80 max-w-[calc(100vw-3rem)] gap-3 overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <dl className="grid gap-1.5 text-xs">
            {situationDetails.map(([field, label, value]) => (
              <div key={field} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  data-testid={`situation-${field}`}
                  className="min-w-0 max-w-48 truncate text-foreground"
                  title={value}
                >
                  {field === 'thread' &&
                  observation.thread !== null &&
                  thread.status === 'ready' ? (
                    <Link
                      href={contextReferenceHref(route, `thread:${threadId}`)}
                      data-nav="situation:thread"
                      className="text-primary hover:underline"
                    >
                      {value}
                    </Link>
                  ) : field === 'focus' &&
                    typeof observation.focus === 'string' &&
                    focus.status === 'ready' ? (
                    <Link
                      href={contextReferenceHref(route, observation.focus)}
                      data-nav="situation:focus"
                      className="text-primary hover:underline"
                    >
                      {value}
                    </Link>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {references.status === 'ready' && references.value.length > 0 && (
            <nav aria-label="关联对象" className="grid gap-1 border-t pt-2.5">
              {references.value.map((reference) => (
                <Link
                  key={reference.rel}
                  href={contextReferenceHref(route, reference.rel)}
                  data-nav="situation:reference"
                  title={reference.title}
                  className="truncate text-xs text-primary hover:underline"
                >
                  {reference.title}
                </Link>
              ))}
            </nav>
          )}

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
            <label
              htmlFor="situation-scope-selector"
              className="text-xs font-medium text-foreground"
            >
              应用
            </label>
            <select
              id="situation-scope-selector"
              value={scopeDraft}
              onChange={(event) => setScopeDraft(event.currentTarget.value)}
              data-nav="local:situation-scope-value"
              className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm"
              disabled={applications.status !== 'ready'}
            >
              <option value="">已授权应用</option>
              {options.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.title}
                </option>
              ))}
            </select>
            {applications.status === 'loading' && (
              <p className="text-[11px] text-muted-foreground">读取中…</p>
            )}
            {applications.status === 'error' && (
              <p role="status" className="text-[11px] text-destructive">
                无法读取应用
              </p>
            )}
            <div className="flex items-center gap-3">
              {scopeDraft !== (observation.scope ?? '') && (
                <Link
                  href={locationHrefWithChanges(route, {
                    scope: scopeDraft === '' ? null : scopeDraft,
                  })}
                  data-nav="situation:set-scope"
                  className="text-xs text-primary hover:underline"
                >
                  切换应用
                </Link>
              )}
              {observation.scope !== null && (
                <Link
                  href={locationHrefWithChanges(route, { scope: null })}
                  data-nav="situation:clear-scope"
                  className="text-xs text-primary hover:underline"
                >
                  清除应用
                </Link>
              )}
            </div>
          </div>

          {threadId !== null && <ThreadSwitcher route={route} currentThreadId={threadId} />}
        </div>
      )}
    </section>
  );
}

/** Stable-height server fallback for the layout-level search-param Suspense boundary. */
export function SituationBarFallback() {
  return <div aria-hidden className="h-8 w-40" />;
}
