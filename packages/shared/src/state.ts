/**
 * 引擎运行时状态类型(fold(事件日志) 的结果形状)。
 *
 * 放在 @ui4a/shared 而非 engine:guard 谓词实现于 shared 且只读快照
 * (spec 架构决定 2),类型若在 engine 会造成 shared→engine 反向依赖。
 * 纯数据、可序列化,web/worker/引擎三方共用。
 */

/**
 * 参数/字段值出处(事件日志记录口径,arch-brief §2):
 * default(默认)/ intent(显式意图)/ proposal(起草+选择)/ elicited(引出)/ effect(效果产出)。
 */
export type ParamOrigin = 'default' | 'intent' | 'proposal' | 'elicited' | 'effect';

/** 带出处的字段值("事实永不发明":每个值都说得清来路)。 */
export interface FieldValue {
  value: unknown;
  origin: ParamOrigin;
}

/**
 * 流程/资源实例快照。资源实例(post:post-welcome)即受对应 flow 管辖的实例,
 * rel 命名遵循业务 rel 规则 `资源类型:实例名`。
 */
export interface InstanceSnapshot {
  rel: string;
  flow: string;
  node: string;
  fields: Record<string, FieldValue>;
  createdAt?: string;
}

/** 引擎全局快照 = 日志折叠态;guard 只读,效果以不可变方式产出新快照。 */
export interface EngineSnapshot {
  instances: Record<string, InstanceSnapshot>;
  /** 集合资源:collection rel → 成员 rel(有序,append 追加)。 */
  collections: Record<string, string[]>;
}

/** 原始字段值视图(properties 投影用):去掉出处,仅取值。 */
export function fieldValues(fields: Record<string, FieldValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([name, entry]) => [name, entry.value]));
}
