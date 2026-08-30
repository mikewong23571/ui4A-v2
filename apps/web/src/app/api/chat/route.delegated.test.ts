import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { GET as getSitemapRoute } from '../../.well-known/ui4a.json/route';
import { GET as getEntityRoute } from '../entity/route';
import { POST as postExecRoute } from '../exec/route';
import { POST as postChat } from './route';

// /api/chat mode=delegated(T5 Phase B / Task 1):委托派发路径的路由测试。
// 与 route.test.ts(inline 口径)互补——本文件只测新增分支:
// - delegated:校验 goal → 派发 delegationWorkflow(dispatch 模块 vi.mock 替身)
//   → 200 {mode:'delegated', delegationId, statusUrl:'/api/delegations/<id>'};
// - auto/default 与显式 llm 均以 llm 派发，不存在 rule fallback;
// - 缺省 mode 仍是 inline(dispatch 不被调用,响应无 delegationId);
// - 派发失败(Temporal 不可达)→ 503 据实(委托没派出去不能假装成功)。
// T9 Phase B:inline 对照路径改 SSE 流——helper 解析 final 帧 payload 为 json,
// delegated/参数错误仍一次性 JSON(形状不动)。
//
// 回环:node:http server 转交真实 route handler(与 route.test.ts 同装置)。
const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

vi.mock('../../../temporal/delegation', () => ({
  dispatchDelegation: dispatchMock,
}));

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

let server: Server;
let base = '';

async function handler(pathname: string, request: Request): Promise<Response> {
  if (pathname === '/api/entity') return getEntityRoute(request);
  if (pathname === '/api/exec') return postExecRoute(request);
  if (pathname === '/.well-known/ui4a.json') return getSitemapRoute();
  if (pathname === '/api/chat') return postChat(request);
  return Response.json({ error: 'not found' }, { status: 404 });
}

async function chat(
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  // inline(T9 Phase B)为 SSE 流:final 帧 payload 即回合结果(同旧 JSON 字段)。
  if (contentType.includes('text/event-stream')) {
    const raw = await response.text();
    const finalLine = raw
      .split('\n\n')
      .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
      .filter((line): line is string => line !== undefined)
      .map((line) => JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>)
      .find((frame) => frame.type === 'final');
    return {
      status: response.status,
      json: (finalLine?.payload ?? {}) as Record<string, unknown>,
    };
  }
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

function delegatedView(scope = 'default', focus: string | null = null) {
  return {
    schemaVersion: 2,
    presence: {
      clientInstanceId: 'client:delegated',
      site: 'workstation',
      scope,
      thread: null,
      focus,
    },
  };
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
  dispatchMock.mockReset();
  dispatchMock.mockImplementation(async () => ({
    delegationId: '11111111-2222-3333-4444-555555555555',
  }));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('mode=delegated(委托派发)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'http://127.0.0.1:1/v1';
    process.env.LLM_MODEL = 'test-model';
  });

  afterEach(() => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
  });

  it('缺少显式 Application 视角时结构化拒绝，不从授予集合偷选', async () => {
    const { status, json } = await chat({ goal: { verb: '发布' }, mode: 'delegated' });

    expect(status).toBe(400);
    expect(String(json.error)).toContain('显式选择');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('派发成功 → 200 {mode, delegationId, statusUrl},auto 以 llm 传入', async () => {
    const { status, json } = await chat({
      goal: { verb: '发布一篇文章', fields: { title: '委托发布' } },
      mode: 'delegated',
      sessionId: 'sess-d1',
      clientView: delegatedView('default', 'flow:article-drafting'),
    });

    expect(status).toBe(200);
    expect(json.mode).toBe('delegated');
    expect(json.delegationId).toBe('11111111-2222-3333-4444-555555555555');
    expect(json.statusUrl).toBe('/api/delegations/11111111-2222-3333-4444-555555555555');

    // 派发参数:goal 原样;driverKind 是 AI-first 的 llm;
    // startRel 是用户显式聚焦的 publishing Flow,不存在 default 入口回退;
    // principal 沿用 chat 会话口径;
    // baseUrl 是自身 origin(activity 内 fetch 引擎合同的回环本源)。
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const args = dispatchMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.goal).toEqual({ verb: '发布一篇文章', fields: { title: '委托发布' } });
    expect(args.driverKind).toBe('llm');
    expect(args.scope).toBe('default');
    expect(args.startRel).toBe('flow:article-drafting');
    expect(args.principal).toBe('user:sess-d1');
    expect(args.baseUrl).toBe(base);
  });

  it('uses assembled scope and client-view focus as delegated context facts', async () => {
    await chat({
      goal: { verb: '检查当前文章' },
      mode: 'delegated',
      sessionId: 'sess-focused',
      clientView: delegatedView('default', 'post:first-post'),
    });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    // Durable work receives the explicitly selected authorized application and current focus.
    expect((dispatchMock.mock.calls[0]![0] as Record<string, unknown>).scope).toBe('default');
    expect((dispatchMock.mock.calls[0]![0] as Record<string, unknown>).startRel).toBe(
      'post:first-post',
    );
  });

  it('auto 与显式 llm 都以 llm 直传', async () => {
    await chat({ goal: { verb: '发布' }, mode: 'delegated', clientView: delegatedView() });
    expect((dispatchMock.mock.calls[0]![0] as Record<string, unknown>).driverKind).toBe('llm');

    await chat({
      goal: { verb: '发布' },
      mode: 'delegated',
      driver: 'llm',
      clientView: delegatedView(),
    });
    expect((dispatchMock.mock.calls[1]![0] as Record<string, unknown>).driverKind).toBe('llm');
  });

  it('派发失败(Temporal 不可达)→ 503 结构化错误,不伪成功', async () => {
    dispatchMock.mockRejectedValueOnce(new Error('ECONNREFUSED 7233'));

    const { status, json } = await chat({
      goal: { verb: '发布' },
      mode: 'delegated',
      clientView: delegatedView(),
    });
    expect(status).toBe(503);
    expect(JSON.stringify(json)).toContain('ECONNREFUSED 7233');
    expect(json.delegationId).toBeUndefined();
  });
});

describe('mode 缺省与形状校验(inline 既有行为不动)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  beforeEach(() => {
    // 缺配置的 inline 对照应快速失败，且绝不派发委托。
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
  });

  it('缺省 mode → inline 路径:dispatch 不被调用,响应无 delegationId/statusUrl', async () => {
    const { status, json } = await chat({
      goal: {
        verb: '发布一篇文章',
        fields: {
          title: 'delegated 测试的 inline 对照',
          category: 'tech',
          tags: 'inline',
          body: '正文:mode 缺省走 inline。',
        },
      },
    });

    expect(status).toBe(200);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(json.delegationId).toBeUndefined();
    expect(json.statusUrl).toBeUndefined();
    expect(json.outcome).toBe('failed');
    expect(json.driver).toBe('llm');
  });

  it('非法 mode → 400', async () => {
    const { status } = await chat({ goal: { verb: '发布' }, mode: 'background' });
    expect(status).toBe(400);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
