'use client';
/**
 * 事件流页(T7 Phase B / spec 架构决定 5,骨架路径):/api/events 投影 →
 * timeline 词条(T9 起为自绘垂直时间线;零 AI——原始数据渲染,不经过
 * 任何生成路径;铁律 5 审计通道隔离)。
 *
 * 分页口径(afterSeq,与端点合同一致):端点返回 afterSeq 之后的**全部**
 * 事件;视图每页 PAGE_SIZE 条,超页部分丢弃、经 afterSeq=<已显示尾部 seq>
 * 重取(增量窗口)。回包 ≤ PAGE_SIZE 即尾部已到,分页终止。
 * 唯一可点元素是本地分页控件(data-nav,零可提交合同元素)。
 */
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { eventsToMembers, type LogEventRow } from '@/render/situation';
import { TimelineWord } from '@/render/words/timeline';

/** 视图分页大小(端点无 limit;客户端逐页呈现,afterSeq 增量重取)。 */
const PAGE_SIZE = 20;

/** 取一页(afterSeq 严格大于;回包整批 ≤ PAGE_SIZE 即尾部)。 */
async function fetchPage(afterSeq: number): Promise<{ page: LogEventRow[]; exhausted: boolean }> {
  const response = await fetch(`/api/events?afterSeq=${afterSeq}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { events?: LogEventRow[] };
  const batch = body.events ?? [];
  return { page: batch.slice(0, PAGE_SIZE), exhausted: batch.length <= PAGE_SIZE };
}

export default function EventsPage() {
  const [rows, setRows] = useState<LogEventRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const initialLoad = useCallback(async () => {
    try {
      const result = await fetchPage(0);
      setRows(result.page);
      setExhausted(result.exhausted);
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
    const displayed = rows ?? [];
    const afterSeq = displayed.length > 0 ? displayed[displayed.length - 1]!.seq : 0;
    try {
      const result = await fetchPage(afterSeq);
      setExhausted(result.exhausted);
      if (result.page.length > 0) setRows((previous) => [...(previous ?? []), ...result.page]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [rows]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">事件流</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        事件日志只读投影 · timeline 词条 · 零 AI(原始数据渲染)
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
