/**
 * machine-as-JSON 定义语言(UI4A 引擎的合同层形状)。
 *
 * T4 起从 @ui4a/engine 迁入 @ui4a/shared:定义平面(meta)需要把 flow 定义
 * 作为**数据**存进引擎快照(definitions 表/激活实体),shared 的 guard 谓词
 * 也要读工作副本与 terminal 推导——类型留在 engine 会造成 shared→engine
 * 反向依赖。engine/src/types.ts re-export 保持引擎公共面不变(机械适配)。
 *
 * 形状以 arch-brief §2(合同层)为准:action-definition 字段
 * `name/title/method/to/guards/requires-confirmation/effect/fields` 原样;
 * field-definition 为 RJSF v6 的直接输入(JSON Schema draft-07 派生自这里)。
 * 这些类型是纯数据(序列化友好),供 web/worker/引擎三方共用。
 */
import type { ParamOrigin } from './state';
import type { SubmissionPolicy } from '../submission';
import type { AgentDefinitionRef } from '../agent/agent-definition';

/** 字段语义(arch-brief §2:四种)。 */
export type FieldSemantics = 'org-standard' | 'intent' | 'work-product' | 'elicitation';

/** 字段在通用呈现中的应用语义，不携带布局或组件选择。 */
export type FieldPresentationRole =
  'identity' | 'status' | 'primary-content' | 'metadata' | 'relation';

/**
 * 字段类型(RJSF 可渲染的表单控件种类 + json)。
 * `json`:任意 JSON 值(meta 编辑动词的 add-action 携带 action-definition 全文;
 * RJSF 以 textarea 渲染,schema 层不约束内层形状)。
 */
export type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'date' | 'json';

/**
 * 字段值来源声明(铁律"事实永不发明":字段值必须声明来源)。
 * `kind` 覆盖 arch-brief 的六种来源:默认四态(静态/上下文/策略路由/词汇别名)、
 * 显式意图、起草+选择、引出、查找、效果产出。
 */
export interface FieldSource {
  kind:
    | 'static'
    | 'context'
    | 'policy-route'
    | 'vocabulary-alias'
    | 'intent'
    | 'proposal'
    | 'elicit'
    | 'lookup'
    | 'effect';
  /** context 来源的取值路径,如 "project.homeRegion"。 */
  from?: string;
  /** proposal 来源使用的 capability 名,如 "draft"。 */
  capability?: string;
  /** proposal 的草稿数(如 options: 3)。 */
  options?: number;
  /** 价值载体字段必须携带 human-required 选择声明(work-product)。 */
  selection?: 'human-required';
}

/** field-definition(arch-brief §2 A.2 原样 + select 的候选值)。 */
export interface FieldDefinition {
  name: string;
  type: FieldType;
  title?: string;
  description?: string;
  required?: boolean;
  semantics?: FieldSemantics;
  /** 提供给 Presentation Plane 的语义角色；不是 CSS/组件指令。 */
  presentation?: {
    role: FieldPresentationRole;
    /**
     * 概览显示 hint(T38 FR4):该字段进入其成员集合的概览行;列序 = 声明序。
     * hint 住在字段声明上——「引用未声明字段」结构上不可表达,零平行机制。
     */
    overview?: boolean;
  };
  /** JSON Schema contentMediaType；只有显式声明才可承诺 Markdown 等内容格式。 */
  contentMediaType?: string;
  source?: FieldSource;
  /** false 表示 action 输入只进入事件/effect，不写回当前实例字段。缺省 true。 */
  persist?: boolean;
  /** select 类型的候选值。 */
  options?: string[];
  /** 字符串最小长度(T3:reject 的 reason 必填且非空;RJSF 原生渲染)。 */
  minLength?: number;
  /** 默认值(静态来源)。 */
  default?: unknown;
  /** json 字段可选的内层 JSON Schema；缺省仍表示任意 JSON 值。 */
  schema?: Record<string, unknown>;
  /** 校验失败时的去向:转澄清 session。 */
  'on-invalid'?: 'clarify';
  /** 引出策略(elicitation 字段)。 */
  elicit?: {
    strategy: string;
    'max-turns': number;
    timeout: string;
  };
}

