/**
 * 引擎运行时状态类型(fold(事件日志) 的结果形状)。
 *
 * 放在 @ui4a/shared 而非 engine:guard 谓词实现于 shared 且只读快照
 * (spec 架构决定 2),类型若在 engine 会造成 shared→engine 反向依赖。
 * 纯数据、可序列化,web/worker/引擎三方共用。
 */
import type {
  ActivationSnapshot,
  ApplicationDefinition,
  CapabilityDefinition,
  DefinitionEntry,
  FlowDefinition,
} from './definition';

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
  /**
   * 出生版本戳(T4 Phase B):实例出生时其 flow 定义的活跃版本号。
   * 在途实例按出生定义走完——激活新版本只移动活跃指针,不迁移在途;
   * 定义解析(裁决/投影/重放)按本戳从 definitionVersions 历史取定义,
   * 缺省(未盖戳的旧实例/引擎测试 fixture)回退当前活跃定义。
   */
  bornVersion?: number;
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
  /** 提案时动作声明的风险级别；随确认实体持久化，终态仍可审计。 */
  riskLevel?: 'low' | 'medium' | 'high';
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

/**
 * 委托目标(镜像 @ui4a/agent 的 AgentGoal——shared 不依赖 agent 包[依赖方向:
 * agent→engine→shared],结构兼容:worker 侧 AgentGoal 可直赋)。
 */
export interface DelegationGoal {
  /** 目标动词,如「发布」「审核」。 */
  verb: string;
  targetRel?: string;
  resource?: string;
  fields?: Record<string, unknown>;
}

/**
 * 委托实体快照(T5:Temporal workflow 即委托实体;rel = `delegation:<workflowId>`)。
 * fold 从委托事件族(delegation-started/step/completed|failed|max-steps,
 * worker delegationWorkflow 经 activity 写入)折叠;steps/successes 为计数口径,
 * 逐步轨迹在事件日志本身(事件历史即轨迹,arch-brief §4)。
 */
export interface DelegationSnapshot {
  /** 委托 id(Temporal workflowId;rel 为 `delegation:<id>`)。 */
  id: string;
  goal: DelegationGoal;
  driverKind: string;
  startRel: string;
  principal?: string;
  status: 'running' | 'completed' | 'failed' | 'max-steps';
  /** 已执行步数(delegation-step 事件计数)。 */
  steps: number;
  /** 成功执行计数(outcome=executed 的步)。 */
  successes: number;
  /** completed 的 summary。 */
  summary?: string;
  /** failed / max-steps 的原因。 */
  reason?: string;
}

/**
 * 已凝固渲染 spec 快照(T7:render-spec-frozen 事件折叠而来;
 * rel = `render-spec:<concern>`)。"凝固":按关注点首次生成渲染后缓存,
 * 同一关注点永远同一布局(保空间记忆锚点);bind 为零字面引用树
 * (形状由 web 侧零字面校验器把关,引擎按载荷即真相折叠)。
 */
export interface FrozenRenderSpec {
  /** 关注点键(凝固键)。 */
  concern: string;
  /** 词汇表词名。 */
  component: string;
  /** 绑定树(零字面;载荷即真相,引擎不再重复校验)。 */
  bind: unknown;
  /** 首次凝固的请求者(actor=agent 即聊天生成路径)。 */
  requestedBy: { actor: 'human' | 'agent'; principal?: string };
}

/** capability 物化的正式模型工件；独立于业务实例事实，业务字段仅引用 rel。 */
export interface CapabilityArtifactSnapshot {
  rel: string;
  id: string;
  capability: string;
  source: { rel: string; field: string };
  model: string;
  outputSchema: Record<string, unknown>;
  content: unknown;
  contentHash: string;
  createdBy: { actor: 'human' | 'agent'; principal?: string };
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
   * 委托实体表(T5):delegation:<workflowId> → 委托快照(worker 第二写者的
   * 委托事件折叠;舰队页/delegations 集合投影的数据源)。可选与 confirmations
   * 同口径:既有快照构造点的类型兼容;fold/applyEffects 恒携带(空表也为 {})。
   */
  delegations?: Record<string, DelegationSnapshot>;
  /**
   * definitions 表(T4):flow 名 → 定义条目(版本/状态/工作副本)。
   * 可选是为了不破坏既有快照构造点(种子数据、测试 fixture)的类型兼容;
   * fold/applyEffects 等引擎产出函数恒携带(空表也为 {})。
   */
  definitions?: Record<string, DefinitionEntry>;
  /** 激活实体表(T4):meta/activation:<id> → 激活快照(批准后保留供审计)。 */
  activations?: Record<string, ActivationSnapshot>;
  /**
   * 定义版本历史(T4 Phase B):flow 名 → 版本号 → 定义全文。
   * definitions 条目只持"活跃指针"(name/version/status + 工作副本),
   * 历史由 definition-seeded(boot 迁移)与 definition-activated(approve)
   * 沉淀——旧版本定义保留于此,仅在途实例按 bornVersion 回取。
   * 可选与 definitions 同口径:既有快照构造点的类型兼容;
   * fold/applyEffects 等引擎产出函数恒携带(空表也为 {})。
   */
  definitionVersions?: Record<string, Record<number, FlowDefinition>>;
  /**
   * application 定义表(T10):app 名 → 应用定义(已激活集合,app-known
   * 不变式的注册表来源)。Phase A 仅落类型与 submit 接线;Phase B 的
   * boot seed/fold 负责落表(seed 保证 'default' 恒在)。
   * 可选与 definitions 同口径:既有快照构造点的类型兼容。
   */
  applications?: Record<string, ApplicationDefinition>;
  /**
   * capability 定义表(T13):capability 名 → 能力定义(已注册集合,
   * capability-registered 不变式[Phase D]的注册表来源)。boot seed
   * (capability-seeded)落表;与 applications 同口径——可选是为了不破坏
   * 既有快照构造点(种子数据、测试 fixture)的类型兼容,缺省不物化为 {}
   * (表不存在 = 过渡期 vacuous pass 信号)。
   */
  capabilities?: Record<string, CapabilityDefinition>;
  /** capability-artifact-created 事件物化的正式工件表(rel → artifact)。 */
  artifacts?: Record<string, CapabilityArtifactSnapshot>;
  /**
   * 已凝固渲染 spec 表(T7):concern → 已凝固 spec(render-spec-frozen
   * 事件折叠;首冻为准)。可选与 confirmations 同口径;fold/applyEffects
   * 等引擎产出函数恒携带(空表也为 {})。
   */
  renderSpecs?: Record<string, FrozenRenderSpec>;
}

/** 原始字段值视图(properties 投影用):去掉出处,仅取值。 */
export function fieldValues(fields: Record<string, FieldValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([name, entry]) => [name, entry.value]));
}
