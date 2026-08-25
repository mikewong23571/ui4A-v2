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
 *  plan-executed 为 T6 批量裁决记录事件(engine executePlan 每计划恰一条);
 *  render-spec-frozen 为 T7 凝固事件(web freezeSpec 首冻恰一条);
 *  chat-turn 为 T9 Phase B 聊天回合投影(web 聊天路由 inline 完成后直写,
 *  同一双写者方案;engine fold 忽略——纯审计留痕);
 *  agent-decision 为 T11 Phase B inline 每步决策审计(与 chat-turn 同源同值,
 *  engine fold 忽略——纯留痕);
 *  application-seeded 为 T10 Phase B application 定义种子(boot 装载,
 *  与 engine LogEventKind 对齐——机械适配);
 *  capability-seeded 为 T13 Phase C capability 定义种子(boot 装载,
 *  与 engine LogEventKind 对齐——机械适配)。 */
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
  | 'application-seeded'
  | 'capability-seeded'
  | 'capability-artifact-created'
  | 'meta-bootstrap-applied'
  | 'definition-edited'
  | 'definition-submitted'
  | 'definition-activated'
  | 'definition-candidate-applied'
  | 'draft-created'
  | 'draft-revised'
  | 'draft-validated'
  | 'draft-submitted'
  | 'draft-staled'
  | 'draft-abandoned'
  | 'draft-accepted'
  | 'draft-rejected'
  | 'draft-expired'
  | 'capability-run-created'
  | 'capability-run-preparing'
  | 'capability-run-started'
  | 'capability-run-cursor-advanced'
  | 'capability-run-restarted'
  | 'capability-run-approval-requested'
  | 'capability-run-resumed'
  | 'capability-run-succeeded'
  | 'capability-run-failed'
  | 'capability-run-cancelled'
  | 'capability-run-staled'
  | 'capability-raw-chunk-recorded'
  | 'capability-normalized-event-recorded'
  | 'agent-run-created'
  | 'agent-run-preparing'
  | 'agent-run-started'
  | 'agent-run-cursor-advanced'
  | 'agent-run-restarted'
  | 'agent-run-question-asked'
  | 'agent-run-question-answered'
  | 'agent-run-resource-grant-requested'
  | 'agent-run-resource-grant-decided'
  | 'agent-run-succeeded'
  | 'agent-run-failed'
  | 'agent-run-cancelled'
  | 'agent-run-staled'
  | 'agent-run-raw-chunk-recorded'
  | 'agent-definition-version-registered'
  | 'agent-definition-version-activated'
  | 'agent-definition-version-deprecated'
  | 'definition-rejected'
  | 'definition-revised'
  | 'definition-deprecated'
  | 'delegation-started'
  | 'delegation-step'
  | 'delegation-completed'
  | 'delegation-failed'
  | 'delegation-max-steps'
  | 'plan-executed'
  | 'render-spec-frozen'
  | 'chat-turn-started'
  | 'chat-turn-progress'
  | 'chat-turn'
  | 'chat-message-appended'
  | 'chat-context-updated'
  | 'chat-navigation-completed'
  | 'agent-decision'
  | 'presentation-requested'
  | 'presentation-resolved'
  | 'presentation-failed'
  | 'render-recipe-generated'
  | 'render-recipe-validated'
  | 'render-recipe-promoted'
  | 'render-recipe-staled'
  | 'user-sidecar-instantiated'
  | 'user-sidecar-revised'
  | 'user-sidecar-pinned'
  | 'user-sidecar-staled'
  | 'user-sidecar-reverted'
  | 'user-sidecar-evicted'
  | 'render-feedback-recorded';

export type EventDomain = 'core' | 'presentation' | 'draft' | 'capability' | 'agent-definition';