/**
 * 效果词汇表:
 * - transition:实例节点迁移(目标缺省取 action.to);
 * - clear-fields:清空当前实例字段(循环向导开始下一轮时显式声明);
 * - set-field:字段赋值并记录出处;
 * - append:向集合资源追加新实例(生成 `类型:实例名` rel);
 * - spawn:能力效果(T2 只产出事件记录,T3 接 Temporal);
 * - meta-edit(T4):对 definition 工作副本的结构性效果(编辑动词专用;
 *   载荷来自请求参数,op 与编辑动词同名)。
 */
export type EffectDefinition =
  | { type: 'transition'; to?: string }
  | { type: 'clear-fields' }
  | {
      type: 'set-field';
      field: string;
      /** 静态值；与 from-param 二选一。 */
      value?: unknown;
      /** 从本次已通过 schema 的 action 参数取值。 */
      'from-param'?: string;
      origin?: ParamOrigin;
    }
  | {
      type: 'append';
      /** 目标集合 rel,如 "articles"。 */
      collection: string;
      /** 新实例的资源类型(rel 前缀),缺省取 collection 单数化。 */
      'resource-type'?: string;
      /** 新实例受辖的 flow(如 "post-status")。 */
      flow?: string;
      /** 显式实例名。 */
      name?: string;
      /**
       * 从合并后参数口径取实例名(如 title → slug;D24:请求参数优先,
       * 源实例同名字段兜底)。
       */
      'name-from'?: string;
      /**
       * 复制进新实例的字段白名单,缺省复制整个合并集(D24:源实例 fields ∪
       * 请求参数,参数覆盖同名,各字段 origin 保留);声明时从合并集取白名单。
       */
      fields?: string[];
      /** 新实例的初始节点(受对应 flow 管辖时),如 "published"。 */
      node?: string;
    }
  | {
      type: 'spawn';
      capability: string;
      bind?: Record<string, unknown>;
      'on-done'?: string;
      'on-error'?: string;
    }
  | { type: 'meta-edit'; op: MetaEditOp };

/** meta 编辑动词名(A.3 子集;remove 系与 add-field 为 T4 非目标)。 */
export type MetaEditOp = 'add-node' | 'add-action';

/** action-definition(arch-brief §2 A.2 原样;effect 允许数组以支持组合效果)。 */
export interface ActionDefinition {
  name: string;
  title: string;
  method?: 'POST';
  /** 目标节点(transition 缺省目标)。 */
  to?: string;
  /** guard 谓词名数组(按声明顺序求值,全部求值)。 */
  guards?: string[];
  /** 风险标注(策略性质,T3 才生效;谓词答"状态允许吗",标注答"是否需要确认")。 */
  'requires-confirmation'?: 'low' | 'medium' | 'high';
  effect?: EffectDefinition | EffectDefinition[];
  fields?: FieldDefinition[];
  /** 是否采集当前节点字段；缺省 true。取消类动作应显式关闭。 */
  'collect-node-fields'?: boolean;
  /** Server-owned external write ingress policy; requests cannot override it. */
  submission?: SubmissionPolicy;
  /** Executable by the internal capability bridge but hidden from normal Siren controls. */
  internal?: 'capability-callback';
  /** Human business decision requiring Capability Result revalidation before effects. */
  decision?: 'accept-capability-result' | 'reject-capability-result';
}

/** node-definition:节点 = 界面 + 动作声明集。 */
export interface NodeDefinition {
  name: string;
  title?: string;
  /** 节点级字段(进入该界面时采集)。 */
  fields?: FieldDefinition[];
  actions: ActionDefinition[];
}

/**
 * 集合读面过滤维度声明(T38 FR3):可治理的声明数据,引擎只做 fold 与机械
 * 消费——service 层零「集合名 → 值域」特判映射(§六 规则滑梯)。
 * 值域不在此重复:引用声明 flow 的拓扑推导(status 维度 = 节点集,select
 * 字段维度 = options),保证值域与拓扑零漂移。
 */
export interface CollectionDimensionDeclaration {
  /**
   * 维度名(查询参数 filter.<name>):'status'(实例节点)或本 flow 声明的
   * select 字段名;其余维度无法给出诚实封闭值域,parse 拒绝。
   */
  field: string;
  /** 维度标题(合同/控件文案的唯一来源,渲染器零发明)。 */
  title: string;
}

