/**
 * render spec 类型(binding-only 渲染的合同形状,T7 spec 架构决定 2)。
 *
 * 客户端渲染器拥有数据模型:agent 只发实体引用,不发内容——"模型字面
 * 意义上发不出一个数字"(铁律 2)。spec = {concern, component(词名),
 * bind(BindTree)};BindTree 只允许三种引用节点 + 结构容器(数组/字典,
 * 递归),任何裸 number/string/boolean/null 载荷都是 schema 违规
 * (validator.ts 剃刀;I2 的前提)。
 *
 * 引用字符串格式(全部声明在此,validator/deref/生成路径共用):
 * - 实体引用:`entity:<rel>`(rel 为业务实体名,可含 ':',如
 *   `entity:post:post-welcome`);
 * - 字段引用:`<rel>.<path>`(首个 '.' 前是 rel,其后是属性路径,
 *   嵌套属性以 '.' 逐层下钻,如 `post:post-welcome.meta.category`);
 * - 集合引用:`<collection-rel>`(集合实体,成员经 entities[] 子实体);
 * - 维度声明:`<collection-rel>.<path>`(rel 前缀必须与所属 collection
 *   一致——validator 强制;path 对每个成员实体求值,解引用器按值分组
 *   计数,chart 的数据源)。
 */

/** 实体引用前缀(ref 节点的取值格式)。 */
export const ENTITY_REF_PREFIX = 'entity:';

/** 实体引用节点:整个实体交给词条组件(渲染器拥有数据模型)。 */
export interface RefBind {
  ref: string;
}

/** 字段引用节点:实体属性的原始值(可嵌套 path)。 */
export interface FieldBind {
  field: string;
}

/**
 * 集合引用节点:成员实体数组;dimension 可选(维度 field-ref,
 * 有则解引用器做分组计数聚合——聚合在客户端做,spec 只声明维度引用)。
 */
export interface CollectionBind {
  collection: string;
  dimension?: string;
}

/**
 * bind 树:引用节点(ref/field/collection+dimension)或结构容器
 * (数组/字典,递归)。字典键是词条 props 的结构名(选,不是画),
 * 值必须仍是 bind 树——裸字面载荷非法(validator 拒)。
 */
export type BindTree =
  RefBind | FieldBind | CollectionBind | BindTree[] | { [key: string]: BindTree };

/** render spec:一次渲染的完整声明(agent/生成路径产出的唯一形状)。 */
export interface RenderSpec {
  /** 关注点键(凝固键:同 concern 永远同一布局)。 */
  concern: string;
  /** 词汇表词名(必须在注册表内;注册表即 A2UI 扩展目录)。 */
  component: string;
  /** 绑定树(零字面;validator 强制)。 */
  bind: BindTree;
}

/** 构造实体引用字符串。 */
export function entityRef(rel: string): string {
  return `${ENTITY_REF_PREFIX}${rel}`;
}

/** 构造字段引用字符串(rel + 属性路径)。 */
export function fieldRef(rel: string, path: string): string {
  return `${rel}.${path}`;
}

/** 构造集合引用字符串(集合 rel 本身)。 */
export function collectionRef(rel: string): string {
  return rel;
}

/** 构造维度声明字符串(collection rel + 成员属性路径)。 */
export function dimensionRef(collectionRel: string, path: string): string {
  return `${collectionRel}.${path}`;
}

/** 字段引用解析:rel 与属性路径(无分隔/空段返回 undefined)。 */
export function parseFieldRef(ref: string): { rel: string; path: string[] } | undefined {
  const separator = ref.indexOf('.');
  if (separator <= 0 || separator === ref.length - 1) return undefined;
  return { rel: ref.slice(0, separator), path: ref.slice(separator + 1).split('.') };
}
