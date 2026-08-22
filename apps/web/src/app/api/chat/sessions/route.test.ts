/**
 * GET /api/chat/sessions 路由测试(T9 会话清单)。
 *
 * 清单 = chat-turn 事件按 sessionId 分组的日志投影(与 history 同一真相源,
 * 服务端零会话态)。测试直接给定回合事件，再经 GET /api/chat/sessions
 * 验证分组投影。
 *
 * 覆盖:
 * - 多会话分组聚合:turns 计数、lastGoal/lastOutcome 取末回合、lastTs 倒序;
 * - 空日志 → { sessions: [] }(空态非错误)。
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, ensureEventsTable } from '../../../../db/events';
import { getPool } from '../../../../db/pool';
import { GET as getSessions } from './route';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

let server: Server;
let base = '';

async function handler(pathname: string, request: Request): Promise<Response> {
  void request;
  if (pathname === '/api/chat/sessions') return getSessions();
  return Response.json({ error: 'not found' }, { status: 404 });
}

interface SessionRow {
  sessionId: string;
  turns: number;
  firstTs: string;
  lastTs: string;
  lastGoal: string;
  lastOutcome: string;
}

async function sessions(): Promise<{ status: number; json: { sessions?: SessionRow[] } }> {
  const response = await fetch(`${base}/api/chat/sessions`);
  return { status: response.status, json: (await response.json()) as { sessions?: SessionRow[] } };
}

/** 投影测试直接给定已完成的 AI-first 回合事件。 */
async function runChatTurn(sessionId: string, verb: string): Promise<void> {
  await appendEvent(pool, {
    kind: 'chat-turn',
    actor: 'agent',
    principal: `user:${sessionId}`,
    channel: 'chat',
    rel: `chat:${sessionId}`,
    detail: {
      sessionId,
      turnId: crypto.randomUUID(),
      goal: { verb },
      outcome: 'done',
      summary: '已完成',
      messages: [{ role: 'assistant', text: '完成: 已完成' }],
      steps: [],
      driver: 'llm',
    },
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');
    const request = new Request(url, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
      ...(body !== '' ? { body } : {}),
    });
    const response = await handler(url.pathname, request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('聊天会话清单投影(T9)', () => {
  it('多会话分组聚合:turns 计数、末回合摘要、lastTs 倒序', async () => {
    await runChatTurn('sess-a', '发布第一篇文章');
    await runChatTurn('sess-b', '发布第二篇文章');
    await runChatTurn('sess-a', '发布第三篇文章');

    const { status, json } = await sessions();
    expect(status).toBe(200);
    const rows = json.sessions ?? [];
    expect(rows).toHaveLength(2);

    const a = rows.find((row) => row.sessionId === 'sess-a');
    const b = rows.find((row) => row.sessionId === 'sess-b');
    expect(a?.turns).toBe(2);
    expect(a?.lastGoal).toBe('发布第三篇文章');
    expect(a?.lastOutcome).toBe('done');
    expect(b?.turns).toBe(1);
    expect(b?.lastGoal).toBe('发布第二篇文章');
    // lastTs 倒序:sess-a 末回合最晚,排最前。
    expect(rows[0]!.sessionId).toBe('sess-a');
    expect(Date.parse(rows[0]!.lastTs)).toBeGreaterThanOrEqual(Date.parse(rows[0]!.firstTs));
  });

  it('空日志 → 空 sessions(空态非错误)', async () => {
    const { status, json } = await sessions();
    expect(status).toBe(200);
    expect(json.sessions).toEqual([]);
  });
});