/** flow 声明其成员族的集合面读面能力(T38):成员集合 → 可过滤维度。 */
export interface CollectionSurfaceDeclaration {
  /** 成员集合 rel(如 comments)。 */
  collection: string;
  /** 可过滤维度;缺省 = 该集合面未声明过滤(诚实缺省,零机制零件)。 */
  filters?: CollectionDimensionDeclaration[];
}

/**
 * flow 定义 = machine-as-JSON(XState v5 运行时构造的真相源)。
 * T2 阶段为代码内 TS 常量;T4 起活跃定义进入事件日志(fold 出)。
 */
export interface FlowDefinition {
  name: string;
  title?: string;
  initial: string;
  nodes: NodeDefinition[];
  /** 流级字段(整个流程实例携带)。 */
  fields?: FieldDefinition[];
  version?: number | string;
  /**
   * 声明归属的 application 名(T10 架构决定 2:membership 方向 = flow 声明归属)。
   * 单属:一个 flow 恰属一个 app;parse 归一化缺省 → 'default'。
   * application 不持成员清单(避免双重真相),membership 由本字段聚合推导。
   */
  app?: string;
  /**
   * 集合面读面能力声明(T38 FR3):该 flow 作为成员族管辖者的集合,可过滤
   * 维度与(拓扑推导的)值域。定义平面数据;投影/读面机械消费。
   */
  collections?: CollectionSurfaceDeclaration[];
  /** Candidate definition/content ingress defaults to Draft unless explicitly tightened. */
  submission?: SubmissionPolicy;
}

/**
 * application 定义(T10 架构决定 1):归组 flows 的定义平面实体,
 * intent 为本体(一段话声明"这个应用解决什么";人类与 agent 共读)。
 * 不持成员清单(membership 由 flow.app 声明,清单派生),避免双重真相。
 */
export interface ApplicationDefinition {
  /** 机器标识(定义实体 rel 的 name 段:`meta/application:<name>`)。 */
  name: string;
  /** 人类与 agent 共读的标题。 */
  title: string;
  /** 人类与 agent 共读的意图声明(发现层两层发现的第一层依据)。 */
  intent: string;
  /** 默认入口(路线 T3 默认页消费;本 track 仅落字段)。 */
  entry?: string;
  submission?: SubmissionPolicy;
}

/** capability 类别(arch-brief 第七层三类动词:转换/提取/效应)。 */
export type CapabilityKind = 'transform' | 'extract' | 'effect';

/**
 * capability 定义(T13 架构决定 3;与 application 同构,T10 先例):
 * 定义平面的能力目录条目,artifact in → artifact out。
 * 不持结构化 schema(input/output 仅为描述文本,schema 真实化归后续)。
 */
export interface CapabilityDefinition {
  /** 机器标识(定义实体 rel 的 name 段:`meta/capability:<name>`)。 */
  name: string;
  /** 人类与 agent 共读的标题。 */
  title: string;
  /** 能力类别(转换/提取/效应)。 */
  kind: CapabilityKind;
  /** 人类与 agent 共读的意图声明(一句话:这个能力做什么)。 */
  intent: string;
  /** 输入 schema 描述(可选)。 */
  input?: string;
  /** 输出 schema 描述(可选)。 */
  output?: string;
  /** 可执行 capability 的结构化输入合同；描述文本 input 保留给人类。 */
  inputSchema?: Record<string, unknown>;
  /** 正式 artifact 内容的结构化输出合同。 */
  outputSchema?: Record<string, unknown>;
  /** capability 的应用/flow scope；缺省表示定义所属安装面的全部处境。 */
  scope?: {
    applications?: string[];
    flows?: string[];
  };
  /** Deployment-resolved executor requirement; Provider details remain server profile data. */
  executor?: {
    class: string;
    profile: string;
    /** Exact specialization birth version; capabilities without it fail dispatch. */
    agentDefinition?: AgentDefinitionRef;
    requiredFeatures?: string[];
  };
}

// ---------------------------------------------------------------------------
// 定义语言注册表(meta/registries 的运行时子集)
// ---------------------------------------------------------------------------

/** 已知字段类型清单(将来由 meta/registries 扩展)。 */
export const KNOWN_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  'text',
  'textarea',
  'select',
  'number',
  'boolean',
  'date',
  'json',
]);

