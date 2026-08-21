'use client';
/**
 * table 词条(T9 Phase D):TanStack Table 渲染集合成员(shadcn Table 令牌)。
 *
 * - rows = 集合引用的解引用结果(成员实体数组);列零硬编码:从成员
 *   properties.fields 键并集派生(首个出现序),追加节点列(properties.node);
 * - 行键 = 成员 rel;caption = 字段引用直出;
 * - 纯只读视图(零可提交元素——动作经 form/detail 词条的已声明 action)。
 */
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import type { SirenEntity } from '@ui4a/engine';
import { useMemo } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
        cellText(
          (context.row.original.properties.fields as Record<string, unknown> | undefined)?.[key],
        ),
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
      {caption !== undefined && (
        <figcaption className="mb-2 text-sm font-semibold text-muted-foreground">
          {caption}
        </figcaption>
      )}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead key={header.id} className="text-xs text-muted-foreground">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-rel={memberRelOf(row.original, row.index)}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </figure>
  );
}
