'use client';
/**
 * timeline 词条(T7 Phase B / 选型 §6):react-chrono 渲染事件时间线。
 *
 * - events = 集合引用的解引用结果(成员 append 序即时间序,零 AI);
 * - 条目标题 = 成员 seq(事件日志口径;缺省用下标);摘要 = 投影字段直出
 *   (与 entity-view 的 memberSummary 同口径,经 shared.memberSummary);
 * - 事件流页(/events)与画布共用本词条:原始数据渲染,不经过任何生成路径;
 * - toolbar 缺省关闭:chrono 工具栏按钮是第三方内部控件,无法标注
 *   data-action/data-nav(I3 口径)——骨架零视图杂讯,需要时以
 *   props.toolbar 显式开启。时间点标记(react-chrono 内部 button,
 *   tabindex=-1 不可聚焦)不计入可点元素枚举。
 */
import { Chrono } from 'react-chrono';

import { asMembers, asOptionalString, memberRelOf, memberSummary, type WordProps } from './shared';

import 'react-chrono/dist/style.css';

export function TimelineWord(props: WordProps) {
  const toolbar = props.toolbar === true;
  const events = asMembers(props.events, 'timeline', 'events');
  const caption = asOptionalString(props.caption, 'timeline', 'caption');
  const items = events.map((member, index) => {
    const summary = memberSummary(member);
    // 卡片标题 = 成员身份(rel)+ 摘要(投影字段直出,零 AI)。
    const rel = memberRelOf(member, index);
    return {
      title: String(member.properties.seq ?? index + 1),
      cardTitle: summary !== '' ? `${rel} · ${summary}` : rel,
    };
  });

  return (
    <section data-word="timeline" className="w-full">
      {caption !== undefined && <h2 className="mb-2 text-sm font-semibold text-zinc-700">{caption}</h2>}
      <Chrono
        items={items}
        mode="vertical"
        cardHeight={64}
        fontSizes={{ cardTitle: '0.85rem' }}
        display={{ toolbar: { enabled: toolbar } }}
      />
    </section>
  );
}