/** 已知效果类型清单(含 T4 的 meta-edit:lifecycle 自身的编辑动词用它)。 */
export const KNOWN_EFFECT_TYPES: ReadonlySet<string> = new Set([
  'transition',
  'clear-fields',
  'set-field',
  'append',
  'spawn',
  'meta-edit',
]);

// ---------------------------------------------------------------------------
// 定义平面 rel 规则与图推导
// ---------------------------------------------------------------------------

/** 定义实体 rel 前缀(A.2 原样:`meta/flow:post-status`)。 */
export const META_FLOW_PREFIX = 'meta/flow:';

/** 激活实体 rel 前缀(与 confirmation:<id> 同构的确定性命名)。 */
export const META_ACTIVATION_PREFIX = 'meta/activation:';

/** application 实体 rel 前缀(T10;`meta/application:publishing`)。 */
export const META_APPLICATION_PREFIX = 'meta/application:';

/** capability 实体 rel 前缀(T13;`meta/capability:draft`)。 */
export const META_CAPABILITY_PREFIX = 'meta/capability:';

/** flow 名 → 定义实体 rel。 */
export function metaFlowRel(name: string): string {
  return `${META_FLOW_PREFIX}${name}`;
}

/** 定义实体/lifecycle 实例 rel → flow 名;非 meta/flow 前缀返回 undefined。 */
export function flowNameFromMetaRel(rel: string): string | undefined {
  return rel.startsWith(META_FLOW_PREFIX) ? rel.slice(META_FLOW_PREFIX.length) : undefined;
}

/** 激活 id → 激活实体 rel。 */
export function metaActivationRel(id: string): string {
  return `${META_ACTIVATION_PREFIX}${id}`;
}

/** 激活实体 rel → id;非前缀返回 undefined。 */
export function activationIdFromMetaRel(rel: string): string | undefined {
  return rel.startsWith(META_ACTIVATION_PREFIX)
    ? rel.slice(META_ACTIVATION_PREFIX.length)
    : undefined;
}

/** application 名 → 定义实体 rel。 */
export function metaApplicationRel(name: string): string {
  return `${META_APPLICATION_PREFIX}${name}`;
}

/** application 实体 rel → application 名;非 meta/application 前缀返回 undefined。 */
export function applicationNameFromMetaRel(rel: string): string | undefined {
  return rel.startsWith(META_APPLICATION_PREFIX)
    ? rel.slice(META_APPLICATION_PREFIX.length)
    : undefined;
}

/** capability 名 → 定义实体 rel。 */
export function metaCapabilityRel(name: string): string {
  return `${META_CAPABILITY_PREFIX}${name}`;
}

/** capability 实体 rel → capability 名;非 meta/capability 前缀返回 undefined。 */
export function capabilityNameFromMetaRel(rel: string): string | undefined {
  return rel.startsWith(META_CAPABILITY_PREFIX)
    ? rel.slice(META_CAPABILITY_PREFIX.length)
    : undefined;
}

/** flow 的一条边(动作名即迁移事件名)。 */
export interface FlowEdge {
  from: string;
  action: string;
  to: string;
}

/** 动作效果里的 transition 目标(effect.to 优先,回退 action.to)。 */
function transitionTarget(action: ActionDefinition): string | undefined {
  const effects = Array.isArray(action.effect)
    ? action.effect
    : action.effect !== undefined
      ? [action.effect]
      : [];
  const transition = effects.find((effect) => effect.type === 'transition');
  if (transition !== undefined && transition.type === 'transition') {
    return transition.to;
  }
  return undefined;
}

/**
 * flow 的全部边:动作声明的 to(缺省回退单条 transition 效果的 to)。
 * `extra`:非 exec 动词表达的引擎内边(definition-lifecycle 的 checks-pass/
 * checks-fail)——仅供 terminal/可达性推导,不进裁决面。
 */
export function flowEdges(flow: FlowDefinition, extra: readonly FlowEdge[] = []): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (const node of flow.nodes) {
    for (const action of node.actions) {
      const target = action.to ?? transitionTarget(action);
      if (target !== undefined) {
        edges.push({ from: node.name, action: action.name, to: target });
      }
    }
  }
  return [...edges, ...extra];
}

