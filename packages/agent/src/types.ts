/**
 * agent 包公共类型:循环协议的操作词汇、driver 插件接口、轨迹记录。
 *
 * 口径(arch-brief §5/§6):
 * - 协议区分只读 answer、导航、业务执行与终止出口;
 * - done 由"完成类动作成功过"相对目标判定——判定在 driver,不在循环;
 * - 拒绝即数据:被拒 exec 与不可达 navigate 都以 RejectionRecord 回流下一步上下文;
 * - 循环零智能:它只搬运实体、执行操作、记录轨迹。
 */
import type { SirenEntity } from '@ui4a/engine';

/** 注入的 fetch 实现(测试脚本化 / 服务端与浏览器真实 fetch 双用;两栖关键)。 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** agent 目标(词级启发式的输入;LLM driver 时代同一形状由模型填充)。 */
export interface AgentGoal {
  /** 目标动词,如「发布」「下线」「审核」。 */
  verb: string;
  /** 点名的资源 rel(如 post:post-welcome)。 */
  targetRel?: string;
  /** 点名的资源名(如 post-welcome;子实体/链接子串匹配用)。 */
  resource?: string;
  /** 表单值字典(向导各步从中按 schema 取参)。 */
  fields?: Record<string, unknown>;
}

/** 回答事实来源:实体 rel + 指向授权 Siren 快照的 JSON Pointer。 */
export interface FactRef {
  rel: string;
  pointer: string;
}

/**
 * 一次授权合同观察。entity 是 HTTP 合同已经按 principal 过滤后的完整 Siren
 * 快照；Agent 只能基于这些观察回答，不能把模型输出反向当成合同事实。
 */
export interface ContractObservation {
  rel: string;
  entity: SirenEntity;
}

/** 循环每步产出的操作(协议动词;决策全在 driver)。 */
export type AgentOperation =
  | { kind: 'navigate'; rel: string }
  | { kind: 'answer'; content: string; sources: FactRef[] }
  | { kind: 'exec'; action: string; params?: Record<string, unknown> }
  | {
      kind: 'exec-plan';
      steps: { rel: string; action: string; params?: Record<string, unknown> }[];
    }
  | { kind: 'done'; summary: string }
  | { kind: 'fail'; reason: string; evidence?: string[] };

/**
 * 一次拒绝(navigate 不可达记 layer 'not-found';exec 拒绝携带合同的结构化原因)。
 * 拒绝是数据:进轨迹、回流下一步决策上下文。
 */
export interface RejectionRecord {
  rel: string;
  action?: string;
  params?: Record<string, unknown>;
  layer?: string;
  reason: string;
  detail?: unknown;
}

/** 已成功的 exec(done 判定的原料:「完成类动作成功过」)。 */
export interface ExecSuccess {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
}

/** 实体快照摘要(轨迹断言用:rel/class/node/count/动作清单)。 */
export interface EntitySummary {
  rel: string;
  class: string[];
  node?: string;
  count?: number;
  actions: string[];
}

/** 轨迹一步:操作 + 结果 + 操作后实体摘要。 */
export interface TrailStep {
  step: number;
  /** 操作发生(或目标)的实体 rel。 */
  rel: string;
  op: AgentOperation;
  outcome:
    | 'answered'
    | 'done'
    | 'failed'
    | 'navigated'
    | 'not-found'
    | 'executed'
    | 'suspended'
    | 'rejected';
  entity?: EntitySummary;
  rejection?: RejectionRecord;
}

/** driver 决策上下文(循环是协议,driver 是插件——这是插件的全部视野)。 */
export interface DriverContext {
  goal: AgentGoal;
  currentRel: string;
  entity: SirenEntity;
  trail: TrailStep[];
  successes: ExecSuccess[];
  lastRejection?: RejectionRecord;
  /**
   * 本轮 run 已读取的有界授权观察，按最近访问顺序排列。循环按 rel 去重并
   * 刷新快照；可选是为旧的外部协议 fixture 保持源码兼容，runAgent 始终提供。
   */
  observations?: ContractObservation[];
  /**
   * 应用 sitemap(版本级缓存结构的最外层,架构规定它是 agent 的静态上下文):
   * surfaces 的 rel/title 供自由漫游层把目标动词映射到可达表面(flow 入口);
   * applications 按 app 分组呈现发现面(T10 两层发现:选 app〔读 intent〕→ 选 flow)。
   * 可选:循环拿不到 sitemap(端点缺失)时为 undefined,driver 须能退化为仅用实体。
   */
  sitemap?: SitemapSummary;
  /**
   * role/app 上下文槽位(T10 Phase D,架构决定 6):角色职责组合的数据载体
   * (D19 路线 T3/T5 的钩子)。值由 RunAgentOptions 注入,循环原样随行每步
   * 上下文;空槽(未提供)= 现状,零行为变化——prompt 只装不变协议核心。
   */
  role?: string;
  app?: string;
}

