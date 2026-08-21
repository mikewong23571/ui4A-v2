'use client';
/**
 * kanban 词条(T7 Phase B / 选型 §6):dnd-kit 看板。
 *
 * - columns = 集合引用的解引用结果(成员实体为卡片);分列是词条内部
 *   投影:按成员节点(properties.node)分组,列序 = 节点值首次出现序;
 * - 拖拽是本地视图重组(dnd-kit Pointer/Keyboard 传感器):看板零可提交
 *   元素——变更只能经 form 词条的已声明 action(铁律 3)。
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState } from 'react';

import { asMembers, memberRelOf, memberSummary, type WordProps } from './shared';

/** 卡片(可拖拽;data-rel 即成员身份键,归属列见外层 data-column)。 */
function KanbanCard({ rel, summary }: { rel: string; summary: string }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: rel });
  const style =
    transform !== null ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-rel={rel}
      style={style}
      className="cursor-grab touch-none select-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm"
    >
      {summary !== '' ? summary : rel}
    </li>
  );
}

/** 列(可放置;data-column 即分组键;卡片按本地分组态挂列)。 */
function KanbanColumn({
  column,
  rels,
  children,
}: {
  column: string;
  rels: string[];
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: column });
  return (
    <section
      ref={setNodeRef}
      data-column={column}
      className={`min-w-48 rounded-lg border p-3 ${isOver ? 'border-blue-400 bg-blue-50' : 'border-zinc-200 bg-zinc-50'}`}
    >
      <h3 className="mb-2 text-xs font-semibold text-zinc-500">
        {column}({rels.length})
      </h3>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

export function KanbanWord(props: WordProps) {
  const members = asMembers(props.columns, 'kanban', 'columns');
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  // 本地分组态:卡片 rel → 列键(初值 = 成员节点投影;拖拽仅重组本地视图)。
  const [columnOf, setColumnOf] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    members.forEach((member, index) => {
      initial[memberRelOf(member, index)] = String(member.properties.node ?? '—');
    });
    return initial;
  });
  const summaryOf = new Map(
    members.map((member, index) => [memberRelOf(member, index), memberSummary(member)]),
  );

  // 列序 = 分组键首次出现序(集合 append 序,确定性)。
  const columns: string[] = [];
  for (const rel of Object.keys(columnOf)) {
    const column = columnOf[rel]!;
    if (!columns.includes(column)) columns.push(column);
  }

  function onDragEnd(event: DragEndEvent): void {
    const rel = String(event.active.id);
    const column = event.over?.id;
    if (typeof column === 'string' && column !== columnOf[rel]) {
      setColumnOf((previous) => ({ ...previous, [rel]: column }));
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div data-word="kanban" className="flex flex-wrap items-start gap-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column}
            column={column}
            rels={Object.entries(columnOf).filter(([, value]) => value === column).map(([rel]) => rel)}
          >
            {Object.entries(columnOf)
              .filter(([, value]) => value === column)
              .map(([rel]) => (
                <KanbanCard key={rel} rel={rel} summary={summaryOf.get(rel) ?? ''} />
              ))}
          </KanbanColumn>
        ))}
      </div>
    </DndContext>
  );
}
