'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { citationsOrEmpty } from '@/chat/citations';
import { useLocationObservation } from '@/presence/location';
import { citationCanvasHref } from '@/presence/navigation';

/**
 * G10(T54):引用可点标签用授权实体的**声明名称**(identity/title/target 等
 * 合同身份键),JSON Pointer 留给审计(title 属性/开发者检查)。读取按 rel
 * 懒取并去重;未授权/读取失败/无身份键 → 诚实回退 rel 本身(引用已披露的
 * rel 不是新泄露,不猜名称、不缓存失败)。
 */
function declaredTitleOf(document: unknown): string | null {
  const properties =
    typeof document === 'object' && document !== null && !Array.isArray(document)
      ? ((document as { properties?: unknown }).properties as Record<string, unknown> | undefined)
      : undefined;
  if (properties === undefined) return null;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  const rel = text(properties.rel);
  const identity = [text(properties.identity), text(properties.title)].find(
    (value) => value !== null && value !== rel,
  );
  if (identity !== undefined) return identity;
  const target = text(properties.target);
  if (target !== null) return target;
  const flow = text(properties.flow);
  if (flow !== null) return flow;
  return null;
}

function useDeclaredTitles(rels: readonly string[]): Record<string, string> {
  const key = rels.join('\u0000');
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const unique = [...new Set(rels)];
    void Promise.all(
      unique.map(async (rel): Promise<[string, string] | null> => {
        try {
          const base = rel.startsWith('meta/') || rel.startsWith('draft:') ? '/_meta' : '';
          const response = await fetch(
            `${base}/api/entity?rel=${encodeURIComponent(rel)}`,
            { cache: 'no-store' },
          );
          if (!response.ok) return null;
          const title = declaredTitleOf(await response.json());
          return title === null ? null : [rel, title];
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry !== null) next[entry[0]] = entry[1];
      }
      setTitles(next);
    });
    return () => {
      cancelled = true;
    };
    // rels 以 join key 参与依赖,避免每次渲染重建数组导致重复读取。
  }, [key]);
  return titles;
}

/** Tail evidence links for one assistant answer; values are never derived from answer text. */
export function CitationList({ citations: input }: { citations: unknown }) {
  const citations = useMemo(() => citationsOrEmpty(input), [input]);
  const titles = useDeclaredTitles(citations.map((citation) => citation.rel));
  if (citations.length === 0) return null;
  return <CitationLinks citations={citations} titles={titles} />;
}

function CitationLinks({
  citations,
  titles,
}: {
  citations: ReturnType<typeof citationsOrEmpty>;
  titles: Record<string, string>;
}) {
  const { route, observation } = useLocationObservation();

  return (
    <footer aria-label="回答依据" className="mt-2 border-t border-border/60 pt-2">
      <span className="text-[10px] font-medium text-muted-foreground">依据</span>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {citations.map((citation) => {
          const active =
            typeof observation.focus === 'string' && observation.focus === citation.rel;
          const label = titles[citation.rel] ?? citation.rel;
          return (
            <li key={`${citation.rel}\u0000${citation.pointer}`}>
              <Link
                href={citationCanvasHref(route, citation.rel)}
                data-nav={`citation:${citation.rel}`}
                data-rel={citation.rel}
                data-pointer={citation.pointer}
                title={`${citation.rel} · ${citation.pointer}(JSON Pointer,审计口径)`}
                aria-current={active ? 'location' : undefined}
                className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-left text-[10px] leading-tight text-foreground transition-colors hover:border-primary/50 aria-[current=location]:border-primary aria-[current=location]:ring-1 aria-[current=location]:ring-ring/30"
              >
                <span className="max-w-64 truncate font-medium">{label}</span>
                {titles[citation.rel] !== undefined && (
                  <span className="max-w-48 truncate font-mono text-muted-foreground">
                    {citation.rel}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </footer>
  );
}
