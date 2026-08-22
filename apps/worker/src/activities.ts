/**
 * notify activity(T3 Phase C):第一个 capability 的落地。
 *
 * 效果动词"触达"(arch-brief §3):向人类送达确认门通知。T3 的物理信道是
 * 事件日志 + 收件箱投影(Web Push/SMTP 后续切片叠加);因此 activity 的全部
 * 职责 = 向**同一 PG 事件日志**追加 `notification-delivered` 事件
 * (spec 架构决定 4 双写者方案:worker 直接 appendEvent,web 读路径按 seq
 * 增量 fold 看见)。
 *
 * 幂等方案(activity 层检查,报告口径):
 * - Temporal workflowId(`notify-<id>`)防并发重复派发;
 * - activity 内先查同 rel 的 notification-delivered 是否已存在,存在即跳过
 *   (重试/重跑不双写);fold 对重复送达事件同样幂等(engine fold 分支)。
 *
 * 存储层复用 web 的 db 模块(appendEvent/ensureEventsTable 是唯一写入口,
 * 跨 app 相对引用——事件日志是共享底座,不属于任何平面,arch-brief §1)。
 */
import { createHash } from 'node:crypto';

import type { DbExecutor } from '../../web/src/db/events';
import { appendEvent, ensureEventsTable } from '../../web/src/db/events';
import { getPool } from '../../web/src/db/pool';

import { resolveLlmConfig, type SitemapSummary } from '@ui4a/agent';
import { canonicalJson } from '@ui4a/engine';

import {
  fetchSitemap,
  recordDelegationFinish,
  recordDelegationStart,
  runAgentStep,
} from './delegation';
import type {
  AgentStepArgs,
  AgentStepResult,
  DelegationFinishArgs,
  DelegationStartArgs,
} from './workflows';
import type { NotifyConfirmation } from './workflows';

const DEFAULT_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a';

/** worker 自用 db(与 web 同库;按连接串复用 web 侧 pg pool 单例管理)。 */
export function workerDb(): DbExecutor {
  return getPool(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
}

/** activity 注册表(workflow 经 proxyActivities 按名调用)。 */
export interface NotifyActivities {
  notify(confirmation: NotifyConfirmation): Promise<{ seq: number; deduplicated: boolean }>;
}

/** notification-delivered 事件的 detail 载荷:inbox 条目数据(Phase D 收件箱渲染输入)。 */
export interface NotificationDeliveredDetail {
  /** 通知去重键(spec:notificationId = `notif:<confirmation.id>`)。 */
  notificationId: string;
  /** 确认摘要(提议者/目标/策略原因——人类在推送上做决定所需的全部信息)。 */
  confirmation: NotifyConfirmation;
}

/** 幂等键:事件表无业务唯一约束,按 (kind, rel) 精确匹配已送达通知。 */
function findEvent(db: DbExecutor, kind: string, rel: string): Promise<number | null> {
  return db
    .query<{ seq: string | number }>(
      'SELECT seq FROM events WHERE kind = $1 AND rel = $2 LIMIT 1',
      [kind, rel],
    )
    .then((result) => ((result.rowCount ?? 0) > 0 ? Number(result.rows[0]!.seq) : null));
}

function findDelivered(db: DbExecutor, rel: string): Promise<number | null> {
  return findEvent(db, 'notification-delivered', rel);
}

/**
 * 送达核心(db 注入,单测用假 DbExecutor):
 * 写 notification-delivered(rel=confirmation:<id>,detail 含 inbox 条目数据);
 * 已送达则跳过(deduplicated=true)。ensureEventsTable 幂等——worker 可先于 web 启动。
 */
export async function deliverNotification(
  db: DbExecutor,
  confirmation: NotifyConfirmation,
): Promise<{ seq: number; deduplicated: boolean }> {
  await ensureEventsTable(db);
  const rel = `confirmation:${confirmation.id}`;
  const existing = await findDelivered(db, rel);
  if (existing !== null) {
    return { seq: existing, deduplicated: true };
  }
  const detail: NotificationDeliveredDetail = {
    notificationId: `notif:${confirmation.id}`,
    confirmation,
  };
  const appended = await appendEvent(db, {
    kind: 'notification-delivered',
    rel,
    actor: confirmation.proposedBy.actor,
    principal: confirmation.proposedBy.principal,
    channel: 'notify',
    detail,
  });
  return { seq: appended.seq, deduplicated: false };
}

/** Temporal activity 入口(注册名 notify);委托 deliverNotification。 */
export async function notify(
  confirmation: NotifyConfirmation,
): Promise<{ seq: number; deduplicated: boolean }> {
  return deliverNotification(workerDb(), confirmation);
}

export interface CapabilityArtifactInput {
  id: string;
  capability: string;
  source: { rel: string; field: string };
  model: string;
  outputSchema: Record<string, unknown>;
  content: unknown;
  createdBy: { actor: 'human' | 'agent'; principal?: string };
}

/**
 * capability runner 的持久化边界。模型调用发生在 activity adapter 外层；
 * 本函数把已验证输出物化为 append-only artifact，重试按 artifact rel 幂等。
 */
export async function materializeCapabilityArtifact(
  db: DbExecutor,
  input: CapabilityArtifactInput,
): Promise<{ seq: number; deduplicated: boolean; contentHash: string }> {
  await ensureEventsTable(db);
  const rel = `artifact:${input.id}`;
  const canonicalContent = canonicalJson(input.content);
  const contentHash = `sha256:${createHash('sha256').update(canonicalContent).digest('hex')}`;
  const existing = await findEvent(db, 'capability-artifact-created', rel);
  if (existing !== null) return { seq: existing, deduplicated: true, contentHash };
  const detail = { ...input, contentHash };
  const appended = await appendEvent(db, {
    kind: 'capability-artifact-created',
    rel,
    actor: input.createdBy.actor,
    principal: input.createdBy.principal,
    channel: 'capability',
    detail,
  });
  return { seq: appended.seq, deduplicated: false, contentHash };
}

// ---------------------------------------------------------------------------
// delegation activities(T5 Phase A / spec 架构决定 1)
// ---------------------------------------------------------------------------

/**
 * delegation activity 注册表(workflow 经 proxyActivities 按名调用):
 * - startDelegation / finishDelegation:委托首尾事件落 PG(幂等);
 * - loadSitemap:agent 静态上下文,循环外取一次;
 * - agentStep:决策+执行合一的单步核心(见 delegation.ts;llm 决策的网络
 *   调用因此天然在 activity 内,workflow 重放确定性)。
 */
export interface DelegationActivities {
  startDelegation(args: DelegationStartArgs): Promise<{ seq: number; deduplicated: boolean }>;
  loadSitemap(args: { baseUrl: string }): Promise<SitemapSummary | undefined>;
  agentStep(args: AgentStepArgs): Promise<AgentStepResult>;
  finishDelegation(args: DelegationFinishArgs): Promise<{ seq: number; deduplicated: boolean }>;
}

export async function startDelegation(
  args: DelegationStartArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return recordDelegationStart(workerDb(), { ...args, model: resolveLlmConfig().model });
}

export async function loadSitemap(args: { baseUrl: string }): Promise<SitemapSummary | undefined> {
  return fetchSitemap(args.baseUrl, fetch);
}

export async function agentStep(args: AgentStepArgs): Promise<AgentStepResult> {
  return runAgentStep({ db: workerDb(), fetchImpl: fetch }, args);
}

export async function finishDelegation(
  args: DelegationFinishArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return recordDelegationFinish(workerDb(), args);
}
