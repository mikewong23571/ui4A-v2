/**
 * 确认实体裁决与拒绝留痕(自 service.ts 拆出,行为不变):rel=confirmation:<id>
 * 实体上的 approve/reject 路由到引擎人类裁决入口(铁律 5:审批不委托,guard
 * actor-is-human 在引擎层拒 agent,I4);guard/schema 拒绝同样留痕。
 */
import {
  actionRejectedEvent,
  approveConfirmation,
  project,
  rejectConfirmation,
  type Approver,
  type ConfirmationDecision,
  type ConfirmationDeps,
  type EngineEvent,
  type ExecRequest,
  type JudgeLayer,
  type ProjectDeps,
} from '@ui4a/engine';

import type { DbExecutor, EventAppend } from '@ui4a/db/events';
import {
  appendBatchWithSeq,
  appendWithSeq,
  applyForeignGaps,
  type CoreEventLogState,
} from './service-event-log';
import type { ExecOutcome } from './service';
import { CONFIRMATION_REL_PREFIX, paramsWithOrigins } from './service-request';

/** execConfirmationDecision 的编排依赖(bootEngine 内闭包,调用点注入)。 */
export interface ConfirmationDecisionDeps {
  toAppend: (event: EngineEvent) => EventAppend;
  confirmDeps: () => ConfirmationDeps;
  projectDeps: () => ProjectDeps;
}

/** 拒绝留痕(action-rejected;detail 携带 layer,HTTP 响应与本事件同源)。 */
export async function persistRejection(
  db: DbExecutor,
  state: CoreEventLogState,
  toAppend: (event: EngineEvent) => EventAppend,
  request: ExecRequest,
  verdict: {
    layer: JudgeLayer;
    reason: string;
    detail?: unknown;
  },
): Promise<ExecOutcome> {
  await appendWithSeq(
    db,
    state,
    toAppend({
      ...actionRejectedEvent(request, verdict),
      params: paramsWithOrigins(request),
    }),
  );
  return verdict.detail === undefined
    ? { kind: 'rejected', layer: verdict.layer, reason: verdict.reason }
    : {
        kind: 'rejected',
        layer: verdict.layer,
        reason: verdict.reason,
        detail: verdict.detail,
      };
}

/**
 * 确认实体上的裁决动作(rel=confirmation:<id>,仅 approve/reject):
 * 路由到引擎人类裁决入口;受影响实体:approve → 目标实体(效果已应用),
 * reject → 确认实体自身(审计视图);两种裁决均随 accepted 携带 subject=
 * 确认实体投影(其 collection 回链=inbox,渲染层精确失效依据,T35 F-31)。
 * guard/schema 拒绝同样留痕(I4)。
 */
export async function execConfirmationDecision(
  db: DbExecutor,
  state: CoreEventLogState,
  deps: ConfirmationDecisionDeps,
  request: ExecRequest,
): Promise<ExecOutcome> {
  const id = request.rel.slice(CONFIRMATION_REL_PREFIX.length);
  const approver: Approver = {
    actor: request.actor ?? 'human',
    ...(request.principal !== undefined ? { principal: request.principal } : {}),
    ...(request.identity !== undefined ? { identity: request.identity } : {}),
  };
  let decision: ConfirmationDecision;
  if (request.action === 'approve') {
    decision = approveConfirmation(state.snapshot, id, approver, deps.confirmDeps());
  } else if (request.action === 'reject') {
    const reason = typeof request.params?.reason === 'string' ? request.params.reason : '';
    decision = rejectConfirmation(state.snapshot, id, approver, reason, deps.confirmDeps());
  } else {
    decision = {
      kind: 'rejected',
      layer: 'undeclared',
      reason: `动作 "${request.action}" 未声明于确认实体(仅 approve/reject)`,
    };
  }
  if (decision.kind === 'rejected') {
    return persistRejection(db, state, deps.toAppend, request, decision);
  }

  await appendBatchWithSeq(db, state, decision.events.map(deps.toAppend));
  state.snapshot = decision.snapshot;
  applyForeignGaps(state);

  const targetRel =
    request.action === 'approve'
      ? (state.snapshot.confirmations?.[request.rel]?.targetRel ?? request.rel)
      : request.rel;
  const entity = project(state.snapshot, targetRel, deps.projectDeps());
  if (entity === undefined) {
    throw new Error(`exec 后目标实体 "${targetRel}" 不可投影(内部不变式破坏)`);
  }
  // T35 F-31:主体(确认实体)投影随 accepted 携带——它的 collection 回链
  // (inbox)是渲染层失效「在等我」列表缓存的唯一合同来源;受影响实体(目标)
  // 的回链只覆盖目标自身集合(articles)。subject 投影失败不阻断裁决回执:
  // 渲染层缺 subject 时退回整面重载兜底,不产生脏读。
  const subject = project(state.snapshot, request.rel, deps.projectDeps());
  return { kind: 'accepted', entity, ...(subject !== undefined ? { subject } : {}), appended: [] };
}
