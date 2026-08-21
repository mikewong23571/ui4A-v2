/**
 * /api/chat 路由 render capability 测试(T7 Phase C,S5 的路由级口径)。
 *
 * 聊天目标的展示类意图(按分类展示文章)在路由内短路进生成路径:
 * renderSpecFor(rule 确定)→ 零字面校验 → freezeSpec(首冻事件留痕)→
 * 响应携带 render 载荷(spec + 画布入口);零 /api/exec(渲染不是执行)。
 * 复用 route.test.ts 的进程内回环模式(route handler 直调 + loopback fetch,
 * 真 PG:凝固是引擎写路径,合同级断言走 /api/events 与 /api/entity)。
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as getSitemapRoute } from '../../.well-known/ui4a.json/route';
import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { validateSpec } from '../../../render/validator';

import { GET as getEntityRoute } from '../entity/route';
import { GET as getEventsRoute } from '../events/route';
import { POST as postExecRoute } from '../exec/route';
import { POST as postChat } from './route';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

let server: Server;
let base = '';

async function handler(pathname: string, request: Request): Promise<Response> {
  if (pathname === '/api/entity') return getEntityRoute(request);
  if (pathname === '/api/events') return getEventsRoute(request);
  if (pathname === '/api/exec') return postExecRoute(request);
  if (pathname === '/api/chat') return postChat(request);
  if (pathname === '/.well-known/ui4a.json') return getSitemapRoute();
  return Response.json({ error: 'not found' }, { status: 404 });
}

interface RenderPayload {
  concern: string;
  spec: { concern: string; component: string; bind: unknown };
  frozenNow: boolean;
  canvasUrl: string;
}

interface ChatRenderResponseBody {
  sessionId?: string;
  driver?: string;
  outcome?: string;
  summary?: string | null;
  messages?: { role: string; text: string }[];
  steps?: unknown[];
  render?: RenderPayload;
}

async function chat(
  body: Record<string, unknown>,
): Promise<{ status: number; json: ChatRenderResponseBody }> {
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as ChatRenderResponseBody };
}

async function eventsOf(): Promise<{ kind: string; actor?: string; principal?: string }[]> {
  const response = await fetch(`${base}/api/events`);
  const body = (await response.json()) as { events: { kind: string; actor?: string; principal?: string }[] };
  return body.events ?? [];
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

describe('chat render capability:展示意图 → spec 生成 + 凝固', () => {
  it('"按分类展示文章" → chart spec(零字面)+ 首冻事件 + 画布入口;零 exec', async () => {
    const { status, json } = await chat({
      sessionId: 's5-render',
      driver: 'rule',
      goal: { verb: '按分类展示文章' },
    });

    expect(status).toBe(200);
    expect(json.outcome).toBe('done');
    expect(json.driver).toBe('rule');
    expect(json.render).toBeDefined();
    expect(json.render!.concern).toBe('articles-by-category');
    expect(json.render!.spec).toEqual({
      concern: 'articles-by-category',
      component: 'chart',
      bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
    });
    // S5 铁律断言:spec 递归零字面(复用零字面校验器,同 e2e 口径)。
    expect(validateSpec(json.render!.spec)).toEqual({ valid: true });
    expect(json.render!.frozenNow).toBe(true);
    expect(json.render!.canvasUrl).toBe('/canvas?concern=articles-by-category');
    // 轨迹为空:渲染走生成路径,不经 agent 循环(零 /api/exec)。
    expect(json.steps).toEqual([]);
    const trajectory = (json.messages ?? []).map((message) => message.text).join('\n');
    expect(trajectory).toContain('/canvas?concern=articles-by-category');

    const events = await eventsOf();
    const frozen = events.filter((event) => event.kind === 'render-spec-frozen');
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ actor: 'agent', principal: 'user:s5-render' });
    expect(events.filter((event) => event.kind === 'action-executed')).toHaveLength(0);
  });

  it('凝固:同 concern 二次请求 → 同 spec(首冻为准),仅一条 frozen 事件', async () => {
    const first = await chat({ sessionId: 's5-render', driver: 'rule', goal: { verb: '按分类展示文章' } });
    expect(first.json.render!.frozenNow).toBe(true);

    const second = await chat({ sessionId: 's5-render', driver: 'rule', goal: { verb: '图表 文章 分类' } });
    expect(second.status).toBe(200);
    expect(second.json.render!.spec).toEqual(first.json.render!.spec);
    expect(second.json.render!.frozenNow).toBe(false);

    const frozen = (await eventsOf()).filter((event) => event.kind === 'render-spec-frozen');
    expect(frozen).toHaveLength(1);
  });

  it('凝固 spec 经合同可查:/api/entity?rel=render-specs 携带该成员', async () => {
    await chat({ sessionId: 's5-render', driver: 'rule', goal: { verb: '按分类展示文章' } });
    const response = await fetch(`${base}/api/entity?rel=render-specs`);
    const body = (await response.json()) as {
      entities: { properties: { concern: string; component: string; bind: unknown } }[];
    };
    expect(body.entities.some((member) => member.properties.concern === 'articles-by-category')).toBe(true);
  });

  it('非展示意图不受影响:发布目标仍走 agent 循环(无 render 载荷)', async () => {
    const { status, json } = await chat({
      sessionId: 's5-render',
      driver: 'rule',
      goal: {
        verb: '发布一篇文章',
        fields: { title: '渲染路由旁路检查', category: 'tech', tags: '', body: '正文' },
      },
    });
    expect(status).toBe(200);
    expect(json.render).toBeUndefined();
    expect(json.outcome).toBe('done');
    expect((json.steps ?? []).length).toBeGreaterThan(0);
  });
});
