/**
 * 解引用器(T7 spec 架构决定 2):纯函数 (bind 树, entityCache) → props。
 *
 * 客户端渲染器拥有数据模型:从 /api/entity 拉取被引用实体进缓存,再经
 * 本函数把 spec 的引用树解成词条组件的 props。聚合(分组计数)在此做:
 * collection + dimension → [{key, count}](chart 数据源),spec 只声明
 * 维度引用。缺引用/缺字段响亮抛错——事实永不发明(铁律 4),不静默
 * 造默认值。
 */
import type { SirenEntity } from '@ui4a/engine';

import { ENTITY_REF_PREFIX, parseFieldRef, type BindTree, type RenderSpec } from './spec';

/** 实体缓存:rel → Siren 实体(渲染器私有,agent 不发 updateDataModel)。 */
export type EntityCache = Map<string, SirenEntity>;

/** 维度聚合计数条目(key = 成员维度值的字符串化;count = 组内成员数)。 */
export interface DimensionCount {
  key: string;
  count: number;
}

/** 解引用输出(与 bind 树同构;引用节点换成实体/值/聚合结果)。 */
export type DerefValue =
  | SirenEntity
  | unknown
  | SirenEntity[]
  | DimensionCount[]
  | DerefValue[]
  | { [key: string]: DerefValue };

/** 沿属性路径下钻(缺段 = undefined;调用方决定是否容忍)。 */
function walkPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** 解析单节点(bind 必须已过零字面校验;结构违规在运行时响亮失败)。 */
function derefNode(bind: BindTree, cache: EntityCache, where: string): DerefValue {
  if (Array.isArray(bind)) {
    return bind.map((child, index) => derefNode(child, cache, `${where}[${index}]`));
  }
  if (typeof bind !== 'object' || bind === null || Array.isArray(bind)) {
    throw new Error(`解引用失败:${where} 是裸字面载荷(spec 未过零字面校验)`);
  }
  const record = bind as Record<string, unknown>;

  if (typeof record.ref === 'string' && 'ref' in record) {
    const rel = record.ref.startsWith(ENTITY_REF_PREFIX)
      ? record.ref.slice(ENTITY_REF_PREFIX.length)
      : record.ref;
    const entity = cache.get(rel);
    if (entity === undefined) {
      throw new Error(`解引用失败:${where} 引用实体 "${rel}" 不在缓存(缺数据,不造数据)`);
    }
    return entity;
  }

  if (typeof record.field === 'string' && 'field' in record) {
    const parsed = parseFieldRef(record.field);
    if (parsed === undefined) {
      throw new Error(`解引用失败:${where} 字段引用格式非法 "${record.field}"`);
    }
    const entity = cache.get(parsed.rel);
    if (entity === undefined) {
      throw new Error(
        `解引用失败:${where} 字段引用的实体 "${parsed.rel}" 不在缓存(缺数据,不造数据)`,
      );
    }
    const value = walkPath(entity.properties, parsed.path);
    if (value === undefined) {
      throw new Error(
        `解引用失败:${where} 字段路径 "${parsed.path.join('.')}" 在实体 "${parsed.rel}" 上不存在(缺数据,不造数据)`,
      );
    }
    return value;
  }

  if (typeof record.collection === 'string' && 'collection' in record) {
    const collection = cache.get(record.collection);
    if (collection === undefined) {
      throw new Error(
        `解引用失败:${where} 集合 "${record.collection}" 不在缓存(缺数据,不造数据)`,
      );
    }
    const members = collection.entities;
    if (members === undefined) {
      throw new Error(
        `解引用失败:${where} 实体 "${record.collection}" 不是集合(无 entities 子实体;引用节点误用)`,
      );
    }
    const dimension = record.dimension;
    if (dimension === undefined) {
      return [...members];
    }
    if (typeof dimension !== 'string') {
      throw new Error(`解引用失败:${where} 维度声明必须是字符串(得到 ${typeof dimension})`);
    }
    const parsed = parseFieldRef(dimension);
    if (parsed === undefined) {
      throw new Error(`解引用失败:${where} 维度声明格式非法 "${dimension}"`);
    }
    // 分组计数:维度 path 对每个成员求值,缺路径响亮失败(不静默丢成员);
    // 组序 = 维度值在成员序上的首次出现序(集合 append 序,确定性)。
    const groups = new Map<string, number>();
    members.forEach((member, index) => {
      const value = walkPath(member.properties, parsed.path);
      if (value === undefined) {
        const rawRel = member.properties.rel;
        throw new Error(
          `解引用失败:${where} 维度路径 "${parsed.path.join('.')}" 在成员 #${index}(${
            typeof rawRel === 'string' ? rawRel : `#${index}`
          })上不存在(缺数据,不造数据)`,
        );
      }
      const key = String(value);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    });
    return [...groups.entries()].map(([key, count]) => ({ key, count }));
  }

  // 结构字典:逐键递归(props 形状与 bind 同构)。
  const props: { [key: string]: DerefValue } = {};
  for (const [key, child] of Object.entries(record)) {
    props[key] = derefNode(child as BindTree, cache, `${where}.${key}`);
  }
  return props;
}

/** 解引用 bind 树(纯函数;spec 须已过零字面校验)。 */
export function deref(bind: BindTree, cache: EntityCache): DerefValue {
  return derefNode(bind, cache, 'bind');
}

/** spec 级解引用:整个 bind → 词条组件 props。 */
export function derefSpec(spec: RenderSpec, cache: EntityCache): { [key: string]: DerefValue } {
  const props = derefNode(spec.bind, cache, 'bind');
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    // 顶层 bind 是引用/数组时包成 {value: …}:props 恒为字典,组件入口稳定。
    return { value: props };
  }
  return props as { [key: string]: DerefValue };
}
