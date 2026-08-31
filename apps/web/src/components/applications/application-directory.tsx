'use client';

import { Search } from 'lucide-react';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocationObservation } from '@/presence/location';
import { useApplicationCatalog } from './application-catalog';
import { ApplicationLink } from './application-link';
import { CatalogError } from './catalog-feedback';

/** Complete library; search changes disclosure, not authorization or membership. */
export function ApplicationDirectory() {
  const { state, retry } = useApplicationCatalog();
  const { route, observation } = useLocationObservation();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const entries = state.status === 'ready' ? state.entries : [];
  const matches = entries.filter((entry) =>
    [entry.title, entry.name, entry.intent].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  );
  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <h1 className="text-3xl font-semibold tracking-tight">应用</h1>
        <p className="mt-2 text-sm text-muted-foreground">浏览可用能力，选择应用进入工作区。</p>
      </header>
      {state.status === 'loading' && <Skeleton aria-label="正在读取应用" className="h-24 w-full" />}
      {state.status === 'error' && <CatalogError retry={retry} />}
      {state.status === 'ready' && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
              />
              <label htmlFor="application-search" className="sr-only">
                搜索应用
              </label>
              <input
                id="application-search"
                type="search"
                data-nav="local:applications-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称或用途"
                className="h-10 w-full rounded-md border bg-background pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
            </div>
            <span
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {needle === ''
                ? `${entries.length} 个应用`
                : `${matches.length} / ${entries.length} 个应用`}
            </span>
          </div>
          {query !== '' && (
            <button
              type="button"
              data-nav="local:applications-clear"
              onClick={() => setQuery('')}
              className="text-sm text-primary underline underline-offset-4"
            >
              清除搜索
            </button>
          )}
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无可用应用。</p>
          ) : matches.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              没有匹配的应用。
            </p>
          ) : (
            <ul aria-label="应用目录" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map((application) => (
                <li key={application.name} className="min-w-0">
                  <ApplicationLink
                    application={application}
                    route={route}
                    currentScope={observation.scope}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
