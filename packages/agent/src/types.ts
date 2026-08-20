/**
 * agent 包公共类型:循环协议的操作词汇、driver 插件接口、轨迹记录。
 *
 * 口径(arch-brief §5/§6):
 * - 每步三种操作 navigate / exec / done(fail 为协议性失败出口);
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

/** 循环每步产出的操作(协议动词;决策全在 driver)。 */
export type AgentOperation =
  | { kind: 'navigate'; rel: string }
  | { kind: 'exec'; action: string; params?: Record<string, unknown> }
  | { kind: 'done'; summary: string }
  | { kind: 'fail'; reason: string };

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
  outcome: 'done' | 'failed' | 'navigated' | 'not-found' | 'executed' | 'rejected';
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
}

/**
 * driver 插件接口:rule driver(本包)与 LLM driver(Phase E)共用。
 * decide 允许异步(LLM 决策要等网络);rule driver 保持同步实现。
 */
export interface AgentDriver {
  decide(context: DriverContext): AgentOperation | Promise<AgentOperation>;
}

export interface RunAgentOptions {
  /** 合同本源,如 http://localhost:3100(不带尾斜杠)。 */
  baseUrl: string;
  fetchImpl: FetchLike;
  /** 步数上限(终止条件之一;缺省 24)。 */
  maxSteps?: number;
  /** 缺省 'agent'(agent 走合同,事件日志可区分双执行者)。 */
  actor?: 'human' | 'agent';
  principal?: string;
  /** 缺省 'http'。 */
  channel?: string;
  /** 起始实体 rel(缺省 articles——种子域的入口集合)。 */
  startRel?: string;
}

export type AgentOutcome = 'done' | 'failed' | 'max-steps';

/** 一次 runAgent 的完整结果:结局 + 可断言的轨迹。 */
export interface AgentRunResult {
  goal: AgentGoal;
  outcome: AgentOutcome;
  /** done 的 summary / failed 的 reason / max-steps 的说明。 */
  summary?: string;
  steps: TrailStep[];
  successes: ExecSuccess[];
}
