/**
 * /api/chat 路由 render capability 测试(T7 Phase C,S5 的路由级口径)。
 *
 * 聊天目标的展示类意图(按分类展示文章)在路由内短路进生成路径:
 * renderSpecFor(rule 确定)→ 零字面校验 → freezeSpec(首冻事件留痕)→
 * 响应携带 render 载荷(spec + 画布入口);零 /api/exec(渲染不是执行)。
 * 复用 route.test.ts 的进程内回环模式(route handler 直调 + loopback fetch,
 * 真 PG:凝固是引擎写路径,合同级断言走 /api/events 与 /api/entity)。
 *
 * T12 Phase A(架构决定 1):rule miss 的展示意图 → LLM fallthrough(mock
 * LLM 桩经 GLM_API_KEY + LLM_BASE_URL 注入)——buildRenderPrompt(词汇表 +
 * sitemap 处境)→ streamText → parseRenderResponse(fail-safe)→ 同一零字面
 * 校验 + 处境核对 + 词条形状 → 凝固 → 响应;解析失败/零字面违规/假字段 →
 * 原路交回普通循环(不凝固);无 key 跳过 LLM 路径(I1,rule 路径完整)。
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as getSitemapRoute } from '../../.well-known/ui4a.json/route';
import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { RENDER_WORDS } from '../../../render/registry';
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
  focus?: { rel: string; canvasUrl: string };
}

async function chat(
  body: Record<string, unknown>,
): Promise<{ status: number; json: ChatRenderResponseBody; raw: string }> {
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') ?? '';
  // inline(T9 Phase B)为 SSE 流:final 帧 payload 即回合结果(同旧 JSON 字段);
  // 渲染 LLM 路径已 SSE 化:render 帧载荷即回执(与 JSON 同形);rule 命中
  // 仍为一次性 JSON(形状不动)。
  if (contentType.includes('text/event-stream')) {
    const raw = await response.text();
    const frames = raw
      .split('\n\n')
      .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
      .filter((line): line is string => line !== undefined)
      .map((line) => JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>);
    const renderFrame = frames.find((frame) => frame.type === 'render');
    if (renderFrame !== undefined) {
      return {
        status: response.status,
        json: renderFrame.payload as ChatRenderResponseBody,
        raw,
      };
    }
    const finalFrame = frames.find((frame) => frame.type === 'final');
    return {
      status: response.status,
      json: (finalFrame?.payload ?? {}) as ChatRenderResponseBody,
      raw,
    };
  }
  return {
    status: response.status,
    json: (await response.json()) as ChatRenderResponseBody,
    raw: '',
  };
}

async function eventsOf(): Promise<{ kind: string; actor?: string; principal?: string }[]> {
  const response = await fetch(`${base}/api/events`);
  const body = (await response.json()) as {
    events: { kind: string; actor?: string; principal?: string }[];
  };
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
  it('"我要看看第一篇文章" → 具体实体 focus，零集合 render freeze/零 exec', async () => {
    const { status, json } = await chat({
      sessionId: 'read-first-post',
      driver: 'rule',
      goal: { verb: '我要看看第一篇文章' },
    });

    expect(status).toBe(200);
    expect(json.outcome).toBe('done');
    expect(json.focus).toEqual({
      rel: 'post:first-post',
      canvasUrl: '/canvas?focus=post%3Afirst-post',
    });
    expect(json.render).toBeUndefined();
    expect(json.messages?.[0]?.text).toContain('第一篇');
    const events = await eventsOf();
    expect(events.filter((event) => event.kind === 'render-spec-frozen')).toHaveLength(0);
    expect(events.filter((event) => event.kind === 'action-executed')).toHaveLength(0);
  });

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
    const first = await chat({
      sessionId: 's5-render',
      driver: 'rule',
      goal: { verb: '按分类展示文章' },
    });
    expect(first.json.render!.frozenNow).toBe(true);

    const second = await chat({
      sessionId: 's5-render',
      driver: 'rule',
      goal: { verb: '图表 文章 分类' },
    });
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
    expect(
      body.entities.some((member) => member.properties.concern === 'articles-by-category'),
    ).toBe(true);
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

// ---- T12 Phase A:rule miss 的展示意图 → LLM fallthrough(mock LLM)----------

type RenderLlmStub = Server & { port(): number; calls: string[] };

/**
 * 脚本化 render LLM 桩(SSE 流式;与 route.test.ts 的 LLM 桩同传输形态):
 * 任何请求回一段 chat.completion.chunk 序列(content = text;可选 reasoning
 * 片段先行——断言渲染路径 SSE 化的 thinking-delta 增量帧),请求体原文留痕
 * (断言处境披露:prompt 须携带意图 + sitemap 集合面 + 词汇表)。
 */
