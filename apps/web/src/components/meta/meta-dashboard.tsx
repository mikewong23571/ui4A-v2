'use client';

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { fetchMetaSitemap } from './meta-client';
import {
  browserHrefForMetaRel,
  projectMetaSurfaceDescriptors,
  type MetaSitemapDocument,
} from './meta-surfaces';

export function MetaDashboard({ requestedScope }: { requestedScope?: string }) {
  const [sitemap, setSitemap] = useState<MetaSitemapDocument | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchMetaSitemap(requestedScope)
      .then((next) => {
        if (cancelled) return;
        setSitemap(next);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [requestedScope]);

  const searchResults = useMemo(() => {
    if (sitemap === null || query.trim() === '') return [];
    const needle = query.trim().toLocaleLowerCase();
    return sitemap.surfaces.filter(
      (surface) =>
        surface.title.toLocaleLowerCase().includes(needle) ||
        surface.rel.toLocaleLowerCase().includes(needle),
    );
  }, [query, sitemap]);

  const descriptors = sitemap === null ? [] : projectMetaSurfaceDescriptors(sitemap);
  return (
    <div className="space-y-6" data-testid={state === 'ready' ? 'meta-content-ready' : undefined}>
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
            <form action="/meta" method="get" className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="meta-scope" className="text-xs font-medium text-muted-foreground">
                  当前 Scope
                </label>
                <select
                  id="meta-scope"
                  name="scope"
                  defaultValue={sitemap.effectiveScope}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {sitemap.authorizedScopes.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="h-10 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                切换
              </button>
            </form>
            {sitemap.authorizationMode === 'self-reported-local-demo' && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                本地演示身份：Scope 由服务端 allowlist 约束，不代表生产 SSO。
              </p>
            )}
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
            <CardDescription>
              服务不可用或请求的 Scope 未获授权。请刷新或返回默认 Scope。
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {state === 'ready' && sitemap !== null && (
        <>
          <div>
            <label htmlFor="meta-search" className="text-sm font-medium">
              搜索授权对象
            </label>
            <input
              id="meta-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称、intent 或 rel"
              className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            {query.trim() !== '' && (
              <div className="mt-2 rounded-md border bg-card p-2" aria-live="polite">
                {searchResults.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted-foreground">没有匹配的授权对象。</p>
                ) : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {searchResults.slice(0, 50).map((surface) => (
                      <li key={surface.rel}>
                        <a
                          href={browserHrefForMetaRel(surface.rel, sitemap.effectiveScope)}
                          className="block rounded px-2 py-1.5 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {surface.title}{' '}
                          <span className="text-xs text-muted-foreground">{surface.rel}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <section aria-labelledby="meta-surfaces-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="meta-surfaces-heading" className="text-lg font-semibold">
                治理工作区
              </h2>
              <Badge variant="outline">{descriptors.length} 个授权面</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {descriptors.map((descriptor) => (
                <a
                  key={descriptor.rel}
                  href={descriptor.href}
                  data-testid="meta-surface"
                  className="group rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Card className="h-full gap-3 transition-colors group-hover:border-primary/50 group-hover:bg-accent/30">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base">{descriptor.title}</CardTitle>
                        <Badge variant="secondary">
                          {descriptor.kind === 'self' ? '系统' : '集合'}
                        </Badge>
                      </div>
                      <CardDescription className="break-all">{descriptor.rel}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-primary">打开工作区 →</CardContent>
                  </Card>
                </a>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
