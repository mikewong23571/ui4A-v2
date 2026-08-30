'use client';

import { useEffect, useMemo, useState } from 'react';

import { COGNITIVE_SEMANTICS_GROUP_ROLES } from '@ui4a/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { fetchMetaEntity, fetchMetaSitemap } from './meta-client';
import { DashboardSurfaceGrid, DashboardSurfaceGroup } from './meta-dashboard-surfaces';
import {
  metaNavigationContext,
  withMetaNavigationContext,
  type MetaNavigationContext,
} from './meta-navigation';
import {
  browserHrefForMetaRel,
  projectMetaSurfaceDescriptors,
  relFromMetaApiHref,
  type MetaSitemapDocument,
} from './meta-surfaces';

type DashboardFilter = 'all' | 'pending' | 'invalid';
type LoadedEntity = Awaited<ReturnType<typeof fetchMetaEntity>>;

const groupOrder = COGNITIVE_SEMANTICS_GROUP_ROLES;
const emptyNavigation: MetaNavigationContext = {};

interface SearchEntry {
  rel: string;
  title: string;
  intent: string;
  status: string;
  type: string;
  href: string;
}

export function MetaDashboard({
  navigation = emptyNavigation,
  initialQuery = '',
  initialFilter = 'all',
}: {
  navigation?: MetaNavigationContext;
  initialQuery?: string;
  initialFilter?: DashboardFilter;
}) {
  const { scope, thread, returnTo } = navigation;
  const parsedNavigation = useMemo(
    () => metaNavigationContext({ scope, thread, returnTo }),
    [returnTo, scope, thread],
  );
  const [sitemap, setSitemap] = useState<MetaSitemapDocument | null>(null);
  const [collections, setCollections] = useState<Record<string, LoadedEntity>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading');
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<DashboardFilter>(initialFilter);

  useEffect(() => {
    let cancelled = false;
    void fetchMetaSitemap(parsedNavigation.scope)
      .then(async (next) => {
        if (cancelled) return;
        setSitemap(next);
        const descriptors = projectMetaSurfaceDescriptors(next, parsedNavigation).filter(
          (descriptor) => descriptor.kind === 'collection',
        );
        const results = await Promise.allSettled(
          descriptors.map(
            async (descriptor) =>
              [
                descriptor.rel,
                await fetchMetaEntity(descriptor.rel, parsedNavigation.scope, {
                  revision: next.version,
                }),
              ] as const,
          ),
        );
        if (cancelled) return;
        setCollections(
          Object.fromEntries(
            results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
          ),
        );
        setState(results.some((result) => result.status === 'rejected') ? 'partial' : 'ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [parsedNavigation]);

  const searchIndex = useMemo(() => {
    if (sitemap === null) return [];
    const indexed = new Map<string, SearchEntry>();
    for (const surface of sitemap.surfaces) {
      indexed.set(surface.rel, {
        rel: surface.rel,
        title: surface.title,
        intent: '',
        status: '',
        type: surface.collection ? 'collection' : 'detail',
        href: browserHrefForMetaRel(surface.rel, parsedNavigation),
      });
    }
    for (const collection of Object.values(collections)) {
      for (const member of collection?.entities ?? []) {
        const rel =
          (member.href === undefined ? null : relFromMetaApiHref(member.href)) ??
          (typeof member.properties.rel === 'string' ? member.properties.rel : null);
        if (rel === null) continue;
        indexed.set(rel, {
          rel,
          title:
            typeof member.properties.title === 'string'
              ? member.properties.title
              : typeof member.properties.name === 'string'
                ? member.properties.name
                : typeof member.properties.ref === 'string'
                  ? member.properties.ref
                  : rel,
          intent: typeof member.properties.intent === 'string' ? member.properties.intent : '',
          status: typeof member.properties.status === 'string' ? member.properties.status : '',
          type: member.class.join(' '),
          href: browserHrefForMetaRel(rel, parsedNavigation),
        });
      }
    }
    return [...indexed.values()];
  }, [collections, parsedNavigation, sitemap]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return searchIndex.filter(
      (entry) =>
        (needle === '' ||
          [entry.title, entry.rel, entry.intent, entry.status, entry.type].some((value) =>
            value.toLocaleLowerCase().includes(needle),
          )) &&
        (filter === 'all' ||
          (filter === 'pending' && entry.status === 'pending-approval') ||
          (filter === 'invalid' && entry.status === 'invalid')),
    );
  }, [filter, query, searchIndex]);

  function replaceUrlState(nextQuery: string, nextFilter: DashboardFilter): void {
    const params = new URLSearchParams(window.location.search);
    if (nextQuery === '') params.delete('query');
    else params.set('query', nextQuery);
    if (nextFilter === 'all') params.delete('filter');
    else params.set('filter', nextFilter);
    const suffix = params.toString();
    window.history.replaceState(null, '', suffix === '' ? '/meta' : `/meta?${suffix}`);
  }

  const descriptors =
    sitemap === null ? [] : projectMetaSurfaceDescriptors(sitemap, parsedNavigation);
  const groupedDescriptors = groupOrder.flatMap((groupRole) => {
    const entries = descriptors.filter((descriptor) => {
      if (descriptor.presentation?.groupRole !== groupRole) return false;
      if (groupRole !== 'responsibility') return true;
      return collections[descriptor.rel]?.properties.count !== 0;
    });
    return entries.length === 0 ? [] : [{ groupRole, entries }];
  });
  const ungroupedDescriptors = descriptors.filter(
    (descriptor) => descriptor.presentation?.groupRole === undefined,
  );
  const ready = state === 'ready' || state === 'partial';
  return (
    <div className="space-y-6" data-testid={ready ? 'meta-content-ready' : undefined}>
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Meta Human Control Plane
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">定义控制台</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            发现应用合同、审查候选变更，并以同一份 Siren action 完成人类治理。
          </p>
        </div>
        {sitemap !== null && (
          <div className="w-full shrink-0 space-y-2 sm:w-64">
            <form
              action="/meta"
              method="get"
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const selected = new FormData(event.currentTarget).get('scope');
                const href = withMetaNavigationContext('/meta', {
                  ...parsedNavigation,
                  scope: typeof selected === 'string' && selected !== '' ? selected : undefined,
                });
                if (href !== null) window.location.assign(href);
              }}
            >
              <div className="min-w-0 flex-1">
                <label htmlFor="meta-scope" className="text-xs font-medium text-muted-foreground">
                  当前视角
                </label>
                <select
                  id="meta-scope"
                  name="scope"
                  defaultValue={parsedNavigation.scope ?? ''}
                  data-nav="meta:set-view"
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <option value="">未选择视角</option>
                  {sitemap.authorizedScopes.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                data-nav="meta:apply-view"
                className="h-10 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                切换
              </button>
            </form>
            {parsedNavigation.scope === undefined ? (
              <p className="text-xs text-muted-foreground">未选择视角；默认使用全部已授权应用。</p>
            ) : (
              <Badge data-testid="meta-current-view" variant="outline">
                当前视角 {parsedNavigation.scope}
              </Badge>
            )}
            <aside
              role="region"
              aria-label="可访问应用"
              className="rounded-md border bg-muted/20 p-2"
            >
              <p className="text-xs text-muted-foreground">
                由凭证授予；切换视角不扩大或缩小权限。
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {sitemap.authorizedScopes.map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {scope}
                  </Badge>
                ))}
              </div>
            </aside>
          </div>
        )}
      </header>

      {state === 'loading' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="正在加载定义面">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-lg" />
          ))}
        </div>
      )}
      {state === 'error' && (
        <Card role="alert" className="border-destructive/40">
          <CardHeader>
            <CardTitle>读取定义合同失败</CardTitle>
            <CardDescription>服务不可用或当前视角无法恢复。请刷新或清除当前视角。</CardDescription>
          </CardHeader>
        </Card>
      )}
      {ready && sitemap !== null && (
        <>
          {state === 'partial' && (
            <Card role="status" className="border-amber-500/40 p-4 text-sm">
              部分集合摘要读取失败；已加载的定义面仍可使用，失败集合可单独重试。
            </Card>
          )}
          <div>
            <label htmlFor="meta-search" className="text-sm font-medium">
              搜索授权对象
            </label>
            <input
              id="meta-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                replaceUrlState(event.target.value, filter);
              }}
              placeholder="名称、intent、类型、状态或 rel"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-2" aria-label="状态筛选">
              {(
                [
                  ['all', '全部'],
                  ['pending', '待审批'],
                  ['invalid', 'Invalid'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    replaceUrlState(query, value);
                  }}
                  className="rounded-full border px-3 py-1 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  {label}
                </button>
              ))}
            </div>
            {(query.trim() !== '' || filter !== 'all') && (
              <div className="mt-2 rounded-md border bg-card p-2" aria-live="polite">
                {searchResults.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted-foreground">没有匹配的授权对象。</p>
                ) : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {searchResults.slice(0, 50).map((entry) => (
                      <li key={entry.rel}>
                        <a
                          href={entry.href}
                          className="block rounded px-2 py-1.5 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {entry.title}{' '}
                          <span className="text-xs text-muted-foreground">
                            {entry.rel}
                            {entry.status === '' ? '' : ` · ${entry.status}`}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Badge variant="outline">{descriptors.length} 个授权面</Badge>
          </div>
          {groupedDescriptors.map(({ groupRole, entries }) => (
            <DashboardSurfaceGroup
              key={groupRole}
              groupRole={groupRole}
              descriptors={entries}
              collections={collections}
            />
          ))}
          {ungroupedDescriptors.length > 0 && (
            <section aria-labelledby="meta-surfaces-heading">
              <div className="mb-3">
                <h2 id="meta-surfaces-heading" className="text-lg font-semibold">
                  治理工作区
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">尚未声明认知分组的授权面。</p>
              </div>
              <DashboardSurfaceGrid descriptors={ungroupedDescriptors} collections={collections} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