/** terminal 节点 = 无出边的节点(按声明序)。 */
export function terminalNodes(flow: FlowDefinition, extra?: readonly FlowEdge[]): string[] {
  const withOutgoing = new Set(flowEdges(flow, extra).map((edge) => edge.from));
  return flow.nodes.map((node) => node.name).filter((name) => !withOutgoing.has(name));
}

/** 从 initial 沿边可达的节点集(BFS;含起点)。 */
export function reachableNodes(flow: FlowDefinition, extra?: readonly FlowEdge[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of flowEdges(flow, extra)) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const seen = new Set<string>([flow.initial]);
  const queue = [flow.initial];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// 定义平面快照形状(definitions 表 + 激活实体)
// ---------------------------------------------------------------------------

/** definition-lifecycle 的状态集(A.4;validating 为引擎内瞬态,不持久化)。 */
export type DefinitionStatus = 'draft' | 'pending-approval' | 'active' | 'rejected' | 'deprecated';

/**
 * definitions 表条目(T4 Task 1):flow 名 → 版本 + 状态 + 定义内容。
 * status 与 lifecycle 实例(meta/flow:<name> 的 node)由 meta 模块在线路径
 * 与 fold 双轨保持一致(一致性由测试断言)。
 */
export interface DefinitionEntry {
  name: string;
  /** 当前内容版本:活跃内容携带激活时分配的版本号(见 definition-activated)。 */
  version: number;
  status: DefinitionStatus;
  /** 草稿态 = 工作副本;active = 活跃定义。 */
  definition: FlowDefinition;
  /** revise 的出生口径:本(候选)内容派生自哪个活跃版本。 */
  bornBy?: number;
}

/** 激活不变式检查结果(A.5 种子集;checks 入 activation 实体与事件 detail)。 */
export interface ActivationCheck {
  name: string;
  pass: boolean;
  /** 失败明细(逐条列出违规位置)。 */
  detail?: string[];
}

/**
 * 机械 diff 纯数据(T4 Phase C;铁律 5"审计渲染路径零 AI"):
 * 引擎在 submit 时对 before/after 定义计算结构化差异(deep-object-diff 三视角),
 * 前后全文随行——diff 自包含、可序列化、重放不重算(载荷即真相)。审批者看到的
 * diff 由内建渲染器(react-diff-view)呈现,不经过被审批者提供的任何渲染器。
 */
export interface DefinitionDiff {
  /** diff 算法标识(数据自描述,审计口径)。 */
  algorithm: 'deep-object-diff';
  /** 基线:提交时的活跃定义。 */
  before: FlowDefinition;
  /** 候选:提交的草稿全文(与 activation.definition 同文)。 */
  after: FlowDefinition;
  /**
   * deep-object-diff 三视角差异(嵌套对象即路径,数字键为数组下标):
   * added/deleted 持整份增删子树;updated 只持新值,旧值由渲染器从 before
   * 按同路径机械取回。
   */
  changed: {
    added: Record<string, unknown>;
    deleted: Record<string, unknown>;
    updated: Record<string, unknown>;
  };
}

/**
 * 激活实体快照(A.2 激活请求形状):pending-approval 物化;approve/reject 的
 * 目标。artifact 为 definition 内容 hash(T4 用 FNV 短码;sha256 随 versions
 * 工件落地——Phase B)。
 */
export interface ActivationSnapshot {
  id: string;
  /** 目标 flow 名。 */
  flow: string;
  status: 'pending-approval' | 'approved' | 'rejected';
  /** 本次激活将分配的版本号(当前活跃版本 + 1)。 */
  version: number;
  /** 草稿内容 hash(contentVersion 短码)。 */
  artifact: string;
  checks: ActivationCheck[];
  /** 提交时的完整草稿(approve 时据此激活;fold 的真相载荷)。 */
  definition: FlowDefinition;
  /**
   * 机械 diff 纯数据(submit 时引擎侧计算;older 日志重放可缺省——
   * 载荷即真相,fold 从 definition-submitted.detail 还原,不重算)。
   */
  diff?: DefinitionDiff;
  requestedBy: { actor: 'human' | 'agent'; principal?: string };
  /** 审批者(铁律 5"审批不委托":approved 时 actor 必为 human)。 */
  approvedBy?: { actor: 'human' | 'agent'; principal?: string };
  rejectedReason?: string;
}
