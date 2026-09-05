'use client';

import { useMetaSitemap } from '../meta-client';

/** Explicit attention selection before opening a Draft form; grants remain server-owned. */
export function DraftScopeChoice({ rel }: { rel: string }) {
  const { sitemap, state } = useMetaSitemap();
  const current = typeof window === 'undefined' ? undefined : new URL(window.location.href);
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <p role="status">起草或处理草稿前，请先选择应用视角。选择后会回到当前草稿页面。</p>
      {state === 'loading' ? <p>正在读取可用应用…</p> : null}
      {state === 'error' ? <p role="alert">读取可用应用失败，请刷新重试。</p> : null}
      {sitemap !== null && (
        <form action="/meta/entity" method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="rel" value={rel} />
          {['thread', 'returnTo'].map((name) => {
            const value = current?.searchParams.get(name);
            return value ? <input key={name} type="hidden" name={name} value={value} /> : null;
          })}
          <label htmlFor="draft-application-scope">应用视角</label>
          <select
            id="draft-application-scope"
            name="scope"
            required
            defaultValue=""
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="" disabled>
              请选择应用
            </option>
            {sitemap.authorizedScopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
          <button
            type="submit"
            data-nav="meta:choose-draft-scope"
            className="h-9 rounded-md border px-3 text-sm"
          >
            继续
          </button>
        </form>
      )}
    </section>
  );
}
