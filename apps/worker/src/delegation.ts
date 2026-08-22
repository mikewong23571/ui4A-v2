/**
 * delegation 步进核心(T5 Phase A / spec 架构决定 1):worker 版 agent 循环。
 *
 * 复用方式(最小侵入,@ui4a/agent 既有公共面零改动):不改造 runAgent 为可注入
 * executor——runAgent 是一体 async 循环,无法在 Temporal 的逐步 activity 边界
 * 停顿;改为复用其全部构件:createDriver(llm 工厂;配置来自外部 env)、
 * createContractClient(/api/entity+/api/exec+sitemap 的 fetch 封装)、
 * summarizeEntity、轨迹/拒绝/上下文类型。本模块把 runAgent 的循环体拆成
 * **单步可调用**形态(runAgentStep),语义逐条对齐:
 * - navigate:立即取目标实体,成功切 rel / 404 记 not-found 并回流;
 * - exec:POST /api/exec;2xx 记 executed / 4xx·网络故障记 rejected 并回流;
 * - done / fail:终止(由 workflow 落终态事件);
 * - 拒绝即数据(I6):lastRejection 只影响紧接着的下一步(消费即清——
 *   清空动作在 workflow 侧的 applyStepToState,与 runAgent 同口径);
 * - 起始实体不可得:不产轨迹步,直接 fail 出口(runAgent 同口径);
 * - sitemap 是静态上下文,循环外取一次(fetchSitemap),逐步注入。
 *
 * 幂等与确定性(Temporal 重放,arch-brief §3/§4):
 * - 决策(含 LLM 网络)+ 执行 + 步事件落库全部在本 activity 内——workflow
 *   代码只做纯数据推导(applyStepToState),重放天然确定;
 * - activity 重试的幂等恢复:该步 delegation-step 事件已落库(进程被杀于
 *   落库后、完成回执前)→ 直接返回事件记录的步结果,不重执行、不双写;
 *   落库前被杀 → 重试重执行(引擎单 atom 串行,重复 exec 被状态机拒绝并
 *   留痕——拒绝也是合同的一部分,委托不崩溃)。
 */
import { createContractClient, createDriver, summarizeEntity } from '@ui4a/agent';
import type {
  AgentDriver,
  AgentOperation,
  DriverContext,
  FetchLike,
  RejectionRecord,
  SitemapSummary,
} from '@ui4a/agent';

import type { DbExecutor, EventKind } from '../../web/src/db/events';
import { appendEvent, ensureEventsTable } from '../../web/src/db/events';

import type {
  AgentStepArgs,
  AgentStepResult,
  DelegationFinishArgs,
  DelegationStartArgs,
} from './workflows';

// workflow 侧契约类型的再导出(单测/调用方单入口;类型定义在 workflows.ts——
// workflow bundle 只需类型与纯函数,activity 侧在此承载运行时)。
export type { AgentStepArgs, AgentStepResult, DelegationFinishArgs, DelegationStartArgs };

/** 委托事件的信道标记(与 notify 的 'notify' 同风格;事件日志可区分来源)。 */
export const DELEGATION_CHANNEL = 'delegation';

/**
 * delegation-step 事件的 detail 载荷:步号 + 步结果 + 推理自述(activity 重试的
 * 恢复输入)。reasoning 恒落库(T11 / spec 架构决定 3:无则 null,与 agent-decision
 * 同口径;llm 路径自 Phase C streamText 改造起填真值);幂等恢复对旧事件
 * (无 reasoning 字段)读出兼容。
 */
export interface DelegationStepRecord extends AgentStepResult {
  step: number;
  /** 推理自述:llm 路径为 driver 产出的聚合整段;scripted/mock 路径恒 null。 */
  reasoning: string | null;
}

export interface AgentStepDeps {
  db: DbExecutor;
  fetchImpl: FetchLike;
  /** 仅供协议测试注入 scripted/mock driver；产品缺省始终构造 llm。 */
  driver?: AgentDriver;
}

/** 委托实体 rel(rel=delegation:<workflowId>;与 engine 投影的 delegationRel 同口径)。 */
export function delegationRel(delegationId: string): string {
  return `delegation:${delegationId}`;
}

// ---- 事件落库(kind+rel 查重幂等;与 notify activity 同方案)----------------

/** (kind, rel) 存在性检查:首尾事件每委托至多一条。 */
async function findEventSeq(db: DbExecutor, kind: string, rel: string): Promise<number | null> {
  const result = await db.query<{ seq: string | number }>(
    'SELECT seq FROM events WHERE kind = $1 AND rel = $2 LIMIT 1',
    [kind, rel],
  );
  return (result.rowCount ?? 0) > 0 ? Number(result.rows[0]!.seq) : null;
}

interface DelegationEventAppend {
  kind: EventKind;
  rel: string;
  detail: unknown;
  principal?: string;
  reason?: string;
}

