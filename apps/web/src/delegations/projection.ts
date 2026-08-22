/**
 * 委托投影(T5 Phase B / spec 架构决定 5):事件日志(委托事件族)+ 引擎快照
 * → 舰队行(/api/delegations 列表)与委托详情(/api/delegations/<id>)。
 *
 * 数据源口径:**事件日志是唯一真相**——列表/计数/状态取 engine 的 delegations
 * fold 投影(单写者、可重放,读路径零 Temporal 依赖);详情的逐步轨迹直接读
 * 该委托的事件流(rel=delegation:<id>,事件历史即轨迹,arch-brief §4)。
 *
 * 详情 messages 与 inline 聊天的 trailToMessages 逐条等值(spec 验收 6):
 * 复用同一 stepToMessage;exec 步的 rel 由 startRel 起折叠重建(与 worker
 * applyStepToState 的 rel 推导同口径)——事件 detail 不携带 currentRel,
 * 折叠重建是无损的(op 序列决定一切)。
 */
import type { TrailStep } from '@ui4a/agent';
import { delegationRel, type SirenEntity } from '@ui4a/engine';
import type { DelegationGoal } from '@ui4a/shared';

import { stepToMessage, type ChatMessage } from '../chat/trail';
import type { DbExecutor } from '../db/events';

/** 委托状态(engine fold 口径;终态与终事件一一对应)。 */
export type DelegationStatus = 'running' | 'completed' | 'failed' | 'max-steps';

/** 舰队行(时间无关摘要:goal/status/步数/成功数——不含时间戳)。 */
export interface DelegationRow {
  id: string;
  goal: DelegationGoal;
  model?: string;
  status: DelegationStatus;
  steps: number;
  successes: number;
  summary?: string;
  reason?: string;
}

/** delegation-step 事件行(seq 升序;detail 即 worker 的步结果载荷)。 */
export interface DelegationEventRow {
  seq: number;
  kind: string;
  detail: unknown;
}

/** 详情轨迹步(事件 detail + 折叠重建的 rel)。 */
export interface DelegationTrailStep {
  step: number;
  rel: string;
  op: TrailStep['op'];
  outcome: TrailStep['outcome'];
  entitySummary?: unknown;
  rejection?: { reason: string } & Record<string, unknown>;
}

/** 委托详情(快照字段 + 事件流轨迹 + inline 等价消息投影)。 */
export interface DelegationDetail extends DelegationRow {
  driverKind: string;
  startRel: string;
  principal?: string;
  trail: DelegationTrailStep[];
  messages: ChatMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 必备字符串字段(缺失即 engine/web 投影漂移,响亮失败)。 */
function requiredString(properties: Record<string, unknown>, key: string): string {
  const value = properties[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`委托投影字段 "${key}" 缺失或非字符串(引擎投影漂移)`);
  }
  return value;
}

function requiredNumber(properties: Record<string, unknown>, key: string): number {
  const value = properties[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`委托投影字段 "${key}" 缺失或非计数(引擎投影漂移)`);
  }
  return value;
}

function requiredStatus(properties: Record<string, unknown>): DelegationStatus {
  const value = properties.status;
  if (value !== 'running' && value !== 'completed' && value !== 'failed' && value !== 'max-steps') {
    throw new Error(`委托投影字段 "status" 非法: ${String(value)}(引擎投影漂移)`);
  }
  return value;
}

/** 引擎 delegations 集合的子实体 → 舰队行(kebab 属性 → 行字段)。 */
export function toDelegationRow(sub: SirenEntity): DelegationRow {
  const properties = sub.properties;
  const goal = properties.goal;
  if (!isRecord(goal) || typeof goal.verb !== 'string') {
    throw new Error('委托投影字段 "goal" 缺失或非法(引擎投影漂移)');
  }
  return {
    id: requiredString(properties, 'id'),
    // 双重断言理由:goal.verb 已校验为非空字符串,其余键(targetRel/resource/
    // fields)是 engine DelegationGoal 的原样投影;TS 无法从 Record 收窄到接口。
    goal: goal as unknown as DelegationGoal,
    ...(typeof properties.model === 'string' ? { model: properties.model } : {}),
    status: requiredStatus(properties),
    steps: requiredNumber(properties, 'steps'),
    successes: requiredNumber(properties, 'successes'),
    ...(typeof properties.summary === 'string' ? { summary: properties.summary } : {}),
    ...(typeof properties.reason === 'string' ? { reason: properties.reason } : {}),
  };
}

