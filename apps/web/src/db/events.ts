/**
 * 事件日志的存储层:schema 引导(幂等 DDL)、appendEvent(串行单写)、listEvents(只读)。
 *
 * 设计(arch-brief §4 / spec FR2):
 * - 迁移方式:**启动时幂等 DDL**(CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE
 *   FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER),而非迁移框架——demo 单库,
 *   Next.js 打包对 fs 读 .sql 不友好,幂等 DDL 让 dev/test/将来 prod 走同一条路;
 *   `events.sql` 是同一 DDL 的迁移工件(dba 审阅/手工执行用),由测试强制逐字一致。
 * - append-only:DB 层行级触发器拒绝 UPDATE/DELETE;TRUNCATE 保留为测试/运维清库口。
 * - 串行单写:单条 INSERT 原子提交,bigserial 序列保证 seq 单调(PG 事务内 nextval 语义)。
 */
import type { LogEvent } from '@ui4a/engine';
import type { FieldValue } from '@ui4a/shared';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

/** 事件种类(spec FR2):拒绝事件与执行事件同表(I6);confirmation-* 为 T3 确认门事件;
 *  notification-delivered 为 T3 notify capability 送达事件(worker 第二写者,spec 决定 4);
 *  definition-* 为 T4 定义平面事件(meta 模块产出 + definition-seeded 种子,
 *  Phase B 起 web 层写入;类型先行以与 engine LogEventKind 对齐——机械适配);
 *  delegation-* 为 T5 委托事件族(worker delegationWorkflow 的首/步/终事件,
 *  同一双写者方案;类型先行,engine fold 分支见 T5 Phase A Task 2);
 *  plan-executed 为 T6 批量裁决记录事件(engine executePlan 每计划恰一条)。 */
export type EventKind =
  | 'action-executed'
  | 'action-rejected'
  | 'entity-appended'
  | 'spawn-requested'
  | 'confirmation-requested'
  | 'confirmation-approved'
  | 'confirmation-rejected'
  | 'notification-delivered'
  | 'seed'
  | 'definition-seeded'
  | 'definition-edited'
  | 'definition-submitted'
  | 'definition-activated'
  | 'definition-rejected'
  | 'definition-revised'
  | 'definition-deprecated'
  | 'delegation-started'
  | 'delegation-step'
  | 'delegation-completed'
  | 'delegation-failed'
  | 'delegation-max-steps'
  | 'plan-executed';

/** 追加事件(引擎 EngineEvent 的日志层超集:引擎不产 seq/ts/reason,由本层分配)。 */
export interface EventAppend {
  kind: EventKind;
  actor?: 'human' | 'agent';
  principal?: string;
  channel?: string;
  rel?: string;
  action?: string;
  /** 带出处的参数快照(Record<名, FieldValue>;事件溯源的求值输入)。 */
  params?: Record<string, FieldValue>;
  /** 拒绝原因(action-rejected;与 HTTP 4xx 结构化原因同源)。 */
  reason?: string;
  /** 结构化补充(guard 求值结果 / ajv 错误 / seed 载荷)。 */
  detail?: unknown;
}

/** 读回的存储事件(行形状;ts 统一 ISO 字符串,便于 JSON 直出)。 */
export interface StoredEvent {
  seq: number;
  ts: string;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
  kind: EventKind;
  rel: string | null;
  action: string | null;
  params: Record<string, FieldValue>;
  reason: string | null;
  detail: unknown;
}

/** 可执行 SQL 的最小结构(Pool 与 PoolClient 均满足)。 */
export interface DbExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    sqlText: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

