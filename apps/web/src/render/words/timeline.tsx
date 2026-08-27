'use client';
/**
 * timeline 词条(T9 Phase D):自绘垂直时间线渲染事件流(react-chrono 已退出)。
 *
 * - events = 集合引用的解引用结果(成员 append 序即时间序,零 AI);
 * - 事件流成员带 summary/timestamp/audit 时:摘要与时间戳一行直出,
 *   原始字段/reason/detail 放进默认折叠的本地审计下钻;普通集合成员仍走
 *   `rel · 摘要`兼容路径;
 * - 事件流页(/events)与画布共用本词条:原始数据渲染,不经过任何生成路径;
 * - 审计下钻是 `<details data-nav=local:event-detail>` 本地视图控件,
 *   不产生合同提交面;其余为左侧轨道线 + seq 徽章 + 摘要卡。
 */
import { asMembers, asOptionalString, memberRelOf, memberSummary, type WordProps } from './shared';

export function TimelineWord(props: WordProps) {
  const events = asMembers(props.events, 'timeline', 'events');
  const caption = asOptionalString(props.caption, 'timeline', 'caption');
  const items = events.map((member, index) => {
    const summary = memberSummary(member);
    // 卡片标题 = 成员身份(rel)+ 摘要(投影字段直出,零 AI)。
    const rel = memberRelOf(member, index);
    const eventSummary = member.properties.summary;
    const timestamp = member.properties.timestamp;
    const audit = member.properties.audit;
    return {
      seq: String(member.properties.seq ?? index + 1),
      cardTitle: summary !== '' ? `${rel} · ${summary}` : rel,
      eventSummary: typeof eventSummary === 'string' ? eventSummary : undefined,
      timestamp: typeof timestamp === 'string' ? timestamp : undefined,
      audit:
        typeof audit === 'object' && audit !== null && !Array.isArray(audit) ? audit : undefined,
    };
  });

  return (
    <section data-word="timeline" className="w-full">
      {caption !== undefined && (
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{caption}</h2>
      )}
      {items.length > 0 && (
        <ol className="ml-3 border-l border-border">
          {items.map((item, index) => (
            <li key={`${item.seq}:${index}`} className="relative pb-4 pl-6 last:pb-0">
              {/* seq 圆形徽章:跨在轨道线上(aria-hidden,摘要卡已含同等信息) */}
              <span
                aria-hidden
                className="absolute top-1 -left-3 flex size-6 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-medium text-secondary-foreground tabular-nums"
              >
                {item.seq}
              </span>
              <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-card-foreground">
                {item.timestamp !== undefined && (
                  <time
                    dateTime={item.timestamp}
                    className="mb-1 block text-xs text-muted-foreground tabular-nums"
                  >
                    {formatTimestamp(item.timestamp)}
                  </time>
                )}
                <p>{item.eventSummary ?? item.cardTitle}</p>
                {item.audit !== undefined && (
                  <details
                    data-nav="local:event-detail"
                    className="mt-2 text-xs text-muted-foreground"
                  >
                    <summary className="cursor-pointer select-none">查看原始详情</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px] text-foreground">
                      {JSON.stringify(item.audit, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** ISO 时间戳的人类可读投影;非法值原样显示,不吞审计事实。 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString('zh-CN', { hour12: false });
}
