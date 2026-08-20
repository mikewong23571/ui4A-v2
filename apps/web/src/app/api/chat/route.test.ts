/**
 * /api/chat 路由测试(T2 Phase E / Task E2)。
 *
 * 聊天路由在服务端组装 driver 并跑 runAgent(循环过 HTTP 合同,actor=agent,
 * channel=chat)。route 直测经"进程内回环":node:http server 把请求转交给真实
 * route handler(/api/entity、/api/exec、/.well-known/ui4a.json、/api/chat),
 * 聊天路由的 loopback fetch(取 request.url origin)原样命中——不依赖外部 dev server。
 *
 * 覆盖:
 * - I1(路由级):无 GLM_API_KEY → auto 回退 rule → B1 目标完成,文章计数 +1,
 *   轨迹消息含三步填充 + publish;
 * - B4(路由级):坏 key + 显式 llm → 401 错误原文进对话,route 不 5xx;
 * - 请求形状:缺 goal → 400。
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { GET as getSitemapRoute } from '../../.well-known/ui4a.json/route';
import { GET as getEntityRoute } from '../entity/route';
import { POST as postExecRoute } from '../exec/route';
import { GET as getEventsRoute } from '../events/route';
import { POST as postChat } from './route';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

// ---- 进程内回环:HTTP → 真实 route handler -----------------------------------

let server: Server;
let base = '';

async function handler(pathname: string, request: Request): Promise<Response> {
  if (pathname === '/api/entity') return getEntityRoute(request);
  if (pathname === '/api/exec') return postExecRoute(request);
  if (pathname === '/api/events') return getEventsRoute(request);
  // sitemap 路由无查询参数(签名零参)
  if (pathname === '/.well-known/ui4a.json') return getSitemapRoute();
  if (pathname === '/api/chat') return postChat(request);
  return Response.json({ error: 'not found' }, { status: 404 });
}

/** 401 LLM 桩:任何路径返回 401(B4 的确定性错误源)。 */
function createUnauthorizedStub(): Promise<Server & { port(): number }> {
  return new Promise((resolve) => {
    const stub = createServer((req, res) => {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { code: '1002', message: '令牌无效或已过期' } }));
    }) as Server & { port(): number };
    stub.port = () => (stub.address() as { port: number }).port;
    stub.listen(0, '127.0.0.1', () => resolve(stub));
  });
}

interface ChatResponseBody {
  sessionId?: string;
  driver?: string;
  requestedDriver?: string;
  outcome?: string;
  summary?: string | null;
  messages?: { role: string; text: string }[];
  steps?: unknown[];
  successes?: unknown[];
  error?: string;
}

async function chat(
  body: Record<string, unknown>,
): Promise<{ status: number; json: ChatResponseBody }> {
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as ChatResponseBody };
}

async function articleCount(): Promise<number> {
  const response = await fetch(`${base}/api/entity?rel=articles`);
  return ((await response.json()) as { properties: { count: number } }).properties.count;
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
  server = createServer(async (req, res) => {
    // 用真实 host 构造 Request:聊天路由经 request.url 的 origin 回环 fetch 自身。
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

describe('I1(路由级):无 key → auto 回退 rule,B1 完成', () => {
  const envKey = process.env.GLM_API_KEY;

  beforeEach(() => {
    delete process.env.GLM_API_KEY;
  });

  afterEach(() => {
    if (envKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = envKey;
  });

  it('auto → rule:发布目标三步填充 + publish,文章计数 2→3', async () => {
    expect(await articleCount()).toBe(2);

    const { status, json } = await chat({
      goal: {
        verb: '发布一篇文章',
        fields: {
          title: 'chat 的第三篇',
          category: 'tech',
          tags: 'chat',
          body: '第三篇正文:由 chat 路由(rule 回退)发布。',
        },
      },
    });

    expect(status).toBe(200);
    expect(json.driver).toBe('rule');
    expect(json.outcome, JSON.stringify(json.messages)).toBe('done');

    const trajectory = (json.messages ?? []).map((message) => message.text).join('\n');
    expect(trajectory.match(/执行 next/g)).toHaveLength(3);
    expect(trajectory).toContain('执行 publish');
    expect(trajectory).toContain('完成');

    expect(await articleCount()).toBe(3);
  });

  it('事件日志:chat 循环的 exec 带 actor=agent、channel=chat、principal', async () => {
    await chat({
      sessionId: 'sess-42',
      goal: {
        verb: '发布一篇文章',
        fields: { title: '留痕', category: 'essay', tags: '', body: '正文' },
      },
    });

    const response = await fetch(`${base}/api/events`);
    const body = (await response.json()) as {
      events: { kind: string; actor: string; channel: string; principal: string }[];
    };
    const publish = body.events.filter(
      (event) =>
        event.kind === 'action-executed' &&
        (event as unknown as { action: string }).action === 'publish',
    );
    expect(publish).toHaveLength(1);
    expect(publish[0]).toMatchObject({
      actor: 'agent',
      channel: 'chat',
      principal: 'user:sess-42',
    });
  });
});

describe('B4(路由级):坏 key → 401 原文进对话,route 不 5xx', () => {
  const envKey = process.env.GLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  let stub: Server & { port(): number };

  beforeEach(async () => {
    stub = await createUnauthorizedStub();
    process.env.GLM_API_KEY = 'invalid-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
  });

  afterEach(async () => {
    if (envKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  it('llm driver 401 → 200 响应携带失败轨迹与 401 原文', async () => {
    const { status, json } = await chat({
      goal: { verb: '发布一篇文章' },
      driver: 'llm',
    });

    expect(status).toBe(200); // 委托不崩溃:拒绝/失败也是合同的一部分
    expect(json.outcome).toBe('failed');
    expect(json.driver).toBe('llm');
    const trajectory = JSON.stringify(json);
    expect(trajectory).toContain('401');
    expect(trajectory).toContain('令牌无效或已过期');
  });

  it('同一 session 再发一次:循环存活,行为一致', async () => {
    const first = await chat({ goal: { verb: '发布一篇文章' }, sessionId: 'b4', driver: 'llm' });
    expect(first.status).toBe(200);

    const second = await chat({ goal: { verb: '发布一篇文章' }, sessionId: 'b4', driver: 'llm' });
    expect(second.status).toBe(200);
    expect(second.json.outcome).toBe('failed');
    expect(JSON.stringify(second.json)).toContain('401');
  });
});

describe('请求形状', () => {
  it('缺 goal → 400;非法 driver → 400', async () => {
    expect((await chat({})).status).toBe(400);
    expect((await chat({ goal: { verb: '' } })).status).toBe(400);
    expect((await chat({ goal: { verb: '发布' }, driver: 'smarter' })).status).toBe(400);
  });
});