/**
 * 快照实体 + 事件流 → 委托详情。
 * 状态/计数以 engine fold 为准(折叠层强制日志完整性);轨迹/消息从事件流
 * 重建(rel 折叠与 worker applyStepToState 同口径:exec 步发生在 currentRel,
 * navigate 成功后切换)。
 */
export function projectDelegationDetail(
  entity: SirenEntity,
  events: readonly DelegationEventRow[],
): DelegationDetail {
  const row = toDelegationRow(entity);
  const properties = entity.properties;
  const startRel = requiredString(properties, 'start-rel');

  const trail: DelegationTrailStep[] = [];
  let currentRel = startRel;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind !== 'delegation-step') continue;
    const detail = event.detail as (Partial<DelegationTrailStep> & Record<string, unknown>) | null;
    if (
      detail === null ||
      typeof detail.step !== 'number' ||
      !isRecord(detail.op) ||
      typeof detail.outcome !== 'string'
    ) {
      continue; // 非 step 载荷(防御;engine fold 对坏载荷已响亮失败,此处不重复裁决)
    }
    // 断言理由:op/outcome 由 worker AgentStepResult 原样写入事件 detail,
    // 形状与 AgentOperation/TrailStep['outcome'] 同构;上游 fold 已强制校验。
    const op = detail.op as unknown as TrailStep['op'];
    const outcome = detail.outcome as TrailStep['outcome'];
    const rel = op.kind === 'navigate' ? op.rel : currentRel;
    trail.push({
      step: detail.step,
      rel,
      op,
      outcome,
      ...(detail.entitySummary !== undefined ? { entitySummary: detail.entitySummary } : {}),
      ...(detail.rejection !== undefined ? { rejection: detail.rejection } : {}),
    });
    if (op.kind === 'navigate' && outcome === 'navigated') {
      currentRel = op.rel;
    }
  }

  // 消息投影:与 inline trailToMessages 同一 stepToMessage;max-steps 补上限
  // 消息(inline 同款格式;done/fail 步本身就是事件流的一员,无需额外补)。
  const messages: ChatMessage[] = trail.map((step) =>
    stepToMessage({
      step: step.step,
      rel: step.rel,
      op: step.op,
      outcome: step.outcome,
      // 双重断言理由:事件 detail 的 rejection 由 worker RejectionRecord 原样
      // 写入(engine 同口径投影);投影层字段是它的宽松超集。
      ...(step.rejection !== undefined
        ? { rejection: step.rejection as unknown as TrailStep['rejection'] }
        : {}),
    }),
  );
  if (row.status === 'max-steps') {
    messages.push({
      role: 'assistant',
      text: `达到步数上限: ${row.reason ?? ''}`.trimEnd(),
    });
  }

  return {
    ...row,
    driverKind: requiredString(properties, 'driver-kind'),
    startRel,
    ...(typeof properties.principal === 'string' ? { principal: properties.principal } : {}),
    trail,
    messages,
  };
}

/** 读单个委托的事件族(rel=delegation:<id>,seq 升序;轨迹的原始来源)。 */
export async function loadDelegationEvents(
  db: DbExecutor,
  delegationId: string,
): Promise<DelegationEventRow[]> {
  const result = await db.query<{ seq: string | number; kind: string; detail: unknown }>(
    'SELECT seq, kind, detail FROM events WHERE rel = $1 ORDER BY seq ASC',
    [delegationRel(delegationId)],
  );
  return result.rows.map((row) => ({
    seq: Number(row.seq),
    kind: row.kind,
    detail: row.detail ?? null,
  }));
}