/** 幂等 DDL(与 events.sql 迁移工件逐字一致,由 events.test.ts 强制)。 */
export const EVENTS_DDL = `
-- events:append-only 事件日志(arch-brief §4 事件溯源;I5/I6 的底座)。
-- 幂等 DDL:应用启动与测试建库共用(DECISIONS.md D2:PG 从第一天起)。
-- 注意:seq/ts 由日志层分配 —— 时钟是 capability,引擎事件(EngineEvent)不含二者。

CREATE TABLE IF NOT EXISTS events (
  seq       BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor     TEXT,
  principal TEXT,
  channel   TEXT,
  kind      TEXT NOT NULL,
  rel       TEXT,
  action    TEXT,
  params    JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason    TEXT,
  detail    JSONB
);

CREATE INDEX IF NOT EXISTS events_seq_asc ON events (seq);

-- append-only 强制:行级触发器拒绝 UPDATE/DELETE。
-- TRUNCATE 不触发行级触发器,保留为测试/运维清库口(测试自清理依赖它)。
CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events 表 append-only:禁止 % 于 seq=%', TG_OP, OLD.seq;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_append_only_trigger ON events;
CREATE TRIGGER events_append_only_trigger
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();
`;

/** 引导 events 表(幂等;应用启动与测试 setup 各自调用)。 */
export async function ensureEventsTable(db: DbExecutor): Promise<void> {
  await db.query(EVENTS_DDL);
}

/** 追加一条事件,返回日志层分配的 seq 与 ts。 */
export async function appendEvent(
  db: DbExecutor,
  event: EventAppend,
): Promise<{ seq: number; ts: Date }> {
  const result = await db.query<{ seq: string | number; ts: Date }>(
    `INSERT INTO events (actor, principal, channel, kind, rel, action, params, reason, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
     RETURNING seq, ts`,
    [
      event.actor ?? null,
      event.principal ?? null,
      event.channel ?? null,
      event.kind,
      event.rel ?? null,
      event.action ?? null,
      JSON.stringify(event.params ?? {}),
      event.reason ?? null,
      event.detail === undefined ? null : JSON.stringify(event.detail),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('appendEvent 未返回行(INSERT ... RETURNING 失败)');
  }
  // bigserial 经 pg 驱动以字符串返回(bigint 超 JS 安全整数;demo 规模下 Number 足够)。
  return { seq: Number(row.seq), ts: row.ts };
}

/** 读取事件(只读,seq 升序;afterSeq 分页:返回 seq 严格大于 afterSeq 的事件)。 */
export async function listEvents(db: DbExecutor, afterSeq = 0): Promise<StoredEvent[]> {
  const result = await db.query<{
    seq: string | number;
    ts: Date;
    actor: 'human' | 'agent' | null;
    principal: string | null;
    channel: string | null;
    kind: EventKind;
    rel: string | null;
    action: string | null;
    params: Record<string, FieldValue>;
    reason: string | null;
    detail: unknown;
  }>(
    `SELECT seq, ts, actor, principal, channel, kind, rel, action, params, reason, detail
     FROM events WHERE seq > $1 ORDER BY seq ASC`,
    [afterSeq],
  );
  return result.rows.map((row) => ({
    seq: Number(row.seq),
    ts: new Date(row.ts).toISOString(),
    actor: row.actor,
    principal: row.principal,
    channel: row.channel,
    kind: row.kind,
    rel: row.rel,
    action: row.action,
    params: row.params ?? {},
    reason: row.reason,
    detail: row.detail ?? null,
  }));
}

// PoolClient 仅用于类型派生,避免运行时引入多余依赖。
export type { PoolClient };

/** 存储事件 → 引擎 fold 的 LogEvent(null 归一为 undefined;ts 保留 ISO 字符串)。 */
export function toLogEvent(event: StoredEvent): LogEvent {
  return {
    seq: event.seq,
    ts: event.ts,
    kind: event.kind,
    rel: event.rel ?? undefined,
    action: event.action ?? undefined,
    actor: event.actor ?? undefined,
    principal: event.principal ?? undefined,
    channel: event.channel ?? undefined,
    params: event.params,
    reason: event.reason ?? undefined,
    detail: event.detail ?? undefined,
  };
}

/** 读出日志并归一为引擎可折叠形状(seq 升序;afterSeq 分页)。 */
export async function readLog(db: DbExecutor, afterSeq = 0): Promise<LogEvent[]> {
  const stored = await listEvents(db, afterSeq);
  return stored.map(toLogEvent);
}