function createRenderLlmStub(
  text: string,
  options: { reasoning?: string[] } = {},
): Promise<RenderLlmStub> {
  return new Promise((resolve) => {
    const calls: string[] = [];
    const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-render',
        object: 'chat.completion.chunk',
        created: 1756000000,
        model: 'glm-test',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}`;
    const stub = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (piece: Buffer) => chunks.push(piece));
      req.on('end', () => {
        calls.push(Buffer.concat(chunks).toString('utf8'));
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.end(
          `${[
            ...(options.reasoning ?? []).map((piece) => chunk({ reasoning_content: piece })),
            chunk({ role: 'assistant', content: text }),
            chunk({}, 'stop'),
            'data: [DONE]',
          ].join('\n\n')}\n\n`,
        );
      });
    }) as RenderLlmStub;
    stub.port = () => (stub.address() as { port: number }).port;
    stub.calls = calls;
    stub.listen(0, '127.0.0.1', () => resolve(stub));
  });
}

function closeStub(stub: RenderLlmStub): Promise<void> {
  return new Promise((resolve) => stub.close(() => resolve()));
}

describe('T12 Phase A(架构决定 1):rule miss 的展示意图 → LLM fallthrough(mock LLM)', () => {
  const envKey = process.env.GLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;

  afterEach(() => {
    if (envKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
  });

  it('LLM 产 kanban spec → 同一零字面校验 → 凝固 → SSE render 帧(思考增量先行;bind 零字面,component 取自词汇表)', async () => {
    const stub = await createRenderLlmStub(
      JSON.stringify({
        concern: 'articles-board',
        component: 'kanban',
        bind: { columns: { collection: 'articles' } },
      }),
      { reasoning: ['先看词汇表', ',再定词条。'] },
    );
    try {
      process.env.GLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;

      const { status, json, raw } = await chat({
        sessionId: 't12-llm-render',
        driver: 'rule',
        // rule miss:展示意图命中(展示),但"飞船"不在名词词表/sitemap 集合面。
        goal: { verb: '展示飞船列表' },
      });

      expect(status).toBe(200);
      expect(json.outcome).toBe('done');
      expect(json.render).toBeDefined();
      expect(json.render!.concern).toBe('articles-board');
      expect(json.render!.spec).toEqual({
        concern: 'articles-board',
        component: 'kanban',
        bind: { columns: { collection: 'articles' } },
      });
      // 验收 2:component 取自词汇表(与 /api/render/catalog 同源);bind 递归零字面。
      expect(RENDER_WORDS.some((word) => word.name === json.render!.spec.component)).toBe(true);
      expect(validateSpec(json.render!.spec)).toEqual({ valid: true });
      expect(json.render!.frozenNow).toBe(true);
      expect(json.render!.canvasUrl).toBe('/canvas?concern=articles-board');
      // 渲染走生成路径,不经 agent 循环(零 /api/exec)。
      expect(json.steps).toEqual([]);

      // 渲染路径 SSE 化:thinking-delta 增量帧(步号恒 1)先于 render 帧。
      const deltaFrames = raw
        .split('\n\n')
        .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
        .filter((line): line is string => line !== undefined)
        .map((line) => JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>);
      const deltaIndex = deltaFrames.findIndex((frame) => frame.type === 'thinking-delta');
      const renderIndex = deltaFrames.findIndex((frame) => frame.type === 'render');
      expect(deltaIndex, 'SSE 流含 thinking-delta 增量帧').toBeGreaterThanOrEqual(0);
      expect(renderIndex, 'SSE 流含 render 回执帧').toBeGreaterThanOrEqual(0);
      expect(deltaIndex, '思考增量先于 render 帧').toBeLessThan(renderIndex);
      expect(deltaFrames[deltaIndex]).toMatchObject({ step: 1, text: '先看词汇表' });

      // LLM 恰被调一次;prompt 处境披露(意图 + sitemap 集合面 + 词汇表词名)。
      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]).toContain('展示飞船列表');
      expect(stub.calls[0]).toContain('articles');
      expect(stub.calls[0]).toContain('kanban');

      const events = await eventsOf();
      const frozen = events.filter((event) => event.kind === 'render-spec-frozen');
      expect(frozen).toHaveLength(1);
      expect(frozen[0]).toMatchObject({ actor: 'agent', principal: 'user:t12-llm-render' });
      expect(events.filter((event) => event.kind === 'action-executed')).toHaveLength(0);
    } finally {
      await closeStub(stub);
    }
  });

  it('三拒之一:LLM 产非法 JSON → 解析失败,原路交回普通 agent 循环(不凝固)', async () => {
    const stub = await createRenderLlmStub('抱歉,我无法生成渲染说明。');
    try {
      process.env.GLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;

      const { status, json } = await chat({
        sessionId: 't12-llm-bad-json',
        driver: 'rule',
        goal: { verb: '展示飞船列表' },
      });

      // 交回普通循环:SSE final 帧到达(rule driver 对未匹配意图如实 fail),无 render 载荷。
      expect(status).toBe(200);
      expect(json.render).toBeUndefined();
      expect(typeof json.outcome).toBe('string');
      expect(stub.calls).toHaveLength(1);
      // 不留半成品 spec:零凝固、零 exec。
      const events = await eventsOf();
      expect(events.filter((event) => event.kind === 'render-spec-frozen')).toHaveLength(0);
      expect(events.filter((event) => event.kind === 'action-executed')).toHaveLength(0);
    } finally {
      await closeStub(stub);
    }
  });

  it('三拒之二:LLM 产零字面违规 spec(bind 含裸字符串)→ 校验器拒,交回,不凝固', async () => {
    const stub = await createRenderLlmStub(
      JSON.stringify({
        concern: 'articles-board',
        component: 'kanban',
        bind: { columns: { collection: 'articles' }, title: '飞船总览' },
      }),
    );
    try {
      process.env.GLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;

      const { status, json } = await chat({
        sessionId: 't12-llm-literal',
        driver: 'rule',
        goal: { verb: '展示飞船列表' },
      });

      expect(status).toBe(200);
      expect(json.render).toBeUndefined();
      expect(typeof json.outcome).toBe('string');
      const events = await eventsOf();
      expect(events.filter((event) => event.kind === 'render-spec-frozen')).toHaveLength(0);
      expect(events.filter((event) => event.kind === 'action-executed')).toHaveLength(0);
    } finally {
      await closeStub(stub);
    }
  });

  it('三拒之三:LLM 产假字段(维度未在 sitemap 流程声明)→ 处境核对拒,交回,不凝固', async () => {
    const stub = await createRenderLlmStub(
      JSON.stringify({
        concern: 'articles-by-ghost',
        component: 'chart',
        bind: { series: { collection: 'articles', dimension: 'articles.fields.ghost' } },
      }),
    );
    try {
      process.env.GLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;

      const { status, json } = await chat({
        sessionId: 't12-llm-ghost',
        driver: 'rule',
        goal: { verb: '展示飞船列表' },
      });

      expect(status).toBe(200);
      expect(json.render).toBeUndefined();
      expect(typeof json.outcome).toBe('string');
      const events = await eventsOf();
      expect(events.filter((event) => event.kind === 'render-spec-frozen')).toHaveLength(0);
      expect(events.filter((event) => event.kind === 'action-executed')).toHaveLength(0);
    } finally {
      await closeStub(stub);
    }
  });

  it('I1:无 key 跳过 LLM 路径——rule 命中照常凝固;rule miss 直落普通循环(LLM 零调用)', async () => {
    const stub = await createRenderLlmStub(
      '{"concern":"articles-board","component":"kanban","bind":{"columns":{"collection":"articles"}}}',
    );
    try {
      delete process.env.GLM_API_KEY;
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;

      // rule 路径完整:展示意图命中词表 → chart spec 凝固(与无 LLM 时逐字节一致)。
      const ruleHit = await chat({
        sessionId: 't12-i1',
        driver: 'rule',
        goal: { verb: '按分类展示文章' },
      });
      expect(ruleHit.status).toBe(200);
      expect(ruleHit.json.render).toBeDefined();
      expect(ruleHit.json.render!.spec).toEqual({
        concern: 'articles-by-category',
        component: 'chart',
        bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
      });

      // rule miss:无 key → LLM 路径不触发,直落普通 agent 循环。
      const miss = await chat({
        sessionId: 't12-i1',
        driver: 'rule',
        goal: { verb: '展示飞船列表' },
      });
      expect(miss.json.render).toBeUndefined();
      expect(typeof miss.json.outcome).toBe('string');
      expect(stub.calls).toHaveLength(0);
    } finally {
      await closeStub(stub);
    }
  });
});
