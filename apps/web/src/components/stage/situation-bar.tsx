'use client';

import { useState } from 'react';

import Link from 'next/link';

import type { PresenceValue } from '@ui4a/shared';

import { useLocationObservation } from '@/presence/location';
import { locationHrefWithChanges } from '@/presence/navigation';

function displayedValue(value: PresenceValue): string {
  if (value === null) return '未声明';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const SITUATION_FIELDS = [
  ['site', '站点'],
  ['scope', 'scope'],
  ['thread', '工作线'],
  ['focus', '注视'],
] as const;

function ScopeDeclarationEditor({ route, scope }: { route: string; scope: string | null }) {
  const [scopeDraft, setScopeDraft] = useState(scope ?? '');
  return (
    <details className="group shrink-0">
      <summary
        data-nav="local:situation-adjust"
        className="cursor-pointer list-none text-primary hover:underline"
      >
        调整声明
      </summary>
      <div className="absolute right-6 z-50 mt-2 flex w-72 flex-col gap-2 rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
        <p className="text-xs text-muted-foreground">URL 声明不代表已授权。</p>
        <label className="grid gap-1 text-xs">
          声明 scope
          <input
            value={scopeDraft}
            onChange={(event) => setScopeDraft(event.currentTarget.value)}
            data-nav="local:situation-scope-value"
            className="h-8 rounded-md border bg-background px-2 font-mono text-sm"
          />
        </label>
        <div className="flex items-center gap-3">
          {scopeDraft.trim() !== '' && (
            <Link
              href={locationHrefWithChanges(route, { scope: scopeDraft.trim() })}
              data-nav="situation:set-scope"
              className="text-primary hover:underline"
            >
              应用 scope
            </Link>
          )}
          {scope !== null && (
            <Link
              href={locationHrefWithChanges(route, { scope: null })}
              data-nav="situation:clear-scope"
              className="text-primary hover:underline"
            >
              清除 scope
            </Link>
          )}
        </div>
      </div>
    </details>
  );
}

/** Compact shell chrome that echoes URL declarations; it does not render authorization. */
export function SituationBar() {
  const { route, observation } = useLocationObservation();

  return (
    <section aria-label="声明的处境" data-testid="situation-bar" className="border-t bg-muted/30">
      <div className="mx-auto flex min-h-8 w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">你在 URL 中声明的处境</span>
        <dl className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {SITUATION_FIELDS.map(([field, label]) => (
            <div key={field} className="flex min-w-0 items-baseline gap-1">
              <dt>{label}</dt>
              <dd
                data-testid={`situation-${field}`}
                className="max-w-48 truncate font-mono text-foreground"
                title={displayedValue(observation[field])}
              >
                {displayedValue(observation[field])}
              </dd>
            </div>
          ))}
        </dl>
        {observation.thread !== null && (
          <Link
            href={locationHrefWithChanges(route, { thread: null })}
            data-nav="situation:leave-thread"
            className="shrink-0 text-primary hover:underline"
          >
            退出工作线
          </Link>
        )}
        <ScopeDeclarationEditor
          key={observation.scope ?? 'scope:undeclared'}
          route={route}
          scope={observation.scope}
        />
      </div>
    </section>
  );
}

/** Stable-height server fallback for the layout-level search-param Suspense boundary. */
export function SituationBarFallback() {
  return <div aria-hidden className="h-8 border-t bg-muted/30" />;
}
