'use client';
/**
 * 事件流页(T7 Phase B / spec 架构决定 5,骨架路径):/api/events 投影 →
 * timeline 词条(T9 起为自绘垂直时间线;零 AI——机械叙事摘要 + 可折叠
 * 原始审计层,不经过任何生成路径;铁律 5 审计通道隔离)。
 *
 * 人类 feed 使用 desc + beforeSeq，从最新事件向更早事件翻页；底层 replay
 * 继续使用独立的 afterSeq 升序合同。
 * 唯一可点元素是本地分页控件(data-nav,零可提交合同元素)。
 */
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { eventsToMembers, type LogEventRow } from '@/render/situation';
import { TimelineWord } from '@/render/words/timeline';

/** 人类审计 feed 的固定页大小。 */
const PAGE_SIZE = 20;

/** 取一页最新优先事件；beforeSeq 严格向更早的 seq 移动。 */
async function fetchPage(beforeSeq?: number): Promise<{
  page: LogEventRow[];
  nextBeforeSeq: number | null;
  exhausted: boolean;
}> {
  const cursor = beforeSeq === undefined ? '' : `&beforeSeq=${beforeSeq}`;
  const response = await fetch(`/api/events?order=desc&limit=${PAGE_SIZE}${cursor}`);
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

  const initialLoad = useCallback(async () => {
    try {
      const result = await fetchPage();
      setRows(result.page);
      setExhausted(result.exhausted);
      setNextBeforeSeq(result.nextBeforeSeq);
      setFailed(false);
    } catch {
      setFailed(true); // 如实提示,不粉饰
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void initialLoad(), 0);
    return () => clearTimeout(initial);
  }, [initialLoad]);

  const loadMore = useCallback(async () => {
    if (nextBeforeSeq === null) return;
    try {
      const result = await fetchPage(nextBeforeSeq);
      setExhausted(result.exhausted);
      setNextBeforeSeq(result.nextBeforeSeq);
      if (result.page.length > 0) setRows((previous) => [...(previous ?? []), ...result.page]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [nextBeforeSeq]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">事件流</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        事件日志只读投影 · timeline 词条 · 零 AI(机械摘要 + 原始审计下钻)
        {rows !== null ? ` · 已载 ${rows.length} 条` : ''}
      </p>

      {failed && <p className="mt-6 text-sm text-destructive">读取事件失败(服务不可用)。</p>}
      {!failed && rows === null && <p className="mt-6 text-sm text-muted-foreground">加载中…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="empty-events">
          暂无事件
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
