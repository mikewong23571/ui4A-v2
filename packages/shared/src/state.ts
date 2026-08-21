/**
 * 引擎运行时状态类型(fold(事件日志) 的结果形状)。
 *
 * 放在 @ui4a/shared 而非 engine:guard 谓词实现于 shared 且只读快照
 * (spec 架构决定 2),类型若在 engine 会造成 shared→engine 反向依赖。
 * 纯数据、可序列化,web/worker/引擎三方共用。
 */
import type { ActivationSnapshot, DefinitionEntry } from './definition';

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

/**
 * 确认门实体快照(挂起的动作提议;rel = `confirmation:<id>`)。
 *
 * guard 第三语义的"挂起"(arch-brief §3):动作不生效,转入 pending 而非被拒绝;
 * 人类 approve 后由引擎应用原目标动作效果(approve/reject 的裁决语义在
 * @ui4a/engine 的 confirmation 模块,此处只定义快照形状供三方共用)。
 */
export interface ConfirmationSnapshot {
  /** 确认 id(rel 为 `confirmation:<id>`)。 */
  id: string;
  /** 目标实体 rel(原动作要生效的实体)。 */
  targetRel: string;
  /** 目标动作名。 */
  targetAction: string;
  /** 原请求参数(带出处;approve 重放效果的求值输入)。 */
  params?: Record<string, FieldValue>;
  /** 提议者(actor=agent 即委托执行;principal 始终是人)。 */
  proposedBy: { actor: 'human' | 'agent'; principal?: string };
  /** 提议信道(如 http/chat)。 */
  channel?: string;
  status: 'pending' | 'approved' | 'rejected';
  /** 策略标识与原因(策略标注的判定留痕,Phase B Cedar 决策与此同构)。 */
  policy?: string;
  policyReason?: string;
  /** 审批者(铁律 5"审批不委托":approved 时 actor 必为 human)。 */
  approvedBy?: { actor: 'human' | 'agent'; principal?: string };
  /** 驳回原因(human reject 必填)。 */
  rejectedReason?: string;
  /**
   * 通知已送达(T3 Phase C:notification-delivered 事件折叠而来;
   * notify capability 的送达标记,收件箱 delivered 计数的数据源)。
   */
  notified?: boolean;
}

/** 引擎全局快照 = 日志折叠态;guard 只读,效果以不可变方式产出新快照。 */
export interface EngineSnapshot {
  instances: Record<string, InstanceSnapshot>;
  /** 集合资源:collection rel → 成员 rel(有序,append 追加)。 */
  collections: Record<string, string[]>;
  /**
   * 确认门实体表:T3 起 fold/applyEffects 等引擎产出函数恒携带(空表也为 {});
   * 可选是为了不破坏既有快照构造点(种子数据、测试 fixture)的类型兼容。
   * approved/rejected 的确认保留供审计(不删除)。
   */
  confirmations?: Record<string, ConfirmationSnapshot>;
  /**
   * definitions 表(T4):flow 名 → 定义条目(版本/状态/工作副本)。
   * 可选是为了不破坏既有快照构造点(种子数据、测试 fixture)的类型兼容;
   * fold/applyEffects 等引擎产出函数恒携带(空表也为 {})。
   */
  definitions?: Record<string, DefinitionEntry>;
  /** 激活实体表(T4):meta/activation:<id> → 激活快照(批准后保留供审计)。 */
  activations?: Record<string, ActivationSnapshot>;
}

/** 原始字段值视图(properties 投影用):去掉出处,仅取值。 */
export function fieldValues(fields: Record<string, FieldValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([name, entry]) => [name, entry.value]));
}