/** 幂等追加(已存在即跳过;返回命中 seq 与 deduplicated 标记)。 */
async function appendOnce(
  db: DbExecutor,
  event: DelegationEventAppend,
): Promise<{ seq: number; deduplicated: boolean }> {
  await ensureEventsTable(db);
  const existing = await findEventSeq(db, event.kind, event.rel);
  if (existing !== null) {
    return { seq: existing, deduplicated: true };
  }
  const appended = await appendEvent(db, {
    kind: event.kind,
    rel: event.rel,
    actor: 'agent',
    principal: event.principal,
    channel: DELEGATION_CHANNEL,
    reason: event.reason,
    detail: event.detail,
  });
  return { seq: appended.seq, deduplicated: false };
}

/** delegation-started:委托首事件(detail=goal/driverKind/startRel;幂等)。 */
export async function recordDelegationStart(
  db: DbExecutor,
  args: DelegationStartArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return appendOnce(db, {
    kind: 'delegation-started',
    rel: delegationRel(args.delegationId),
    principal: args.principal,
    detail: {
      delegationId: args.delegationId,
      goal: args.goal,
      driverKind: args.driverKind,
      startRel: args.startRel,
      ...(args.principal !== undefined ? { principal: args.principal } : {}),
    },
  });
}

/** 终态 outcome → 事件 kind。 */
const TERMINAL_KINDS = {
  completed: 'delegation-completed',
  failed: 'delegation-failed',
  'max-steps': 'delegation-max-steps',
} as const;

/** delegation-completed | failed | max-steps:终事件(幂等;failed/max-steps 带 reason)。 */
export async function recordDelegationFinish(
  db: DbExecutor,
  args: DelegationFinishArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return appendOnce(db, {
    kind: TERMINAL_KINDS[args.outcome],
    rel: delegationRel(args.delegationId),
    principal: args.principal,
    reason: args.reason,
    detail: {
      steps: args.steps,
      successes: args.successes,
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    },
  });
}

// ---- sitemap 静态上下文(循环外取一次;不可得则 driver 退化为仅实体导航)----

export async function fetchSitemap(
  baseUrl: string,
  fetchImpl: FetchLike,
): Promise<SitemapSummary | undefined> {
  return createContractClient(baseUrl, fetchImpl).getSitemap();
}

// ---- 步核心:决策 + 执行 + 步事件落库 --------------------------------------

/**
 * 该步 delegation-step 已落库?→ 返回事件记录的步结果(幂等恢复路径:
 * activity 在落库后、回执前被杀,重试不重执行不双写)。
 */
async function findRecordedStep(
  db: DbExecutor,
  delegationId: string,
  step: number,
): Promise<AgentStepResult | undefined> {
  const result = await db.query<{ detail: unknown }>(
    "SELECT detail FROM events WHERE kind = 'delegation-step' AND rel = $1 ORDER BY seq ASC",
    [delegationRel(delegationId)],
  );
  for (const row of result.rows) {
    const detail = row.detail as Partial<DelegationStepRecord> | null;
    if (
      detail !== null &&
      typeof detail === 'object' &&
      detail.step === step &&
      detail.op !== undefined &&
      typeof detail.outcome === 'string'
    ) {
      return {
        op: detail.op,
        outcome: detail.outcome,
        ...(detail.entitySummary !== undefined ? { entitySummary: detail.entitySummary } : {}),
        ...(detail.rejection !== undefined ? { rejection: detail.rejection } : {}),
        // 旧事件(T11 前)无 reasoning 键:不补——恢复载荷与存量 detail 同构,
        // 缺省即"未产生"(与 detail 落库的 null 同口径,见 DelegationStepRecord)。
        ...(detail.reasoning !== undefined ? { reasoning: detail.reasoning } : {}),
      };
    }
  }
  return undefined;
}

