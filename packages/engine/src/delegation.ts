/**
 * 委托实体(T5 Phase A / spec 架构决定 2):delegation 事件族的 fold 重放与
 * rel 约定。放在 engine(与 confirmation 同口径):fold 是"应用核心"本体,
 * 日志形状(事件 detail 载荷)是引擎公共合同的一部分。
 *
 * 事件族(worker delegationWorkflow 经 activity 写入,同一 PG 日志的第二写者):
 * - delegation-started:物化 running 委托(幂等在 activity 层——同 kind+rel
 *   查重;fold 对重复物化响亮抛错,与 confirmation-requested 同口径);
 * - delegation-step:步数递增,**detail.step 必须连续无缺口**(S3-续跑的
 *   正确性断言在 fold 层即成立:缺口/重复/乱序 = 日志完整性破坏);
 *   outcome=executed 计一次成功;逐步轨迹(op/outcome/entitySummary/rejection)
 *   留在日志本身,快照只持计数(事件历史即轨迹,arch-brief §4);
 * - delegation-completed | failed | max-steps:终态落 status(重复终态抛错)。
 */
import type { DelegationGoal, DelegationSnapshot, EngineSnapshot } from '@ui4a/shared';

import type { LogEvent } from './fold';

/** delegations 集合实体 rel(舰队页数据源;空集合也是合法集合,非 404)。 */
export const DELEGATIONS_REL = 'delegations';

/** 委托实体 rel:`delegation:<workflowId>`。 */
export function delegationRel(id: string): string {
  return `delegation:${id}`;
}

/** delegation-started 事件的 detail 载荷(委托身份与起点)。 */
export interface DelegationStartedDetail {
  delegationId: string;
  goal: DelegationGoal;
  driverKind: string;
  startRel: string;
  principal?: string;
}

/** delegation-step 事件的 detail 载荷(载荷即真相:worker 侧 AgentStepResult + step)。 */
export interface DelegationStepDetail {
  step: number;
  op: { kind: string } & Record<string, unknown>;
  outcome: string;
  entitySummary?: unknown;
  rejection?: { reason: string } & Record<string, unknown>;
}

/** delegation-completed|failed|max-steps 事件的 detail 载荷。 */
export interface DelegationTerminalDetail {
  steps: number;
  successes: number;
  summary?: string;
  reason?: string;
}

/** 终态事件 kind → 快照 status。 */
const TERMINAL_STATUS = {
  'delegation-completed': 'completed',
  'delegation-failed': 'failed',
  'delegation-max-steps': 'max-steps',
} as const;

export type DelegationTerminalKind = keyof typeof TERMINAL_STATUS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDelegationGoal(value: unknown): value is DelegationGoal {
  return isRecord(value) && typeof value.verb === 'string' && value.verb !== '';
}

/** delegation-started 重放:物化 running 委托(重复物化 = 日志完整性破坏)。 */
export function applyDelegationStarted(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DelegationStartedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.delegationId !== 'string' ||
    !isDelegationGoal(detail.goal) ||
    typeof detail.driverKind !== 'string' ||
    typeof detail.startRel !== 'string'
  ) {
    throw new Error(
      `重放失败:seq=${event.seq} delegation-started 缺少 detail 载荷(日志完整性)`,
    );
  }
  const rel = event.rel;
  if (rel === undefined || rel !== delegationRel(detail.delegationId)) {
    throw new Error(
      `重放失败:seq=${event.seq} delegation-started 的 rel "${rel ?? ''}" 与 delegationId "${detail.delegationId}" 不一致(日志完整性)`,
    );
  }
  if (snapshot.delegations?.[rel] !== undefined) {
    throw new Error(`重放失败:seq=${event.seq} 委托 "${rel}" 重复物化(日志完整性)`);
  }
  const delegation: DelegationSnapshot = {
    id: detail.delegationId,
    goal: detail.goal,
    driverKind: detail.driverKind,
    startRel: detail.startRel,
    ...(typeof detail.principal === 'string' ? { principal: detail.principal } : {}),
    status: 'running',
    steps: 0,
    successes: 0,
  };
  return {
    ...snapshot,
    delegations: { ...(snapshot.delegations ?? {}), [rel]: delegation },
  };
}

/**
 * delegation-step 重放:步数递增(outcome=executed 计成功)。
 * detail.step 必须等于当前步数 + 1——缺口/重复/乱序都是日志完整性破坏
 * (S3-续跑"事件序列连续无缺口"的断言口径)。
 */
export function applyDelegationStep(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DelegationStepDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.step !== 'number' ||
    !Number.isInteger(detail.step) ||
    detail.step < 1 ||
    !isRecord(detail.op) ||
    typeof detail.op.kind !== 'string' ||
    typeof detail.outcome !== 'string'
  ) {
    throw new Error(
      `重放失败:seq=${event.seq} delegation-step 缺少 detail 载荷(日志完整性)`,
    );
  }
  const rel = event.rel ?? '';
  const existing = snapshot.delegations?.[rel];
  if (existing === undefined) {
    throw new Error(`重放失败:seq=${event.seq} delegation-step 委托 "${rel}" 不存在(日志与状态漂移)`);
  }
  const expected = existing.steps + 1;
  if (detail.step !== expected) {
    throw new Error(
      `重放失败:seq=${event.seq} delegation-step 步号 ${detail.step} 不连续(期望 ${expected};日志完整性)`,
    );
  }
  const updated: DelegationSnapshot = {
    ...existing,
    steps: expected,
    successes: detail.outcome === 'executed' ? existing.successes + 1 : existing.successes,
  };
  return {
    ...snapshot,
    delegations: { ...(snapshot.delegations ?? {}), [rel]: updated },
  };
}

/** 终态重放:status 落定 + summary/reason 留痕;计数与步事件折叠值交叉核对
 *  (不一致 = 日志漂移,响亮失败;非 running 即重复终态,同样抛错)。 */
export function applyDelegationTerminal(
  snapshot: EngineSnapshot,
  event: LogEvent,
  kind: DelegationTerminalKind,
): EngineSnapshot {
  const detail = event.detail as Partial<DelegationTerminalDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.steps !== 'number' ||
    typeof detail.successes !== 'number'
  ) {
    throw new Error(`重放失败:seq=${event.seq} ${kind} 缺少 detail 载荷(日志完整性)`);
  }
  const rel = event.rel ?? '';
  const existing = snapshot.delegations?.[rel];
  if (existing === undefined) {
    throw new Error(`重放失败:seq=${event.seq} ${kind} 委托 "${rel}" 不存在(日志与状态漂移)`);
  }
  if (existing.status !== 'running') {
    throw new Error(
      `重放失败:seq=${event.seq} ${kind} 时委托 "${rel}" 已是 ${existing.status}(期望 running;日志完整性)`,
    );
  }
  if (detail.steps !== existing.steps || detail.successes !== existing.successes) {
    throw new Error(
      `重放失败:seq=${event.seq} ${kind} 计数与步事件不一致(detail steps=${detail.steps}, successes=${detail.successes};已折叠 steps=${existing.steps}, successes=${existing.successes};日志完整性)`,
    );
  }
  const updated: DelegationSnapshot = {
    ...existing,
    status: TERMINAL_STATUS[kind],
    ...(typeof detail.summary === 'string' ? { summary: detail.summary } : {}),
    ...(typeof detail.reason === 'string' ? { reason: detail.reason } : {}),
  };
  return {
    ...snapshot,
    delegations: { ...(snapshot.delegations ?? {}), [rel]: updated },
  };
}
