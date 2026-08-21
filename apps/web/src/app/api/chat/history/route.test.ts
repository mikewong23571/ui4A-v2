/**
 * GET /api/chat/history 路由测试(T9 Phase B / B3)。
 *
 * 历史 = chat-turn 事件的日志投影(服务端零会话态)。测试经进程内回环跑
 * 真实链路:POST /api/chat(inline,SSE 流跑完 → 路由直写 chat-turn)→
 * GET /api/chat/history?sessionId=… 读回回合序列。
 *
 * 覆盖:
 * - 已落回合:按 sessionId 过滤,goal/outcome/messages/driver 原样返回,
 *   seq 升序(两回合顺序保持);
 * - T11 Phase B:回合读出携带结构化 steps;T11 前写入的旧形状 detail
 *   (无 steps 字段)读出归一为空数组(向后兼容);
 * - 无该会话回合 → { turns: [] }(空态非错误);
 * - 缺 sessionId → 400。
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, ensureEventsTable } from '../../../../db/events';
import { getPool } from '../../../../db/pool';
import { resetEngineForTests } from '../../../../engine/service';

import { GET as getSitemapRoute } from '../../../.well-known/ui4a.json/route';
import { GET as getEntityRoute } from '../../entity/route';
import { POST as postExecRoute } from '../../exec/route';
import { POST as postChat } from '../route';
import { GET as getHistory } from './route';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

// ---- 进程内回环:HTTP → 真实 route handler(与 chat/route.test.ts 同方案)-----

let server: Server;
let base = '';

async function handler(pathname: string, request: Request): Promise<Response> {
  if (pathname === '/api/entity') return getEntityRoute(request);
  if (pathname === '/api/exec') return postExecRoute(request);
  // sitemap 路由无查询参数(签名零参)
  if (pathname === '/.well-known/ui4a.json') return getSitemapRoute();
  if (pathname === '/api/chat') return postChat(request);
  if (pathname === '/api/chat/history') return getHistory(request);
  return Response.json({ error: 'not found' }, { status: 404 });
}

interface HistoryTurn {
  seq: number;
  ts: string;
  sessionId: string;
  goal: { verb: string };
  outcome: string;
  summary: string | null;
  messages: { role: 'assistant'; text: string }[];
  steps: {
    step: number;
    rel: string;
    op: { kind: string; action?: string };
    outcome: string;
  }[];
  driver: string;
}

async function history(
  query: string,
): Promise<{ status: number; json: { turns?: HistoryTurn[]; error?: string } }> {
  const response = await fetch(`${base}/api/chat/history${query}`);
  return {
    status: response.status,
    json: (await response.json()) as { turns?: HistoryTurn[]; error?: string },
  };
}

/** 跑完一个 inline 回合(SSE 流整体读尽,chat-turn 在 final 前落库)。 */
async function runChatTurn(sessionId: string, verb: string): Promise<void> {
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      goal: {
        verb,
        fields: { title: `历史-${verb}`, category: 'tech', tags: '', body: '正文' },
      },
    }),
  });
  await response.text();
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
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

// ---- 场景 -------------------------------------------------------------------

describe('聊天历史投影(T9 Phase B)', () => {
  const envKey = process.env.GLM_API_KEY;

  beforeEach(() => {
    delete process.env.GLM_API_KEY; // auto → rule(确定性零外网)
  });

  afterEach(() => {
    if (envKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = envKey;
  });

  it('inline 回合落 chat-turn → history 按 sessionId 读回(goal/messages 原样,seq 升序)', async () => {
    await runChatTurn('sess-h1', '发布一篇文章');
    await runChatTurn('sess-h1', '发布另一篇文章');
    // 干扰项:别的会话的回合不得混入
    await runChatTurn('sess-other', '发布第三篇文章');

    const { status, json } = await history('?sessionId=sess-h1');
    expect(status).toBe(200);
    const turns = json.turns ?? [];
    expect(turns).toHaveLength(2);
    expect(turns[0]!.seq).toBeLessThan(turns[1]!.seq);
    expect(turns[0]!.goal.verb).toBe('发布一篇文章');
    expect(turns[1]!.goal.verb).toBe('发布另一篇文章');
    expect(turns[0]!.outcome).toBe('done');
    expect(turns[0]!.driver).toBe('rule');
    expect(turns[0]!.messages.map((message) => message.text).join('\n')).toContain('执行 publish');
    expect(turns.every((turn) => turn.sessionId === 'sess-h1')).toBe(true);
  });

  it('无该会话回合 → 空 turns(空态非错误)', async () => {
    const { status, json } = await history('?sessionId=sess-ghost');
    expect(status).toBe(200);
    expect(json.turns).toEqual([]);
  });

  it('回合读出携带结构化 steps(T11 Phase B):与 messages 并存', async () => {
    await runChatTurn('sess-steps', '发布一篇文章');

    const { status, json } = await history('?sessionId=sess-steps');
    expect(status).toBe(200);
    const turns = json.turns ?? [];
    expect(turns).toHaveLength(1);
    const { steps, messages } = turns[0]!;
    // steps 是机器可读原料(messages 仍是人读投影,口径不变)。
    expect(steps.length).toBeGreaterThan(0);
    expect(steps).toHaveLength(messages.length);
    expect(steps[0]!.op.kind, '首步是协议操作(navigate 或直接 exec)').toMatch(
      /^(navigate|exec)$/,
    );
    expect(steps[steps.length - 1]!.op.kind).toBe('done');
    expect(
      steps.every((step) => typeof step.step === 'number' && typeof step.rel === 'string'),
    ).toBe(true);
  });

  it('旧形状兼容:T11 前写入的 chat-turn(无 steps 字段)读出归一为空数组', async () => {
    // 直写一条 T11 Phase B 之前的旧形状 detail(无 steps 字段),模拟存量事件。
    await appendEvent(pool, {
      kind: 'chat-turn',
      actor: 'agent',
      principal: 'user:sess-legacy',
      channel: 'chat',
      rel: 'chat:sess-legacy',
      detail: {
        sessionId: 'sess-legacy',
        goal: { verb: '发布一篇文章' },
        outcome: 'done',
        summary: '已发布',
        messages: [{ role: 'assistant', text: '完成: 已发布' }],
        driver: 'rule',
      },
    });

    const { status, json } = await history('?sessionId=sess-legacy');
    expect(status).toBe(200);
    const turns = json.turns ?? [];
    expect(turns).toHaveLength(1);
    expect(turns[0]!.goal.verb).toBe('发布一篇文章');
    expect(turns[0]!.messages[0]!.text).toContain('完成');
    expect(turns[0]!.steps).toEqual([]);
  });

  it('缺 sessionId → 400', async () => {
    expect((await history('')).status).toBe(400);
  });
});
