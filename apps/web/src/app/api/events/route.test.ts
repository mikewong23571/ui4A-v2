import { beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';

import { GET } from './route';

// /api/events 契约测试(TDD 红→绿;真库,复用 Phase 2 的 pg pool):
// - 只读 GET,seq 升序,返回原始事件(含 kind/reason);
// - ?afterSeq= 分页(严格大于);
// - 非法 afterSeq → 400 结构化错误;
// - db 不可达 → 503(不抛 500)。
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const BAD_URL = 'postgres://ui4a:ui4a@localhost:5999/ui4a'; // 无监听端口,ECONNREFUSED
const pool = getPool(REAL_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

interface ApiEvent {
  seq: number;
  ts: string;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: string | null;
  reason: string | null;
}

function request(query = ''): Request {
  return new Request(`http://localhost:3100/api/events${query}`);
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
});

describe('GET /api/events', () => {
  it('按 seq 升序返回原始事件,含 kind/reason(拒绝事件可见,I6)', async () => {
    const first = await appendEvent(pool, { kind: 'seed', rel: 'seed:bootstrap' });
    await appendEvent(pool, {
      kind: 'action-rejected',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      reason: 'guard 不满足: is-pending=false',
    });
    await appendEvent(pool, {
      kind: 'action-executed',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
    });

    const res = await GET(request());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ApiEvent[] };
    // TRUNCATE 不重置 bigserial 序列,断言用相对 seq(首条 + 递增)。
    expect(body.events.map((event) => event.seq)).toEqual([
      first.seq,
      first.seq + 1,
      first.seq + 2,
    ]);
    expect(body.events.map((event) => event.kind)).toEqual([
      'seed',
      'action-rejected',
      'action-executed',
    ]);
    expect(body.events[1]).toMatchObject({
      kind: 'action-rejected',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      reason: 'guard 不满足: is-pending=false',
    });
  });

  it('?afterSeq= 分页:仅返回 seq 严格大于 afterSeq 的事件', async () => {
    const first = await appendEvent(pool, { kind: 'seed', rel: 'seed:test-1' });
    await appendEvent(pool, { kind: 'seed', rel: 'seed:test-2' });
    await appendEvent(pool, { kind: 'seed', rel: 'seed:test-3' });

    const res = await GET(request(`?afterSeq=${first.seq}`));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ApiEvent[] };
    expect(body.events.map((event) => event.seq)).toEqual([first.seq + 1, first.seq + 2]);
  });

  it('afterSeq=0 等价于全量', async () => {
    await appendEvent(pool, { kind: 'seed', rel: 'seed:test' });

    const res = await GET(request('?afterSeq=0'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ApiEvent[] };
    expect(body.events).toHaveLength(1);
  });

  it('非法 afterSeq → 400 结构化错误', async () => {
    for (const bad of ['?afterSeq=abc', '?afterSeq=-1', '?afterSeq=1.5']) {
      const res = await GET(request(bad));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('afterSeq');
    }
  });

  it('db 不可达 → 503 JSON,不抛 500', async () => {
    process.env.DATABASE_URL = BAD_URL;
    try {
      const res = await GET(request());

      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toHaveProperty('error');
    } finally {
      if (REAL_DATABASE_URL === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = REAL_DATABASE_URL;
      }
    }
  });
});