/** application 分组的 agent 投影:两层发现第一层(name + intent + 组内 flow 摘要)。 */
export interface SitemapApplicationSummary {
  name: string;
  intent: string;
  flows: { name: string; title: string }[];
}

/** sitemap 中 driver 需要的最小投影(surfaces 的 rel/title + applications 分组)。 */
export interface SitemapSummary {
  version: string;
  surfaces: { rel: string; title: string }[];
  /**
   * 按 app 分组的发现面(T10):agent 先读 intent 定位 app,再在组内选 flow。
   * 端点未提供(旧形状)时解析为空数组;扁平 surfaces 始终保留(向后兼容)。
   */
  applications: SitemapApplicationSummary[];
}

/**
 * decide 的观测通道(T11 Phase C / spec 架构决定 4):driver 决策产出推理自述时
 * 回调一次(聚合整段——D22 探针:GLM reasoning 非增量、末尾齐发,不是打字机)。
 * 不产生 reasoning 的 driver(rule driver)零回调;decide 永不抛异常的口径覆盖
 * 观测调用本身(观测者不得污染协议)。
 */
export interface DecideSink {
  onReasoning?(text: string): void;
  /**
   * 增量回调:reasoning 片段到达即转发(逐 raw chunk,与聚合回调并存)。
   * 聚合 onReasoning 仍是权威终态(审计口径);观测者异常同样不得污染协议。
   */
  onReasoningDelta?(piece: string): void;
}

/**
 * driver 插件接口:rule driver(本包)与 LLM driver(Phase E)共用。
 * decide 允许异步(LLM 决策要等网络);rule driver 保持同步实现。
 * sink 为可选第二参(向后兼容:单参实现的 mock/既有 driver 零改动)。
 */
export interface AgentDriver {
  decide(context: DriverContext, sink?: DecideSink): AgentOperation | Promise<AgentOperation>;
}

export interface RunAgentOptions {
  /** 合同本源,如 http://localhost:3100(不带尾斜杠)。 */
  baseUrl: string;
  fetchImpl: FetchLike;
  /** 步数上限(终止条件之一;缺省 24)。 */
  maxSteps?: number;
  /** 授权观察账本最多保留的不同实体数(缺省 8，最小 1)。 */
  maxObservations?: number;
  /** 缺省 'agent'(agent 走合同,事件日志可区分双执行者)。 */
  actor?: 'human' | 'agent';
  principal?: string;
  /** 缺省 'http'。 */
  channel?: string;
  /** 起始实体 rel(缺省 articles——种子域的入口集合)。 */
  startRel?: string;
  /**
   * role/app 上下文槽位(T10 Phase D):原样注入每步 DriverContext,
   * LLM driver 据此渲染 SYSTEM_PROMPT 槽位;缺省 = 空槽,零行为变化。
   */
  role?: string;
  app?: string;
  /**
   * 流式轨迹回调(T9 Phase B):循环每次 trail.push 后同步调用
   * (navigate/exec/done/fail 各结局全覆盖)——聊天路由据此逐步推 SSE 帧。
   * 回调抛错不拦截循环(观测者不得污染协议);调用方自行兜底。
   */
  onStep?(step: TrailStep): void;
  /**
   * 推理自述回调(T11 Phase C):llm 步的 decide 产出 reasoning 时回调一次
   * (聚合整段,非打字机——D22:GLM reasoning 末尾齐发);rule driver 零回调。
   * 与 onStep 同口径:回调抛错不拦截循环。
   */
  onReasoning?(text: string): void;
  /**
   * 推理增量回调:reasoning 片段到达即转发(逐 raw chunk)。当前 GLM 端
   * 末尾齐发(D22),增量与聚合几乎同刻;管线为真流式就绪。聚合通道
   * (onReasoning/审计)语义不变;抛错不拦截循环口径同上。
   */
  onReasoningDelta?(piece: string): void;
}

export type AgentOutcome = 'answered' | 'done' | 'failed' | 'suspended' | 'max-steps';

/** 一次 runAgent 的完整结果:结局 + 可断言的轨迹。 */
export interface AgentRunResult {
  goal: AgentGoal;
  outcome: AgentOutcome;
  /** done/suspended 的 summary / failed 的 reason / max-steps 的说明。 */
  summary?: string;
  /** answered 时回答所引用的授权合同事实。 */
  sources?: FactRef[];
  steps: TrailStep[];
  successes: ExecSuccess[];
}
