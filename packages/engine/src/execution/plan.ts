/**
 * 批量裁决器(T6 / arch-brief §9.4):一次决策输出整段计划,引擎一次事务里
 * 逐步模拟——每步仍做完整三层裁决 + 确认门(executeWithGates 原样复用)。
 *
 * "不是信任计划,是批量裁决计划":
 * - 串行逐步:每步吃**前步产出快照**(计划依赖前序,不是并行批验);
 * - 全过 → plan-completed(全部提交);
 * - 某步拒绝 → 该步 rejection 入 results、停止后续、kind=plan-rejected;
 * - 某步挂起(确认门)→ 入 results、停止后续、kind=plan-suspended
 *   (confirmation 伴随事件照常:pending 实体物化、效果不应用);
 * - 已过步骤的效果/事件**保留**(append-only 日志语义,不回滚,分步报告从
 *   拒点/挂点截断);
 * - 每计划恰一条 `plan-executed` 标记事件(批量裁决记录):detail=分步摘要
 *   {kind, steps:[{step, rel, action, outcome}]};fold 视之为纯标记——状态
 *   由同批各步伴随事件(action-executed / confirmation-requested 族)重放。
 *
 * 空计划口径:engine 返回 plan-completed 空结果(零步平凡为真,零伴随事件,
 * 标记 detail.steps=[]);HTTP 层(/api/exec-plan)按 400 拒绝空 steps——
 * 边界校验是合同层职责,引擎保持全函数。
 *
 * 纯函数:输入计划 + 快照 → 新快照 + 伴随事件 + 标记事件(顺序即日志顺序)。
 */
import type { EngineSnapshot } from '@ui4a/shared';

import type { SuspendedConfirmation } from './confirmation';
import type { EngineEvent } from './effects';
import { executeWithGates, type ExecuteDeps } from './execute';
import type { ExecRequest, JudgeLayer } from './judge';

/** 分步结果:每步裁决可见(outcome + 迁移/追加/拒绝原因/确认摘录)。 */
export interface PlanStepResult {
  /** 步号(1-based,计划内序)。 */
  step: number;
  rel: string;
  action: string;
  outcome: 'executed' | 'suspended' | 'rejected';
  /** executed:迁移目标节点(动作有 transition 效果时)。 */
  to?: string;
  /** executed:本次动作追加的新实例 rel。 */
  appended?: string[];
  /** suspended:确认摘录(id/targetRel/targetAction/params/proposedBy/…)。 */
  confirmation?: SuspendedConfirmation;
  /** rejected:裁决层拒绝(与单步 exec 同一 verdict 形状)。 */
  rejection?: { layer: JudgeLayer; reason: string; detail?: unknown };
}

/** plan-executed 标记事件的 detail 载荷(一条批量裁决记录的分步摘要)。 */
export interface PlanExecutedDetail {
  kind: PlanOutcomeKind;
  steps: { step: number; rel: string; action: string; outcome: PlanStepResult['outcome'] }[];
}

export type PlanOutcomeKind = 'plan-completed' | 'plan-rejected' | 'plan-suspended';

/**
 * 批量裁决结果(discriminated union;plan-suspended 必携确认摘录)。
 * 公共字段:results=分步结果(截至截断点:拒绝/挂起步含于内,其后步骤不出现);
 * snapshot=终态快照(含已过步骤效果,拒绝/挂起点之后未动);events=各步伴随
 * 事件按步序(拒绝步无伴随事件,不含标记);record=批量裁决记录事件
 * (kind=plan-executed,追加在伴随事件之后入日志)。
 */
export type PlanOutcome =
  | {
      kind: 'plan-completed';
      results: PlanStepResult[];
      snapshot: EngineSnapshot;
      events: EngineEvent[];
      record: EngineEvent;
    }
  | {
      kind: 'plan-rejected';
      results: PlanStepResult[];
      snapshot: EngineSnapshot;
      events: EngineEvent[];
      record: EngineEvent;
    }
  | {
      kind: 'plan-suspended';
      results: PlanStepResult[];
      snapshot: EngineSnapshot;
      events: EngineEvent[];
      record: EngineEvent;
      /** 挂起步的确认摘录(顶层便捷字段,与 results 尾项同源)。 */
      confirmation: SuspendedConfirmation;
    };

