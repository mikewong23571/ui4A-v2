/**
 * 词条组件共享工具(T7 Phase B):props 形状收紧(响亮失败)+ 成员摘要。
 *
 * 词条组件的输入是解引用器的输出(DerefValue 树,unknown 口径)——
 * 渲染层不做静默默认:形状不符即抛错(缺数据不造数据,铁律 4),
 * 错误信息带词条名与 prop 名(注入防御的审计口径)。
 */
import type { SirenEntity } from '@ui4a/engine';

import type { DimensionCount } from '../deref';

/** 词条组件 props(deref 输出的松散字典;词条内部收紧)。 */
export type WordProps = Record<string, unknown>;

/** 集合成员断言:数组且逐项为 Siren 实体(有 properties 字典)。 */
export function asMembers(value: unknown, word: string, prop: string): SirenEntity[] {
  if (!Array.isArray(value)) {
    throw new Error(`词条 ${word} 的 ${prop} 需要集合解引用结果(实体数组),得到 ${describe(value)}`);
  }
  return value.map((item, index) => asEntity(item, word, `${prop}[${index}]`));
}

/** 实体断言:对象且带 properties 字典(Siren 四件组装的载体)。 */
export function asEntity(value: unknown, word: string, prop: string): SirenEntity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`词条 ${word} 的 ${prop} 需要实体解引用结果,得到 ${describe(value)}`);
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.properties !== 'object' ||
    candidate.properties === null ||
    Array.isArray(candidate.properties)
  ) {
    throw new Error(`词条 ${word} 的 ${prop} 不是 Siren 实体(缺 properties 字典)`);
  }
  return value as SirenEntity;
}

/** 维度聚合断言:[{key, count}] 形状(chart 的数据源)。 */
export function asDimensionCounts(value: unknown, word: string, prop: string): DimensionCount[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `词条 ${word} 的 ${prop} 需要维度聚合结果([{key,count}] 数组),得到 ${describe(value)}`,
    );
  }
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`词条 ${word} 的 ${prop}[${index}] 不是聚合条目`);
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.key !== 'string' || typeof entry.count !== 'number') {
      throw new Error(`词条 ${word} 的 ${prop}[${index}] 缺 key(string)/count(number)`);
    }
    return { key: entry.key, count: entry.count };
  });
}

/** 可选字符串 prop(缺省 undefined;类型不符即抛)。 */
export function asOptionalString(value: unknown, word: string, prop: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`词条 ${word} 的 ${prop} 需要字符串,得到 ${describe(value)}`);
  }
  return value;
}

/** 必需字符串 prop。 */
export function asRequiredString(value: unknown, word: string, prop: string): string {
  const text = asOptionalString(value, word, prop);
  if (text === undefined) {
    throw new Error(`词条 ${word} 缺 ${prop}(必需要素)`);
  }
  return text;
}

/** 统计值断言:标量(number/string)直出,其余形状抛错。 */
export function asStatValue(value: unknown, word: string, prop: string): string | number {
  if (typeof value === 'number' || typeof value === 'string') return value;
  throw new Error(`词条 ${word} 的 ${prop} 需要标量(number/string),得到 ${describe(value)}`);
}

/**
 * 集合成员/事件成员的通用摘要(与 entity-view 的 memberSummary 同口径):
 * 扁平字段值 + 节点;无字段时按 properties 展平(标量 + 一层对象)。
 */
export function memberSummary(sub: SirenEntity): string {
  const parts: string[] = [];
  if (typeof sub.properties.fields === 'object' && sub.properties.fields !== null) {
    for (const value of Object.values(sub.properties.fields as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) parts.push(String(value));
    }
  }
  if (sub.properties.node !== undefined) parts.push(String(sub.properties.node));
  if (parts.length === 0) {
    for (const [key, value] of Object.entries(sub.properties)) {
      if (key === 'rel' || key === 'fields') continue;
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object') {
        for (const leaf of Object.values(value as Record<string, unknown>)) {
          if (leaf !== null && typeof leaf !== 'object' && leaf !== '')
            parts.push(`${key}=${String(leaf)}`);
        }
        continue;
      }
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.filter((part) => part !== '').join(' · ');
}

/** 成员身份键(rel 优先,缺省下标由调用方拼接)。 */
export function memberRelOf(sub: SirenEntity, index: number): string {
  return typeof sub.properties.rel === 'string' && sub.properties.rel !== ''
    ? sub.properties.rel
    : `#${index}`;
}

/** 值的短描述(错误信息用)。 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
