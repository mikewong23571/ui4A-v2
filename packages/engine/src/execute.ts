/**
 * exec 编排层:三层裁决(声明→guard→schema)→ 确认裁决(策略层)→ 效果应用。
 *
 * arch-brief §3 guard 第三语义的落点:三层全过之后、效果应用**之前**插入
 * confirmGate——需确认则挂起(动作转入 pending 而非被拒绝,效果不应用);
 * 无需确认则照常 applyEffects。web 服务层(Phase B)以本函数替换裸
 * judge+applyEffects 组合,HTTP 层据此映射 200(executed)/202(suspended)/4xx(rejected)。
 *
 * 纯函数:输入请求 + 快照 → 新快照 + 待追加事件(顺序即日志顺序)。
 */
import type { EngineSnapshot, GuardRegistry } from '@ui4a/shared';

import {
  confirmGate,
  suspendForConfirmation,
  type ConfirmationPolicy,
  type SuspendedConfirmation,
} from './confirmation';
import { applyEffects, type EngineEvent } from './effects';
import { judge, type DefinitionVersionTable, type ExecRequest, type JudgeLayer } from './judge';
import type { ExecutionJudgmentDetail } from './execution-audit';
import type { FlowDefinition } from './types';

/** 编排依赖:flow 注册表 + guard 注册表 + 确认策略(缺省内置,Phase B 注入 Cedar)。 */
export interface ExecuteDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
  guards: GuardRegistry;
  policy?: ConfirmationPolicy;
  /** 按出生版本解析的注册表(T4 Phase B,与 JudgeDeps 同口径;缺省回退 flows)。 */
  versions?: DefinitionVersionTable;
}

/** exec 编排结果(discriminated union;suspended 是挂起,不是拒绝)。 */
export type ExecWithGatesOutcome =
  | { kind: 'executed'; snapshot: EngineSnapshot; events: EngineEvent[] }
  | {
      kind: 'suspended';
      snapshot: EngineSnapshot;
      events: EngineEvent[];
      confirmation: SuspendedConfirmation;
    }
  | { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };

/** Pure audit event factory for a rejected request; rejection still has no state effect. */
export function actionRejectedEvent(
  request: ExecRequest,
  verdict: { layer: JudgeLayer; reason: string; detail?: unknown },
  additionalDetail: Record<string, unknown> = {},
): EngineEvent {
  return {
    kind: 'action-rejected',
    rel: request.rel,
    action: request.action,
    actor: request.actor ?? 'human',
    principal: request.principal,
    channel: request.channel,
    ...(request.identity !== undefined ? { identity: request.identity } : {}),
    reason: verdict.reason,
    detail: { layer: verdict.layer, judge: verdict.detail, ...additionalDetail },
  };
}

/**
 * 编排主入口:judge(三层)→ confirmGate(策略)→ applyEffects(效果)。
 * 拒绝结果原样透传 judge(拒绝即数据 I6,由调用方入日志);
 * 挂起结果不改业务状态,只物化 pending 确认实体与 confirmation-requested 事件。
 */
export function executeWithGates(
  request: ExecRequest,
  snapshot: EngineSnapshot,
  deps: ExecuteDeps,
): ExecWithGatesOutcome {
  const verdict = judge(request, snapshot, deps);
  if (verdict.kind === 'rejected') {
    return verdict;
  }

  const gate = confirmGate(request, verdict.action, deps.policy);
  const execution: ExecutionJudgmentDetail = {
    ...(request.authorization !== undefined ? { authorization: { ...request.authorization } } : {}),
    declaration: { passed: true },
    guards: verdict.guards.map((guard) => ({ ...guard })),
    schema: { passed: true },
    confirmation: {
      required: gate.required,
      status: gate.required ? 'pending' : 'not-required',
      policy: gate.policy,
      reason: gate.reason,
    },
  };
  if (gate.required) {
    const suspended = suspendForConfirmation(request, verdict.action, gate, snapshot);
    return {
      kind: 'suspended',
      ...suspended,
      events: suspended.events.map((event) => ({
        ...event,
        detail: { ...(event.detail as Record<string, unknown>), execution },
      })),
    };
  }

  const outcome = applyEffects(request, verdict.effects, snapshot, {
    flows: deps.flows,
    versions: deps.versions,
  });
  return {
    kind: 'executed',
    ...outcome,
    events: outcome.events.map((event) =>
      event.kind === 'action-executed'
        ? { ...event, detail: { ...(event.detail as Record<string, unknown>), execution } }
        : event,
    ),
  };
}
