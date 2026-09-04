import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getPool } from './pool';

import {
  EVENTS_DDL,
  appendEvent,
  ensureEventsTable,
  listEvents,
  readLog,
  type StoredEvent,
} from './events';

// T2 Phase B Task 1(TDD 红→绿):events 表与 appendEvent。
// 前置:`docker compose up -d --wait`(postgres:17-alpine,宿主端口 5433)。
// 覆盖:幂等建表(DDL 与 events.sql 迁移工件逐字一致)、seq 单调递增、
// 字段完整往返(jsonb params 带出处 / reason / detail)、append-only 铁律
// (UPDATE/DELETE 被行级触发器拒绝)。
const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);

afterAll(async () => {
  // 测试收尾清空日志并归还连接(池进程级复用,不 end;保持容器运行)。
  await pool.query('TRUNCATE events');
});

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
});

describe('events 表迁移', () => {
  it('内置 DDL 与 events.sql 迁移工件逐字一致(单一真相,防漂移)', () => {
    const sqlPath = join(dirname(fileURLToPath(import.meta.url)), 'events.sql');
    expect(EVENTS_DDL.trim()).toBe(readFileSync(sqlPath, 'utf8').trim());
  });

  it('ensureEventsTable 幂等(重复执行不抛错、不重置 seq)', async () => {
    const first = await appendEvent(pool, { kind: 'seed', rel: 'seed:test' });
    await ensureEventsTable(pool);
    await ensureEventsTable(pool);
    const second = await appendEvent(pool, { kind: 'seed', rel: 'seed:test' });
    expect(second.seq).toBe(first.seq + 1);
  });
});

describe('appendEvent', () => {
  it('seq 由 bigserial 单调递增分配,ts 由库时钟填充', async () => {
    const a = await appendEvent(pool, { kind: 'seed', rel: 'seed:test' });
    const b = await appendEvent(pool, {
      kind: 'action-executed',
      rel: 'post:x',
      action: 'unpublish',
    });

    expect(typeof a.seq).toBe('number');
    expect(b.seq).toBe(a.seq + 1);
    expect(a.ts).toBeInstanceOf(Date);
    expect(a.ts.getTime()).toBeGreaterThan(0);
  });

  it('字段完整往返:actor/principal/channel/params(带出处)/reason/detail', async () => {
    await appendEvent(pool, {
      kind: 'action-rejected',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
      params: {
        body: { value: '好文章', origin: 'intent' },
        score: { value: 5, origin: 'default' },
      },
      reason: 'guard 不满足: is-pending=false',
      detail: [{ name: 'is-pending', pass: false, reason: 'node=approved' }],
    });

    const events = await listEvents(pool);
    expect(events).toHaveLength(1);
    const event: StoredEvent = events[0]!;
    expect(event.kind).toBe('action-rejected');
    expect(event.rel).toBe('comment:c1');
    expect(event.action).toBe('approve');
    expect(event.actor).toBe('agent');
    expect(event.principal).toBe('user:mike');
    expect(event.channel).toBe('http');
    expect(event.params).toEqual({
      body: { value: '好文章', origin: 'intent' },
      score: { value: 5, origin: 'default' },
    });
    expect(event.reason).toBe('guard 不满足: is-pending=false');
    expect(event.detail).toEqual([{ name: 'is-pending', pass: false, reason: 'node=approved' }]);
  });
});

describe('append-only 铁律(arch-brief §4)', () => {
  it('UPDATE 被行级触发器拒绝', async () => {
    const { seq } = await appendEvent(pool, { kind: 'seed', rel: 'seed:test' });

    await expect(
      pool.query("UPDATE events SET rel = 'tampered' WHERE seq = $1", [seq]),
    ).rejects.toThrow(/append-only/i);
  });

  it('DELETE 被行级触发器拒绝', async () => {
    const { seq } = await appendEvent(pool, { kind: 'seed', rel: 'seed:test' });

    await expect(pool.query('DELETE FROM events WHERE seq = $1', [seq])).rejects.toThrow(
      /append-only/i,
    );
  });

  it('日志在拒绝后保持原样(tamper 未生效)', async () => {
    const { seq } = await appendEvent(pool, { kind: 'seed', rel: 'seed:test' });

    await expect(
      pool.query("UPDATE events SET kind = 'action-executed' WHERE seq = $1", [seq]),
    ).rejects.toThrow();

    const events = await listEvents(pool);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('seed');
  });
});

describe('listEvents', () => {
  it('按 seq 升序返回,afterSeq 过滤分页', async () => {
    for (let index = 1; index <= 3; index += 1) {
      await appendEvent(pool, { kind: 'seed', rel: `seed:test-${index}` });
    }

    const all = await listEvents(pool);
    expect(all.map((event) => event.rel)).toEqual(['seed:test-1', 'seed:test-2', 'seed:test-3']);
    expect(all.map((event) => event.seq)).toEqual(
      [...all.map((event) => event.seq)].sort((a, b) => a - b),
    );

    const afterFirst = await listEvents(pool, all[0]!.seq);
    expect(afterFirst.map((event) => event.rel)).toEqual(['seed:test-2', 'seed:test-3']);
  });

  it('按 seq 倒序读取最新事件,并以 beforeSeq 向更早事件翻页', async () => {
    const first = await appendEvent(pool, { kind: 'seed', rel: 'seed:desc-1' });
    await appendEvent(pool, { kind: 'seed', rel: 'seed:desc-2' });
    await appendEvent(pool, { kind: 'seed', rel: 'seed:desc-3' });

    const latest = await listEvents(pool, 0, { order: 'desc', limit: 2 });
    expect(latest.map((event) => event.seq)).toEqual([first.seq + 2, first.seq + 1]);

    const older = await listEvents(pool, 0, {
      order: 'desc',
      beforeSeq: latest.at(-1)!.seq,
      limit: 2,
    });
    expect(older.map((event) => event.seq)).toEqual([first.seq]);
  });

  it('principal 过滤:仅返回该 principal 名下事件,他人不可见(T49 D68.3 读侧收窄锚点)', async () => {
    const chatTurn = (principal: string, sessionId: string, turnId: string) =>
      appendEvent(pool, {
        kind: 'chat-turn',
        rel: `chat:${sessionId}`,
        actor: 'agent',
        principal,
        channel: 'chat',
        detail: { sessionId, turnId },
      });
    await chatTurn('user:a', 'sess-a', 'turn-a1');
    await chatTurn('user:b', 'sess-b', 'turn-b1');
    await chatTurn('user:a', 'sess-a', 'turn-a2');

    const scoped = await listEvents(pool, 0, { principal: 'user:a' });

    // 仅 user:a 的回合,seq 升序(a1 → a2);user:b 的事件在收窄读取中不可达。
    expect(scoped.map((event) => (event.detail as { turnId: string }).turnId)).toEqual([
      'turn-a1',
      'turn-a2',
    ]);
    expect(scoped.every((event) => event.principal === 'user:a')).toBe(true);
  });

  it('Presentation domain shares the append-only log but never enters Business readLog', async () => {
    await appendEvent(pool, { kind: 'seed', rel: 'seed:business' });
    await appendEvent(pool, {
      domain: 'presentation',
      kind: 'presentation-requested',
      rel: 'presentation:req-1',
      channel: 'presentation',
    });

    expect((await listEvents(pool)).map(({ domain, kind }) => ({ domain, kind }))).toEqual([
      { domain: 'core', kind: 'seed' },
      { domain: 'presentation', kind: 'presentation-requested' },
    ]);
    expect((await readLog(pool)).map(({ kind }) => kind)).toEqual(['seed']);
  });
});
