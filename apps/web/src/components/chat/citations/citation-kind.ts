/**
 * T56 P3.4 / D78 决定 5:引用 chip 按可证明性分两型的纯判别与声明标题派生。
 *
 * - 判别只用 rel/pointer 结构(纯指针前缀),不解析回答自然语言(FR8 红线);
 * - 集合 JSON Pointer 的数组位置不是永久实体身份:任一数组位置段、`/entities/`
 *   前缀或集合容器终点(/entities、/items)一律判为集合/成员型,缺失历史
 *   identity 时显示集合级来源 + 原 pointer 路径 + 时点边界行,不冒充精确定位;
 * - 标签只来源于声明身份/字段标题:identity/title/target/flow(G10 口径)与
 *   实体 Siren `properties.presentation.fields[]` 的合同 title(与 entity-view
 *   同源);无声明时由调用方回退原 pointer 路径,不假称定位。
 */

export type CitationKind = 'exact' | 'collection';

const POSITIONAL_SEGMENT = /^\d+$/;
const COLLECTION_CONTAINER_SEGMENTS = new Set(['entities', 'items']);

/** 纯结构判别:数组位置段、/entities/ 前缀或集合容器终点 → 集合/成员型。 */
export function citationKindOf(pointer: string): CitationKind {
  const segments = pointer.split('/').slice(1);
  if (segments[0] === 'entities') return 'collection';
  if (segments.some((segment) => POSITIONAL_SEGMENT.test(segment))) return 'collection';
  const last = segments[segments.length - 1];
  return last !== undefined && COLLECTION_CONTAINER_SEGMENTS.has(last) ? 'collection' : 'exact';
}

/** JSON Pointer 段转义还原(~1 → '/',~0 → '~'),用于与声明 path 对齐。 */
function jsonPointerSegmentDecode(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function propertiesOf(document: unknown): Record<string, unknown> | undefined {
  return typeof document === 'object' && document !== null && !Array.isArray(document)
    ? ((document as { properties?: unknown }).properties as Record<string, unknown> | undefined)
    : undefined;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** G10(T54):授权实体的声明名称(合同身份键);无声明 → null,调用方回退 rel。 */
export function declaredTitleOf(document: unknown): string | null {
  const properties = propertiesOf(document);
  if (properties === undefined) return null;
  const rel = text(properties.rel);
  const identity = [text(properties.identity), text(properties.title)].find(
    (value) => value !== null && value !== rel,
  );
  if (identity !== undefined) return identity;
  return text(properties.target) ?? text(properties.flow);
}

/**
 * 声明字段标题(合同 title):pointer '/properties/fields/body' 对应实体 Siren
 * properties.presentation.fields[] 中 path 'properties.fields.body' 的条目。
 * 未声明 → null(调用方回退原 pointer 路径)。
 */
export function declaredFieldTitleOf(document: unknown, pointer: string): string | null {
  const dotPath = pointer
    .split('/')
    .slice(1)
    .map((segment) => jsonPointerSegmentDecode(segment))
    .join('.');
  if (dotPath === '') return null;
  const fields = propertiesOf(document)?.presentation as { fields?: unknown } | undefined;
  if (fields === null || fields === undefined || !Array.isArray(fields.fields)) return null;
  for (const field of fields.fields) {
    if (typeof field !== 'object' || field === null || Array.isArray(field)) continue;
    const entry = field as Record<string, unknown>;
    if (entry.path !== dotPath) continue;
    return text(entry.title);
  }
  return null;
}
