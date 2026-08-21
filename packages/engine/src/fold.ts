/**
 * fold 投影:事件日志 → 引擎快照的纯函数(arch-brief §4 事件溯源)。
 *
 * "当前 UI 状态 = 日志折叠后的物化状态";应用核心是日志的纯函数(I5 的根基)。
 * 与在线路径同构:在线 exec = judge(裁决) → applyEffects(效果) → appendEvent(s) →
 * 增量持有新快照;重放 = fold(全部事件) —— 每条 action-executed 事件还原成
 * ExecRequest 后重放同一个 applyEffects(同一 flow 常量、同一效果词汇表),
 * 两条路径产出相同快照(由 I5 集成测试以内容 hash 断言)。
 *
 * 放在 engine(而非 web service 层)的理由:fold 是"应用核心"本体且纯(零 Node API,
 * 两栖),worker(T3 消费 spawn-requested)与任何重放工具都需要它;
 * 日志形状(LogEvent)因此成为引擎公共合同的一部分。
 */
import { fieldValues } from '@ui4a/shared';
import type { ConfirmationSnapshot, EngineSnapshot, InstanceSnapshot } from '@ui4a/shared';

import {
  confirmationRel,
  type ConfirmationDecisionDetail,
  type ConfirmationRequestDetail,
} from './confirmation';
import { applyEffects } from './effects';
import type { EngineEvent } from './effects';
import type { ExecRequest } from './judge';
import { actionEffects } from './parse';
import type { FlowDefinition } from './types';

/** 日志事件种类:引擎产出三种 + 日志层两种(拒绝留痕 I6 / 种子装载)+
 *  notification-delivered(T3 notify capability 送达事件,worker 第二写者写入;
 *  fold 分支见 Task 2 读路径)。 */
export type LogEventKind =
  | EngineEvent['kind']
  | 'action-rejected'
  | 'notification-delivered'
  | 'seed';

/**
 * 存储事件(引擎 EngineEvent + 日志层字段)。
 * seq/ts 由日志层分配(时钟是 capability,引擎事件不含二者);
 * reason/detail 由拒绝路径与 seed 装载写入。
 */
export interface LogEvent extends Omit<EngineEvent, 'kind' | 'rel' | 'action' | 'actor'> {
  seq: number;
  /** ISO 时间戳(仅审计;fold 不读它,重放确定性不依赖时钟)。 */
  ts?: string;
  kind: LogEventKind;
  rel?: string;
  action?: string;
  /** 行为者;seed 等事件可缺省(存储层列为 null)。 */
  actor?: 'human' | 'agent';
  reason?: string;
  detail?: unknown;
}

/** seed 事件的 detail 载荷:种子实体与集合(Phase C 启动 seed 写入)。 */
export interface SeedDetail {
  instances: Record<string, InstanceSnapshot>;
  collections?: Record<string, string[]>;
}

/** 由事件参数(带出处)还原 exec 请求的求值输入。 */
function toExecRequest(event: LogEvent): ExecRequest {
  const params = event.params ?? {};
  return {
    rel: event.rel ?? '',
    action: event.action ?? '',
    params: fieldValues(params),
    paramOrigins: Object.fromEntries(
      Object.entries(params).map(([name, entry]) => [name, entry.origin]),
    ),
    actor: event.actor,
    principal: event.principal,
    channel: event.channel,
  };
}

/** seed 合并:只补缺、不覆盖(幂等种子装载;重复 seed 事件无害)。 */
function applySeed(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<SeedDetail> | undefined;
  if (detail === undefined || typeof detail !== 'object' || detail.instances === undefined) {
    throw new Error(`seed 事件(seq=${event.seq})缺少 detail.instances`);
  }
  const instances: EngineSnapshot['instances'] = { ...snapshot.instances };
  for (const [rel, instance] of Object.entries(detail.instances)) {
    if (instances[rel] === undefined) {
      instances[rel] = instance;
    }
  }
  const collections: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(snapshot.collections)) {
    collections[name] = [...members];
  }
  for (const [name, members] of Object.entries(detail.collections ?? {})) {
    const existing = collections[name] ?? [];
    collections[name] = [...existing, ...members.filter((rel) => !existing.includes(rel))];
  }
  return {
    instances,
    collections,
    // confirmations 表随行(seed 只补实体与集合,不动确认门状态)。
    confirmations: { ...snapshot.confirmations },
  };
}

/**
 * 重放一条 action-executed:按重放位点(flow 常量 × 实例当前节点)查动作声明,
 * 还原求值输入后走同一个 applyEffects。日志与定义漂移时响亮失败(带 seq)——
 * 日志 + 定义 = 完整重放输入,任何缺口都必须被 I5 级测试看见。
 */