/** 单步核心(db+fetch 注入,单测零网络零 PG;runAgent 语义的步进化)。 */
export async function runAgentStep(
  deps: AgentStepDeps,
  args: AgentStepArgs,
): Promise<AgentStepResult> {
  await ensureEventsTable(deps.db);
  const recovered = await findRecordedStep(deps.db, args.delegationId, args.step);
  if (recovered !== undefined) {
    return recovered;
  }

  const client = createContractClient(args.baseUrl, deps.fetchImpl);
  const fetched = await client.getEntity(args.currentRel);
  if (fetched.entity === undefined) {
    // 当前实体不可得(runAgent 同口径:failed 出口,不产轨迹步、不落步事件——
    // unrecorded 标记让 workflow 跳过状态推导,保持步计数与步事件一致)。
    return {
      op: { kind: 'fail', reason: fetched.error ?? `实体 "${args.currentRel}" 不可得` },
      outcome: 'failed',
      unrecorded: true,
    };
  }

  // 上下文是逐步快照(trail/successes 拷贝传入,与 runAgent 同口径)。
  const context: DriverContext = {
    goal: args.goal,
    currentRel: args.currentRel,
    entity: fetched.entity,
    trail: [...args.trail],
    successes: [...args.successes],
    lastRejection: args.lastRejection,
    sitemap: args.sitemap,
  };
  const driver = deps.driver ?? createDriver('llm');
  // 推理自述捕获(T11 Phase C):llm driver 决策产出 reasoning 时经 sink 回调
  // 一次(聚合整段,D22);scripted/mock driver 零回调,reasoning 保持 null。
  let reasoning: string | null = null;
  let op: AgentOperation;
  try {
    op = await driver.decide(context, {
      onReasoning: (text) => {
        reasoning = text;
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知模型错误';
    op = { kind: 'fail', reason: `LLM 委托失败: ${detail}。可重试。` };
  }
  // reasoning 仅在产生时挂键(条件 spread):无 reasoning 时结果形状与 T11 前逐键一致;
  // recordStep 落库恒写 reasoning 字段(无则 null,DelegationStepRecord 口径)。
  const decisionExtra = reasoning !== null ? { reasoning } : {};

  if (op.kind === 'done' || op.kind === 'fail') {
    // 终止决策同样产轨迹步(runAgent 同口径);终态事件由 workflow 随后落。
    return recordStep(deps.db, args, {
      op,
      outcome: op.kind === 'done' ? 'done' : 'failed',
      ...decisionExtra,
    });
  }

  if (op.kind === 'navigate') {
    const target = await client.getEntity(op.rel);
    if (target.entity !== undefined) {
      return recordStep(deps.db, args, {
        op,
        outcome: 'navigated',
        entitySummary: summarizeEntity(target.entity),
        ...decisionExtra,
      });
    }
    const rejection: RejectionRecord = {
      rel: op.rel,
      layer: 'not-found',
      reason: target.error ?? `实体 "${op.rel}" 不可达`,
    };
    return recordStep(deps.db, args, { op, outcome: 'not-found', rejection, ...decisionExtra });
  }

  if (op.kind === 'answer') {
    return recordStep(deps.db, args, { op, outcome: 'answered', ...decisionExtra });
  }

  if (op.kind === 'clarify') {
    return recordStep(deps.db, args, {
      op,
      outcome: 'clarification-needed',
      ...decisionExtra,
    });
  }

  if (op.kind === 'exec-plan') {
    const call = await client.execPlan({
      steps: op.steps,
      actor: 'agent',
      principal: args.principal,
      channel: DELEGATION_CHANNEL,
    });
    if (call.outcome === 'completed') {
      return recordStep(deps.db, args, { op, outcome: 'executed', ...decisionExtra });
    }
    if (call.outcome === 'suspended') {
      return recordStep(deps.db, args, { op, outcome: 'suspended', ...decisionExtra });
    }
    const rejection: RejectionRecord = {
      rel: args.currentRel,
      action: 'exec-plan',
      layer: 'plan',
      reason: call.reason ?? `exec-plan 被拒(HTTP ${call.status})`,
    };
    return recordStep(deps.db, args, { op, outcome: 'rejected', rejection, ...decisionExtra });
  }

  const call = await client.exec({
    rel: args.currentRel,
    action: op.action,
    params: op.params ?? {},
    actor: 'agent',
    principal: args.principal,
    channel: DELEGATION_CHANNEL,
  });
  if (call.ok) {
    return recordStep(deps.db, args, {
      op,
      outcome: 'executed',
      ...(call.entity !== undefined ? { entitySummary: summarizeEntity(call.entity) } : {}),
      ...decisionExtra,
    });
  }
  if (call.suspended === true) {
    return recordStep(deps.db, args, { op, outcome: 'suspended', ...decisionExtra });
  }
  const rejection: RejectionRecord = {
    rel: args.currentRel,
    action: op.action,
    params: op.params,
    layer: call.layer,
    reason: call.reason ?? `exec 被拒(HTTP ${call.status})`,
    detail: call.detail,
  };
  return recordStep(deps.db, args, { op, outcome: 'rejected', rejection, ...decisionExtra });
}

/** 步结果落库(delegation-step;detail=载荷即真相,重试恢复的输入)并回传。 */
async function recordStep(
  db: DbExecutor,
  args: AgentStepArgs,
  result: AgentStepResult,
): Promise<AgentStepResult> {
  await appendEvent(db, {
    kind: 'delegation-step',
    rel: delegationRel(args.delegationId),
    actor: 'agent',
    principal: args.principal,
    channel: DELEGATION_CHANNEL,
    detail: {
      step: args.step,
      op: result.op,
      outcome: result.outcome,
      // reasoning 恒落库(T11:无则 null);llm 路径自 Phase C streamText 改造起
      // 由 driver 决策时的 sink 回调捕获,经 result.reasoning 自然流出真值。
      reasoning: result.reasoning ?? null,
      ...(result.entitySummary !== undefined ? { entitySummary: result.entitySummary } : {}),
      ...(result.rejection !== undefined ? { rejection: result.rejection } : {}),
    },
  });
  return result;
}
