/**
 * confirmation 事件链重放(T3:挂起→approve/reject;与在线路径同构)。
 * 载荷即真相:不重新裁决策略;重复送达幂等,缺口响亮失败(日志完整性)。
 */
import type { ConfirmationSnapshot, EngineSnapshot } from '@ui4a/shared';

import {
  confirmationRel,
  type ConfirmationDecisionDetail,
  type ConfirmationRequestDetail,
} from '../../execution/confirmation';
import type { LogEvent } from './log-event';

/** confirmation-requested 重放:pending 实体物化(不重新裁决策略,载荷即真相)。 */
export function applyConfirmationRequested(
  snapshot: EngineSnapshot,
  event: LogEvent,
): EngineSnapshot {
  const detail = event.detail as Partial<ConfirmationRequestDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.id !== 'string' ||
    typeof detail.targetRel !== 'string' ||
    typeof detail.targetAction !== 'string'
  ) {
    throw new Error(
      `重放失败:seq=${event.seq} confirmation-requested 缺少 detail 载荷(日志完整性)`,
    );
  }
  const rel = confirmationRel(detail.id);
  if (snapshot.confirmations?.[rel] !== undefined) {
    throw new Error(`重放失败:seq=${event.seq} 确认 "${rel}" 重复物化(日志完整性)`);
  }
  // 与 suspendForConfirmation 的物化形状逐字段同构(I5 hash 一致的前提):
  // 空参数表/缺信道时不落键,保持与在线构造完全一致。
  const params = event.params;
  const confirmation: ConfirmationSnapshot = {
    id: detail.id,
    targetRel: detail.targetRel,
    targetAction: detail.targetAction,
    ...(params !== undefined && Object.keys(params).length > 0 ? { params } : {}),
    proposedBy: {
      actor: event.actor ?? 'human',
      ...(event.principal !== undefined ? { principal: event.principal } : {}),
    },
    ...(event.channel !== undefined ? { channel: event.channel } : {}),
    status: 'pending',
    ...(typeof detail.policy === 'string' ? { policy: detail.policy } : {}),
    ...(typeof detail.policyReason === 'string' ? { policyReason: detail.policyReason } : {}),
    ...(detail.riskLevel === 'low' || detail.riskLevel === 'medium' || detail.riskLevel === 'high'
      ? { riskLevel: detail.riskLevel }
      : {}),
  };
  return {
    ...snapshot,
    confirmations: { ...(snapshot.confirmations ?? {}), [rel]: confirmation },
  };
}

/** confirmation-approved / rejected 重放:状态流转(实体保留供审计)。 */
export function applyConfirmationDecision(
  snapshot: EngineSnapshot,
  event: LogEvent,
  status: 'approved' | 'rejected',
): EngineSnapshot {
  const detail = event.detail as Partial<ConfirmationDecisionDetail> | undefined;
  if (detail === undefined || typeof detail !== 'object' || typeof detail.id !== 'string') {
    throw new Error(
      `重放失败:seq=${event.seq} confirmation-${status} 缺少 detail 载荷(日志完整性)`,
    );
  }
  const rel = confirmationRel(detail.id);
  const existing = snapshot.confirmations?.[rel];
  if (existing === undefined) {
    throw new Error(`重放失败:seq=${event.seq} 确认 "${rel}" 不存在(日志与状态漂移)`);
  }
  if (existing.status !== 'pending') {
    throw new Error(`重放失败:seq=${event.seq} 确认 "${rel}" 已是 ${existing.status}(重复裁决)`);
  }
  // decidedBy 从 detail 还原(含 principal;与在线 decidedByOf 构造逐字段同构)。
  const decidedBy = detail.decidedBy;
  if (
    decidedBy === undefined ||
    typeof decidedBy !== 'object' ||
    (decidedBy.actor !== 'human' && decidedBy.actor !== 'agent')
  ) {
    throw new Error(`重放失败:seq=${event.seq} confirmation-${status} 缺少 decidedBy(日志完整性)`);
  }
  const updated: ConfirmationSnapshot =
    status === 'approved'
      ? { ...existing, status, approvedBy: decidedBy }
      : { ...existing, status, rejectedReason: event.reason };
  return {
    ...snapshot,
    confirmations: { ...(snapshot.confirmations ?? {}), [rel]: updated },
  };
}

/** notification-delivered 重放:对应确认标记 notified=true(worker 送达事件)。
 *  重复送达(capability 重试)幂等:已 notified 则原快照返回,不抛错;
 *  指向未知确认响亮失败(日志完整性)。 */
export function applyNotificationDelivered(
  snapshot: EngineSnapshot,
  event: LogEvent,
): EngineSnapshot {
  const rel = event.rel;
  if (rel === undefined || rel === '') {
    throw new Error(`重放失败:seq=${event.seq} notification-delivered 缺少 rel(日志完整性)`);
  }
  const existing = snapshot.confirmations?.[rel];
  if (existing === undefined) {
    throw new Error(
      `重放失败:seq=${event.seq} notification-delivered 指向未知确认 "${rel}"(日志完整性)`,
    );
  }
  if (existing.notified === true) {
    return snapshot;
  }
  return {
    ...snapshot,
    confirmations: { ...(snapshot.confirmations ?? {}), [rel]: { ...existing, notified: true } },
  };
}