function applyExecuted(
  snapshot: EngineSnapshot,
  event: LogEvent,
  flows: Readonly<Record<string, FlowDefinition>>,
): EngineSnapshot {
  const request = toExecRequest(event);
  const where = `seq=${event.seq}(${request.rel}#${request.action})`;

  const instance = snapshot.instances[request.rel];
  if (instance === undefined) {
    throw new Error(`重放失败:${where} 实例不存在(日志与状态漂移)`);
  }
  const flow = flows[instance.flow];
  if (flow === undefined) {
    throw new Error(`重放失败:${where} 流程 "${instance.flow}" 未注册(定义漂移)`);
  }
  const node = flow.nodes.find((candidate) => candidate.name === instance.node);
  if (node === undefined) {
    throw new Error(`重放失败:${where} 节点 "${instance.node}" 不在流程 "${flow.name}" 节点集`);
  }
  const action = node.actions.find((candidate) => candidate.name === request.action);
  if (action === undefined) {
    throw new Error(
      `重放失败:${where} 动作未声明于节点 "${node.name}"(定义与日志漂移)`,
    );
  }

  try {
    return applyEffects(request, actionEffects(action), snapshot, { flows }).snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`重放失败:${where} ${message}`);
  }
}

// ---------------------------------------------------------------------------
// confirmation 事件链重放(T3:挂起→approve/reject;与在线路径同构)
// ---------------------------------------------------------------------------

/** confirmation-requested 重放:pending 实体物化(不重新裁决策略,载荷即真相)。 */
function applyConfirmationRequested(
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
  };
  return {
    ...snapshot,
    confirmations: { ...(snapshot.confirmations ?? {}), [rel]: confirmation },
  };
}

/** confirmation-approved / rejected 重放:状态流转(实体保留供审计)。 */
function applyConfirmationDecision(
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
    throw new Error(
      `重放失败:seq=${event.seq} 确认 "${rel}" 已是 ${existing.status}(重复裁决)`,
    );
  }
  // decidedBy 从 detail 还原(含 principal;与在线 decidedByOf 构造逐字段同构)。
  const decidedBy = detail.decidedBy;
  if (
    decidedBy === undefined ||
    typeof decidedBy !== 'object' ||
    (decidedBy.actor !== 'human' && decidedBy.actor !== 'agent')
  ) {
    throw new Error(
      `重放失败:seq=${event.seq} confirmation-${status} 缺少 decidedBy(日志完整性)`,
    );
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
function applyNotificationDelivered(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
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

/**
 * 折叠事件日志为引擎快照(纯函数;events 须按 seq 升序传入)。
 *
 * - action-executed:重放 applyEffects(在线路径同一函数);
 * - action-rejected:不改状态(拒绝即数据,留痕在日志本身,I6);
 * - entity-appended / spawn-requested:伴随事件——状态已由同批 action-executed
 *   重放体现(append 由 applyEffects 落位;spawn 在 T2 不改状态),fold 不双算;
 * - confirmation-requested:pending 确认实体物化(目标动作不生效);
 * - confirmation-approved:状态 → approved(实体保留);紧随其后的 action-executed
 *   照常重放(挂起→approve 重放后效果必须出现,I5);
 * - confirmation-rejected:状态 → rejected(原因保留),原动作永不生效;
 * - notification-delivered:确认标记 notified=true(worker 第二写者的送达事件,
 *   重复幂等;spec 决定 4 双写者方案);
 * - seed:合并种子实体(幂等);
 * - 未知 kind:抛错(日志完整性守卫)。
 *
 * initial(可选):从既有快照继续折叠——web 读路径按 seq 增量 fold 的根基
 * (增量结果与全量 fold 同构,由测试以内容 hash 断言;缺省从空快照起步)。
 */
export function fold(
  events: readonly LogEvent[],
  deps: { flows: Readonly<Record<string, FlowDefinition>> },
  initial?: EngineSnapshot,
): EngineSnapshot {
  let snapshot: EngineSnapshot =
    initial === undefined
      ? { instances: {}, collections: {}, confirmations: {} }
      : {
          instances: initial.instances,
          collections: initial.collections,
          confirmations: initial.confirmations ?? {},
        };
  for (const event of events) {
    switch (event.kind) {
      case 'seed':
        snapshot = applySeed(snapshot, event);
        break;
      case 'action-executed':
        snapshot = applyExecuted(snapshot, event, deps.flows);
        break;
      case 'confirmation-requested':
        snapshot = applyConfirmationRequested(snapshot, event);
        break;
      case 'confirmation-approved':
        snapshot = applyConfirmationDecision(snapshot, event, 'approved');
        break;
      case 'confirmation-rejected':
        snapshot = applyConfirmationDecision(snapshot, event, 'rejected');
        break;
      case 'notification-delivered':
        snapshot = applyNotificationDelivered(snapshot, event);
        break;
      case 'action-rejected':
      case 'entity-appended':
      case 'spawn-requested':
        break;
      default:
        throw new Error(`重放失败:未知事件 kind "${String(event.kind)}"(seq=${event.seq})`);
    }
  }
  return snapshot;
}
