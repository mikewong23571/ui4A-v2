'use client';
/**
 * timeline 词条(T9 Phase D):自绘垂直时间线渲染事件流(react-chrono 已退出)。
 *
 * - events = 集合引用的解引用结果(成员 append 序即时间序,零 AI);
 * - 条目口径不变:seq 徽章 = 成员 seq(缺省用下标),摘要卡 =
 *   `rel · 摘要`(投影字段直出,经 shared.memberSummary,与 entity-view 同口径);
 * - 事件流页(/events)与画布共用本词条:原始数据渲染,不经过任何生成路径;
 * - 纯展示零可点元素(I3 口径:无 button/a/[role=button],白名单随之退出)——
 *   左侧轨道线 + seq 圆形徽章 + 摘要卡,全部语义令牌,深色可读。
 */
import { asMembers, asOptionalString, memberRelOf, memberSummary, type WordProps } from './shared';

export function TimelineWord(props: WordProps) {
  const events = asMembers(props.events, 'timeline', 'events');
  const caption = asOptionalString(props.caption, 'timeline', 'caption');
  const items = events.map((member, index) => {
    const summary = memberSummary(member);
    // 卡片标题 = 成员身份(rel)+ 摘要(投影字段直出,零 AI)。
    const rel = memberRelOf(member, index);
    return {
      seq: String(member.properties.seq ?? index + 1),
      cardTitle: summary !== '' ? `${rel} · ${summary}` : rel,
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
                {item.cardTitle}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