/** 追加事件(引擎 EngineEvent 的日志层超集:引擎不产 seq/ts/reason,由本层分配)。 */
export interface EventAppend {
  domain?: EventDomain;
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
  /** In-memory test fixtures omit domain and are interpreted as core. DB rows always provide it. */
  domain?: EventDomain;
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

/** Pool-like database boundary for a real single-client transaction. */
export interface ConnectableDb extends DbExecutor {
  connect?: () => Promise<PoolClient>;
}

/**
 * Execute against one acquired PG client. Plain test executors without `connect` stay supported,
 * but Pool callers never issue BEGIN/COMMIT through unrelated `Pool.query` connections.
 */
export async function withDatabaseTransaction<T>(
  db: ConnectableDb,
  run: (client: DbExecutor) => Promise<T>,
): Promise<T> {
  if (db.connect === undefined) return run(db);
  const client = await db.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (began) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** 幂等 DDL(与 events.sql 迁移工件逐字一致,由 events.test.ts 强制)。 */
export const EVENTS_DDL = `
-- events:append-only 事件日志(arch-brief §4 事件溯源;I5/I6 的底座)。
-- 幂等 DDL:应用启动与测试建库共用(DECISIONS.md D2:PG 从第一天起)。
-- 注意:seq/ts 由日志层分配 —— 时钟是 capability,引擎事件(EngineEvent)不含二者。

CREATE TABLE IF NOT EXISTS events (
  seq       BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  domain    TEXT NOT NULL DEFAULT 'core',
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
CREATE INDEX IF NOT EXISTS events_domain_seq_asc ON events (domain, seq);

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

/**
 * 引导 events 表(幂等;应用启动与测试 setup 各自调用)。
 *
 * DDL 互斥:web boot 与 worker boot 可能并发执行(CREATE OR REPLACE FUNCTION
 * / DROP TRIGGER 都要动 pg_proc 系统表,并发时 PG 报 deadlock detected——
 * T5/T8 两度实测的偶发 flake 源)。用事务级咨询锁把幂等 DDL 串行化:后到者
 * 等先到者提交后再跑一遍幂等 DDL(结果不变),死锁消失。
 */
export async function ensureEventsTable(db: DbExecutor): Promise<void> {
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(740933)'); // 任意固定键:仅用于 DDL 互斥
    await db.query(EVENTS_DDL);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** 追加一条事件,返回日志层分配的 seq 与 ts。 */
export async function appendEvent(
  db: DbExecutor,
  event: EventAppend,
): Promise<{ seq: number; ts: Date }> {
  const result = await db.query<{ seq: string | number; ts: Date }>(
    `INSERT INTO events (actor, principal, channel, kind, rel, action, params, reason, detail, domain)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)
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
      event.domain ?? 'core',
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('appendEvent 未返回行(INSERT ... RETURNING 失败)');
  }
  // bigserial 经 pg 驱动以字符串返回(bigint 超 JS 安全整数;demo 规模下 Number 足够)。
  return { seq: Number(row.seq), ts: row.ts };
}

/** Append one command's event batch atomically and return the allocated sequence numbers. */
export function appendEventBatch(
  db: ConnectableDb,
  events: readonly EventAppend[],
): Promise<Array<{ seq: number; ts: Date }>> {
  return withDatabaseTransaction(db, async (client) => {
    const appended: Array<{ seq: number; ts: Date }> = [];
    for (const event of events) appended.push(await appendEvent(client, event));
    return appended;
  });
}

/** 读取事件(只读,seq 升序;afterSeq 分页:返回 seq 严格大于 afterSeq 的事件)。 */
export async function listEvents(
  db: DbExecutor,
  afterSeq = 0,
  options?: {
    domain?: EventDomain;
    rel?: string;
    kind?: string;
    principal?: string;
    limit?: number;
  },
): Promise<StoredEvent[]> {
  const limit = options?.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 101)) {
    throw new Error('event limit must be an integer between 1 and 101');
  }
  const values: unknown[] = [afterSeq];
  const where = ['seq > $1'];
  if (options?.domain !== undefined) {
    values.push(options.domain);
    where.push(`domain = $${values.length}`);
  }
  for (const [column, value] of [
    ['rel', options?.rel],
    ['kind', options?.kind],
    ['principal', options?.principal],
  ] as const) {
    if (value !== undefined) {
      values.push(value);
      where.push(`${column} = $${values.length}`);
    }
  }
  const limitSql = limit === undefined ? '' : ` LIMIT $${values.push(limit)}`;
  const result = await db.query<{
    domain: EventDomain;
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
    `SELECT seq, ts, domain, actor, principal, channel, kind, rel, action, params, reason, detail
     FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC${limitSql}`,
    values,
  );
  return result.rows.map((row) => ({
    domain: row.domain,
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
  if (event.domain !== undefined && event.domain !== 'core') {
    throw new Error(`Presentation event "${event.kind}" cannot enter the Business fold`);
  }
  return {
    seq: event.seq,
    ts: event.ts,
    // domain=core is the storage-level discriminator; Presentation kinds are rejected above.
    kind: event.kind as LogEvent['kind'],
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
  return (await listEvents(db, afterSeq, { domain: 'core' })).map(toLogEvent);
}
