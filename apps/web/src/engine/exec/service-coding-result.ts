/**
 * coding-result 预检与事件装饰(T55/D76 自 service.ts exec 闭包迁入,行为逐字):
 * 目标实例的活跃定义中若声明了 decision 动作,先经 preflightCodingResultDecision
 * 预检(Agent Run 结果裁决);denied/stale → guard-failed 拒绝留痕(拒绝即数据
 * I6)短路返回;approved → action-executed 事件装饰 codingDecision receipt
 * (仅该 kind;伴随事件原样)。
 */
import {
  activeDefinitionOf,
  type EngineEvent,
  type ExecRequest,
} from '@ui4a/engine';

import type { DbExecutor, EventAppend } from '@ui4a/db/events';
import { preflightCodingResultDecision } from '../agent/coding-result-decision';
import { persistRejection } from '../service-confirmation';
import type { CoreEventLogState } from '../service-event-log';
import type { ExecOutcome } from '../service-outcome';

export async function resolveCodingResultDecision(args: {
  db: DbExecutor;
  logState: CoreEventLogState;
  toAppend: (event: EngineEvent) => EventAppend;
  aliased: ExecRequest;
  events: readonly EngineEvent[];
}): Promise<ExecOutcome | { effectiveEvents: readonly EngineEvent[] }> {
  const { db, logState, toAppend, aliased, events } = args;
  const decisionInstance = logState.snapshot.instances[aliased.rel];
  const decisionFlow =
    decisionInstance === undefined
      ? undefined
      : activeDefinitionOf(logState.snapshot, decisionInstance.flow);
  const decisionAction = decisionFlow?.nodes
    .find((node) => node.name === decisionInstance?.node)
    ?.actions.find((action) => action.name === aliased.action);
  if (decisionAction?.decision === undefined) {
    return { effectiveEvents: events };
  }
  const decision = await preflightCodingResultDecision(
    db,
    logState.snapshot,
    aliased,
    decisionAction,
  );
  if (
    decision !== undefined &&
    (decision.decision === 'denied' || decision.decision === 'stale')
  ) {
    return persistRejection(db, logState, toAppend, aliased, {
      layer: 'guard-failed',
      reason: decision.reason,
      detail: decision,
    });
  }
  if (decision === undefined) {
    return { effectiveEvents: events };
  }
  return {
    effectiveEvents: events.map((event) =>
      event.kind === 'action-executed'
        ? {
            ...event,
            detail: {
              ...(event.detail as Record<string, unknown>),
              codingDecision: decision.receipt,
            },
          }
        : event,
    ),
  };
}
