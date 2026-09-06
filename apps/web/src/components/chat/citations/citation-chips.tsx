'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import type { FactRef } from '@ui4a/agent';

import { citationsOrEmpty } from '@/chat/citations';
import { useLocationObservation } from '@/presence/location';
import { citationCanvasHref } from '@/presence/navigation';

import { citationKindOf, declaredFieldTitleOf, declaredTitleOf } from './citation-kind';

/**
 * T56 P3.4 / D78 决定 5:引用 chip 按可证明性分两型 + 时点边界。
 *
 * - 精确型:声明身份标签 +「(当前名称)」时点标注 + rel 对照(FR8:实时标题
 *   必须表明是当前名称);字段级 pointer 显示声明字段标题,缺失回退原路径;
 * - 集合/成员型(纯指针前缀判别):显式「集合级依据」徽标 + 原 pointer 路径 +
 *   「回答依据当时的集合内容 · 不指向今天同一位置的条目」边界行 —— 集合成员
 *   重排后不冒充精确定位、不显示今日第 N 项对象名(组件不解引用成员身份);
 * - 读取按 rel 懒取(no-store,每挂载重读)并去重;403/网络失败/无声明身份
 *   → 诚实回退 rel + 原路径,失败态显式「当前不可读」,不猜名称、不建全局
 *   标签缓存、不持久化失败结果;
 * - 原 FactRef{rel,pointer} 审计口径保留在 data-rel/data-pointer 与 title;点击落点
 *   仍为 citationCanvasHref(rel),thread/scope 声明随 URL 保留(A6)。
 */

/** 单个 rel 的实体读取状态(组件实例内;失败不跨挂载持久)。 */
type EntityReadState =
  { status: 'loading' } | { status: 'readable'; document: unknown } | { status: 'unreadable' };

const COLLECTION_BADGE = '集合级依据';
const COLLECTION_BOUNDARY = '回答依据当时的集合内容 · 不指向今天同一位置的条目';

function useEntityReadStates(rels: readonly string[]): Record<string, EntityReadState> {
  // rels 以 join key 参与依赖,避免每次渲染重建数组导致重复读取;effect 内从
  // key 还原去重列表(依赖数组只有 key,无 exhaustive-deps 豁免)。
  const key = rels.join('\u0000');
  const [states, setStates] = useState<Record<string, EntityReadState>>({});
  useEffect(() => {
    if (key === '') return;
    let cancelled = false;
    void Promise.all(
      [...new Set(key.split('\u0000'))].map(async (rel): Promise<[string, EntityReadState]> => {
        try {
          const base = rel.startsWith('meta/') || rel.startsWith('draft:') ? '/_meta' : '';
          const response = await fetch(`${base}/api/entity?rel=${encodeURIComponent(rel)}`, {
            cache: 'no-store',
          });
          if (!response.ok) return [rel, { status: 'unreadable' }];
          return [rel, { status: 'readable', document: await response.json() }];
        } catch {
          return [rel, { status: 'unreadable' }];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setStates(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return states;
}

function CitationChip({
  citation,
  read,
  href,
  active,
}: {
  citation: FactRef;
  read: EntityReadState | undefined;
  href: string;
  active: boolean;
}) {
  // 两型判别是纯指针结构,不依赖读取结果 —— 集合型在读取完成前就诚实亮明。
  const collection = citationKindOf(citation.pointer) === 'collection';
  const named = read?.status === 'readable' ? declaredTitleOf(read.document) : null;
  const fieldTitle =
    read?.status === 'readable' && named !== null
      ? declaredFieldTitleOf(read.document, citation.pointer)
      : null;
  // 集合型恒显原路径;精确型仅字段级 pointer('/' 之外)显示字段对照。
  const designation =
    collection || citation.pointer !== '/' ? (fieldTitle ?? citation.pointer) : null;
  return (
    <>
      <Link
        href={href}
        data-nav={`citation:${citation.rel}`}
        data-rel={citation.rel}
        data-pointer={citation.pointer}
        title={`${citation.rel} · ${citation.pointer}(JSON Pointer,审计口径)`}
        aria-current={active ? 'location' : undefined}
        className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-left text-[10px] leading-tight text-foreground transition-colors hover:border-primary/50 aria-[current=location]:border-primary aria-[current=location]:ring-1 aria-[current=location]:ring-ring/30"
      >
        {collection && (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
            {COLLECTION_BADGE}
          </span>
        )}
        <span className="max-w-64 truncate font-medium">{named ?? citation.rel}</span>
        {named !== null && (
          <span className="shrink-0 text-[9px] text-muted-foreground">(当前名称)</span>
        )}
        {designation !== null && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <span className="max-w-48 truncate font-mono text-muted-foreground">{designation}</span>
          </>
        )}
        {named !== null && (
          <span className="max-w-48 truncate font-mono text-muted-foreground">{citation.rel}</span>
        )}
        {read?.status === 'unreadable' && (
          <span className="shrink-0 text-[9px] text-muted-foreground">当前不可读</span>
        )}
      </Link>
      {collection && (
        <span className="block max-w-full text-[10px] leading-tight text-muted-foreground">
          {COLLECTION_BOUNDARY}
        </span>
      )}
    </>
  );
}

function CitationLinks({
  citations,
  states,
}: {
  citations: FactRef[];
  states: Record<string, EntityReadState>;
}) {
  const { route, observation } = useLocationObservation();

  return (
    <footer aria-label="回答依据" className="mt-2 border-t border-border/60 pt-2">
      <span className="text-[10px] font-medium text-muted-foreground">依据</span>
      <ul className="mt-1 flex flex-wrap items-start gap-1.5">
        {citations.map((citation) => {
          const active =
            typeof observation.focus === 'string' && observation.focus === citation.rel;
          return (
            <li key={`${citation.rel}\u0000${citation.pointer}`} className="max-w-full">
              <CitationChip
                citation={citation}
                read={states[citation.rel]}
                href={citationCanvasHref(route, citation.rel)}
                active={active}
              />
            </li>
          );
        })}
      </ul>
    </footer>
  );
}

/** Tail evidence links for one assistant answer; values are never derived from answer text. */
export function CitationList({ citations: input }: { citations: unknown }) {
  const citations = useMemo(() => citationsOrEmpty(input), [input]);
  const states = useEntityReadStates(citations.map((citation) => citation.rel));
  if (citations.length === 0) return null;
  return <CitationLinks citations={citations} states={states} />;
}
