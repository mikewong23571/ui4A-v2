'use client';
/**
 * 机械 diff 内建渲染(T4 Phase C;铁律 5"审计渲染路径零 AI"、arch-brief
 * §10 A.8 完整性第二条):DefinitionDiff 纯数据 → react-diff-view 组件树。
 *
 * - 审批者看到的 diff 不经过被审批者提供的任何渲染器:输入是引擎在 submit 时
 *   冻结的结构化数据(可来自日志重放),渲染器是随内核发行的内建组件;
 * - 转换全程机械(零 AI、零推断):diff 三视角树只提供**变更路径**,行值一律
 *   从 before/after 全文按路径取回(数字键即数组下标;deep-object-diff 对数组
 *   按下标比对,删除元素时留下的空对象标记在此落到"数组级增删行");
 * - 输出为 unified diff 文本(- 旧值 / + 新值,按路径排序,确定性),经
 *   react-diff-view 的 parseDiff 喂给内建 Diff 组件(行号是变更序号,非源行号)。
 */
import type { DefinitionDiff } from '@ui4a/engine';
import { Diff as ReactDiffView, parseDiff } from 'react-diff-view';

import 'react-diff-view/style/index.css';

/** 按点路径从全文取值(数字段视为数组下标;缺任一段 → undefined)。 */
function valueAtPath(source: unknown, segments: readonly string[]): unknown {
  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    const container = current as Record<string, unknown> | unknown[];
    current = Array.isArray(container)
      ? container[Number(segment)]
      : container[segment];
  }
  return current;
}

/** 纯对象判定(deep-object-diff 的树节点;数组与基元都是叶子)。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 路径展示:数字段括号形式(nodes[0].actions[1].name)。 */
function displayPath(segments: readonly string[]): string {
  return segments
    .map((segment, index) => (/^\d+$/.test(segment) ? `[${segment}]` : (index > 0 ? '.' : '') + segment))
    .join('')
    .replace(/^\./, '');
}

/** 一条变更行(路径 + 旧值/新值;值取自 before/after 全文)。 */
interface ChangeEntry {
  path: string;
  old: string | undefined;
  new: string | undefined;
}

/**
 * 收集 diff 视角树的叶子路径(非空纯对象下钻,其余为叶子;undefined 值是
 * deep-object-diff 的"键被删除"标记,同样是叶子路径)。
 */
function leafPaths(tree: unknown, prefix: string[] = []): string[][] {
  if (!isPlainObject(tree)) return [prefix];
  const keys = Object.keys(tree);
  if (keys.length === 0) return [prefix];
  return keys.flatMap((key) => leafPaths(tree[key], [...prefix, key]));
}

/**
 * 纯数据 → unified 行(机械、确定性):三视角路径并集,值从全文取,
 * - 行 = before 有值,+ 行 = after 有值,两侧同 JSON 串(无实际变化)丢弃。
 */
export function diffLines(diff: DefinitionDiff): string[] {
  const views = [diff.changed.added, diff.changed.deleted, diff.changed.updated];
  const byPath = new Map<string, ChangeEntry>();
  for (const view of views) {
    for (const segments of leafPaths(view)) {
      if (segments.length === 0) continue;
      const key = segments.join('\u0000');
      if (!byPath.has(key)) {
        const old = valueAtPath(diff.before, segments);
        const next = valueAtPath(diff.after, segments);
        byPath.set(key, {
          path: displayPath(segments),
          old: old === undefined ? undefined : JSON.stringify(old),
          new: next === undefined ? undefined : JSON.stringify(next),
        });
      }
    }
  }
  return [...byPath.values()]
    .filter((entry) => !(entry.old === undefined && entry.new === undefined))
    .filter((entry) => entry.old !== entry.new)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .flatMap((entry) => {
      const lines: string[] = [];
      if (entry.old !== undefined) lines.push(`- ${entry.path} = ${entry.old}`);
      if (entry.new !== undefined) lines.push(`+ ${entry.path} = ${entry.new}`);
      return lines;
    });
}

/**
 * BIOS 的机械 diff 视图:react-diff-view(unified)呈现 before/after。
 * 输入是结构化纯数据(DefinitionDiff),渲染路径零 AI(源级测试断言)。
 */
export function DefinitionDiffView({ diff }: { diff: DefinitionDiff }) {
  const lines = diffLines(diff);
  if (lines.length === 0) {
    return <p className="mt-2 text-sm text-zinc-500">无差异(候选定义与活跃版本全等)。</p>;
  }
  const deletions = lines.filter((line) => line.startsWith('-')).length;
  const insertions = lines.length - deletions;
  // 行号是变更序号(非源文件行号):旧侧数删除行,新侧数新增行(0 行侧 @@ -0,0)。
  const unified = [
    `--- 定义(基线) ${JSON.stringify(diff.before.name ?? '')}`,
    `+++ 定义(候选) ${JSON.stringify(diff.after.name ?? '')}`,
    `@@ -${deletions === 0 ? 0 : 1},${deletions} +${insertions === 0 ? 0 : 1},${insertions} @@`,
    ...lines,
  ].join('\n');
  const [file] = parseDiff(unified);
  return (
    <div data-bios="diff" className="mt-2 overflow-x-auto text-xs">
      <ReactDiffView diffType="modify" hunks={file?.hunks ?? []} viewType="unified" />
    </div>
  );
}