/** 计划标记事件的 rel(协议锚点;非实体,fold 不物化)。 */
export const PLAN_REL = 'plan';

/** 单步裁决 → 分步结果(伴随事件按序收集;executed 返回推进后的快照)。 */
function adjudicateStep(
  step: number,
  request: ExecRequest,
  snapshot: EngineSnapshot,
  deps: ExecuteDeps,
): { result: PlanStepResult; snapshot: EngineSnapshot; events: EngineEvent[] } {
  const outcome = executeWithGates(request, snapshot, deps);
  if (outcome.kind === 'rejected') {
    const rejection: PlanStepResult['rejection'] =
      outcome.detail === undefined
        ? { layer: outcome.layer, reason: outcome.reason }
        : { layer: outcome.layer, reason: outcome.reason, detail: outcome.detail };
    return {
      result: { step, rel: request.rel, action: request.action, outcome: 'rejected', rejection },
      snapshot,
      events: [],
    };
  }
  if (outcome.kind === 'suspended') {
    return {
      result: {
        step,
        rel: request.rel,
        action: request.action,
        outcome: 'suspended',
        confirmation: outcome.confirmation,
      },
      snapshot: outcome.snapshot,
      events: outcome.events,
    };
  }
  // executed:action-executed 是本步事件链首事件(to/appended 摘要出处)。
  const executed = outcome.events[0];
  return {
    result: {
      step,
      rel: request.rel,
      action: request.action,
      outcome: 'executed',
      ...(executed?.to !== undefined ? { to: executed.to } : {}),
      ...(executed?.appended !== undefined && executed.appended.length > 0
        ? { appended: executed.appended }
        : {}),
    },
    snapshot: outcome.snapshot,
    events: outcome.events,
  };
}

/**
 * 批量裁决主入口:串行逐步 executeWithGates,每步用前步产出快照。
 * 标记事件的 actor/principal/channel 取首步(空计划缺省 human——与
 * executeWithGates 的 actor 缺省口径一致)。
 */
export function executePlan(
  steps: readonly ExecRequest[],
  snapshot: EngineSnapshot,
  deps: ExecuteDeps,
): PlanOutcome {
  const results: PlanStepResult[] = [];
  const events: EngineEvent[] = [];
  let current = snapshot;
  let kind: PlanOutcomeKind = 'plan-completed';
  let confirmation: SuspendedConfirmation | undefined;

  for (let index = 0; index < steps.length; index += 1) {
    const request = steps[index]!;
    const outcome = adjudicateStep(index + 1, request, current, deps);
    results.push(outcome.result);
    events.push(...outcome.events);
    current = outcome.snapshot;
    if (outcome.result.outcome === 'rejected') {
      kind = 'plan-rejected';
      break;
    }
    if (outcome.result.outcome === 'suspended') {
      kind = 'plan-suspended';
      confirmation = outcome.result.confirmation;
      break;
    }
  }

  const first = steps[0];
  const record: EngineEvent = {
    kind: 'plan-executed',
    rel: PLAN_REL,
    action: 'execute',
    actor: first?.actor ?? 'human',
    principal: first?.principal,
    channel: first?.channel,
    ...(first?.identity !== undefined ? { identity: first.identity } : {}),
    detail: {
      kind,
      steps: results.map(({ step, rel, action, outcome }) => ({ step, rel, action, outcome })),
    } satisfies PlanExecutedDetail,
  };

  if (kind === 'plan-suspended' && confirmation !== undefined) {
    return { kind, results, snapshot: current, events, record, confirmation };
  }
  if (kind === 'plan-suspended') {
    // 不可达(引擎完整性):挂起结论必由挂起步产生,摘录同源存在。
    throw new Error('executePlan 内部不变式破坏:plan-suspended 缺少确认摘录');
  }
  return { kind, results, snapshot: current, events, record };
}
