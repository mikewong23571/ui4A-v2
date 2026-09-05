'use client';
/**
 * 事件流页(T7 Phase B / spec 架构决定 5,骨架路径):/api/events 投影 →
 * timeline 词条(T9 起为自绘垂直时间线;零 AI——机械叙事摘要 + 可折叠
 * 原始审计层,不经过任何生成路径;铁律 5 审计通道隔离)。
 *
 * 人类 feed 使用 desc + beforeSeq，从最新事件向更早事件翻页；底层 replay
 * 继续使用独立的 afterSeq 升序合同。
 * 只读过滤(G13):domain(合同枚举下拉)与 kind(自由输入,API 侧 SQL 精确
 * 匹配)两维显式收窄;默认视图保持全量(不丢弃遥测),过滤/清除均从头部
 * 重取,翻页沿用 nextBeforeSeq 游标(不本地去重)。
 * 可点元素均为本地视图控件(分页/过滤,data-nav,零可提交合同元素)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { eventsToMembers, type LogEventRow } from '@/render/situation';
import { TimelineWord } from '@/render/words/timeline';

/** 人类审计 feed 的固定页大小。 */
const PAGE_SIZE = 20;

/**
 * domain 过滤值域 = /api/events 合同的公开枚举校验(同
 * apps/web/src/app/api/events/route.ts 的 domain 枚举:core|presence|
 * presentation|draft|capability|agent-definition)。这是合同枚举的 UI 呈现,
 * 不是业务事件清单;kind 不设清单(用户输入,API 语义为精确匹配)。
 */
const EVENT_DOMAINS = [
  'core',
  'presence',
  'presentation',
  'draft',
  'capability',
  'agent-definition',
] as const;

/** 已生效的只读过滤(空 = 全量)。 */
interface EventFilters {
  domain: string;
  kind: string;
}

const NO_FILTERS: EventFilters = { domain: '', kind: '' };

function hasActiveFilters(filters: EventFilters): boolean {
  return filters.domain !== '' || filters.kind !== '';
}

/** 过滤参数序列化:空过滤 → ''(默认全量请求 URL 形状保持不变)。 */
function filterQuery(filters: EventFilters): string {
  const parts: string[] = [];
  if (filters.domain !== '') parts.push(`domain=${encodeURIComponent(filters.domain)}`);
  if (filters.kind !== '') parts.push(`kind=${encodeURIComponent(filters.kind)}`);
  return parts.join('&');
}

/** 取一页最新优先事件；beforeSeq 严格向更早的 seq 移动(过滤参数随请求透传)。 */
async function fetchPage(
  filter: string,
  beforeSeq?: number,
): Promise<{
  page: LogEventRow[];
  nextBeforeSeq: number | null;
  exhausted: boolean;
}> {
  const suffix = beforeSeq === undefined ? '' : `&beforeSeq=${beforeSeq}`;
  const response = await fetch(
    `/api/events?order=desc&limit=${PAGE_SIZE}${filter === '' ? '' : `&${filter}`}${suffix}`,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as {
    events: LogEventRow[];
    page: { hasMore: boolean; nextBeforeSeq: number | null };
  };
  return {
    page: body.events,
    nextBeforeSeq: body.page.nextBeforeSeq,
    exhausted: !body.page.hasMore,
  };
}

export default function EventsPage() {
  const [rows, setRows] = useState<LogEventRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [nextBeforeSeq, setNextBeforeSeq] = useState<number | null>(null);
  const [filters, setFilters] = useState<EventFilters>(NO_FILTERS);
  // 输入草稿:点「应用过滤」才生效——过滤是用户显式动作,默认视图保持全量。
  const [domainDraft, setDomainDraft] = useState('');
  const [kindDraft, setKindDraft] = useState('');
  // 请求代次:过滤切换/翻页交错时,只接受最新代次的回包,旧回包整包丢弃。
  const epoch = useRef(0);

  const loadHead = useCallback(async (filter: string) => {
    const ticket = ++epoch.current;
    setRows(null);
    setFailed(false);
    try {
      const result = await fetchPage(filter);
      if (ticket !== epoch.current) return;
      setRows(result.page);
      setExhausted(result.exhausted);
      setNextBeforeSeq(result.nextBeforeSeq);
    } catch {
      if (ticket === epoch.current) setFailed(true); // 如实提示,不粉饰
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void loadHead(''), 0);
    return () => clearTimeout(initial);
  }, [loadHead]);

  const activeFilter = filterQuery(filters);

  const loadMore = useCallback(async () => {
    if (nextBeforeSeq === null) return;
    const ticket = ++epoch.current;
    try {
      const result = await fetchPage(activeFilter, nextBeforeSeq);
      if (ticket !== epoch.current) return;
      setExhausted(result.exhausted);
      setNextBeforeSeq(result.nextBeforeSeq);
      if (result.page.length > 0) setRows((previous) => [...(previous ?? []), ...result.page]);
      setFailed(false);
    } catch {
      if (ticket === epoch.current) setFailed(true);
    }
  }, [activeFilter, nextBeforeSeq]);

  const applyFilters = useCallback(() => {
    const next: EventFilters = { domain: domainDraft, kind: kindDraft.trim() };
    setFilters(next);
    void loadHead(filterQuery(next));
  }, [domainDraft, kindDraft, loadHead]);

  /** 一键清除:恢复全量,分页从头部重新开始。 */
  const clearFilters = useCallback(() => {
    setDomainDraft('');
    setKindDraft('');
    setFilters(NO_FILTERS);
    void loadHead('');
  }, [loadHead]);

  const activeFilterText = [
    filters.domain === '' ? null : `domain=${filters.domain}`,
    filters.kind === '' ? null : `kind=${filters.kind}`,
  ].filter((part): part is string => part !== null);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">事件流</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        事件日志只读投影 · timeline 词条 · 零 AI(机械摘要 + 原始审计下钻)· 只读过滤
        {rows !== null ? ` · 已载 ${rows.length} 条` : ''}
      </p>

      <form
        aria-label="事件过滤"
        className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>事件域(domain)</span>
          <select
            value={domainDraft}
            onChange={(event) => setDomainDraft(event.target.value)}
            data-nav="local:events-filter-domain"
            className="rounded-md border border-border bg-card px-1 py-0.5 text-xs text-foreground"
          >
            <option value="">全部(默认全量)</option>
            {EVENT_DOMAINS.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>kind(精确匹配)</span>
          <input
            value={kindDraft}
            onChange={(event) => setKindDraft(event.target.value)}
            data-nav="local:events-filter-kind"
            placeholder="如 action-executed"
            className="w-52 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-xs text-foreground"
          />
        </label>
        <Button type="submit" variant="outline" size="xs" data-nav="local:events-filter-apply">
          应用过滤
        </Button>
      </form>

      {hasActiveFilters(filters) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span data-testid="active-filters">当前过滤:{activeFilterText.join(' · ')}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-nav="local:events-filter-clear"
            onClick={clearFilters}
          >
            清除过滤
          </Button>
        </div>
      )}

      {failed && <p className="mt-6 text-sm text-destructive">读取事件失败(服务不可用)。</p>}
      {!failed && rows === null && <p className="mt-6 text-sm text-muted-foreground">加载中…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="empty-events">
          {hasActiveFilters(filters) ? '当前过滤条件下无匹配事件(可清除过滤恢复全量)' : '暂无事件'}
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <section aria-label="事件时间线" className="mt-6">
          <TimelineWord events={eventsToMembers(rows)} />
          {!exhausted && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-nav="local:events-more"
              onClick={() => void loadMore()}
              className="mt-4"
            >
              加载更多
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
