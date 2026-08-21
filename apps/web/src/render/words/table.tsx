'use client';
/**
 * table 词条(T7 Phase B / 选型 §6):TanStack Table 渲染集合成员。
 *
 * - rows = 集合引用的解引用结果(成员实体数组);列零硬编码:从成员
 *   properties.fields 键并集派生(首个出现序),追加节点列(properties.node);
 * - 行键 = 成员 rel;caption = 字段引用直出;
 * - 纯只读视图(零可提交元素——动作经 form/detail 词条的已声明 action)。
 */
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import type { SirenEntity } from '@ui4a/engine';
import { useMemo } from 'react';

import { asMembers, asOptionalString, memberRelOf, type WordProps } from './shared';

/** 从成员 fields 键并集派生列(首个出现序;零硬编码列名)。 */
function fieldColumns(members: readonly SirenEntity[]): string[] {
  const columns: string[] = [];
  for (const member of members) {
    const fields = member.properties.fields;
    if (typeof fields !== 'object' || fields === null) continue;
    for (const key of Object.keys(fields as Record<string, unknown>)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

/** 单元格文本(标量直出;对象/数组 JSON 化——投影是 JSON 可序列化的)。 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function TableWord(props: WordProps) {
  const rows = asMembers(props.rows, 'table', 'rows');
  const caption = asOptionalString(props.caption, 'table', 'caption');

  const columns = useMemo<ColumnDef<SirenEntity>[]>(() => {
    const derived: ColumnDef<SirenEntity>[] = fieldColumns(rows).map((key) => ({
      id: key,
      header: key,
      cell: (context) =>
        cellText((context.row.original.properties.fields as Record<string, unknown> | undefined)?.[key]),
    }));
    derived.push({
      id: 'node',
      header: '节点',
      cell: (context) => cellText(context.row.original.properties.node),
    });
    return derived;
    // rows 是解引用输出(实体数组),内容变化即新数组——列随数据重算。
  }, [rows]);

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <figure data-word="table" className="w-full">
      {caption !== undefined && <figcaption className="mb-2 text-sm font-semibold text-zinc-700">{caption}</figcaption>}
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              {group.headers.map((header) => (
                <th key={header.id} className="py-2 pr-4">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} data-rel={memberRelOf(row.original, row.index)} className="border-b border-zinc-100">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="py-2 pr-4 text-zinc-800">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
