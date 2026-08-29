/**
 * 集合面读面能力声明(T38 FR3)的解析校验,自 parse.ts 拆出(GR3 沿功能边界
 * 分解):结构形状(collections/filters/字段名标题)+ 语义引用封闭性(维度
 * 必须是 'status' 或本 flow 声明的 select 字段——值域须可由流拓扑诚实封闭
 * 推导)。与 flow 定义解析同口径:issues 全量收集,拒绝即教育。
 */
import type { FlowDefinition } from './types';

/** 结构校验:集合声明形状对不对(未知输入上的防御式判型)。 */
export function collectionStructuralIssues(
  input: Record<string, unknown>,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (input.collections === undefined) return issues;
  if (!Array.isArray(input.collections)) {
    issues.push({ path: 'collections', message: 'collections 必须是数组' });
    return issues;
  }
  input.collections.forEach((entry, index) => {
    const entryPath = `collections[${index}]`;
    const record =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : undefined;
    if (record === undefined || typeof record.collection !== 'string' || record.collection === '') {
      issues.push({ path: `${entryPath}.collection`, message: 'collection 必须是非空字符串' });
    }
    if (record === undefined || record.filters === undefined) return;
    if (!Array.isArray(record.filters)) {
      issues.push({ path: `${entryPath}.filters`, message: 'filters 必须是数组' });
      return;
    }
    record.filters.forEach((dimension, dimIndex) => {
      const dimPath = `${entryPath}.filters[${dimIndex}]`;
      const dimRecord =
        typeof dimension === 'object' && dimension !== null && !Array.isArray(dimension)
          ? (dimension as Record<string, unknown>)
          : undefined;
      if (
        dimRecord === undefined ||
        typeof dimRecord.field !== 'string' ||
        dimRecord.field === ''
      ) {
        issues.push({ path: `${dimPath}.field`, message: 'field 必须是非空字符串' });
      }
      if (
        dimRecord === undefined ||
        typeof dimRecord.title !== 'string' ||
        dimRecord.title === ''
      ) {
        issues.push({ path: `${dimPath}.title`, message: 'title 必须是非空字符串' });
      }
    });
  });
  return issues;
}

/** 语义校验:维度引用必须落在流拓扑的封闭值域上(status 或本 flow 的 select 字段)。 */
export function collectionSemanticIssues(
  flow: FlowDefinition,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const selectFieldNames = new Set(
    [...(flow.fields ?? []), ...flow.nodes.flatMap((node) => node.fields ?? [])]
      .filter((field) => field.type === 'select')
      .map((field) => field.name),
  );
  for (const entry of flow.collections ?? []) {
    const entryPath = `collections[${entry.collection}]`;
    const seenDimensions = new Set<string>();
    for (const [dimIndex, dimension] of (entry.filters ?? []).entries()) {
      const dimPath = `${entryPath}.filters[${dimIndex}]`;
      if (seenDimensions.has(dimension.field)) {
        issues.push({ path: dimPath, message: '存在重复维度名' });
      }
      seenDimensions.add(dimension.field);
      if (dimension.field !== 'status' && !selectFieldNames.has(dimension.field)) {
        issues.push({
          path: dimPath,
          message: `过滤维度 "${dimension.field}" 必须是 status 或本 flow 声明的 select 字段(值域须可由流拓扑封闭推导)`,
        });
      }
    }
  }
  return issues;
}
