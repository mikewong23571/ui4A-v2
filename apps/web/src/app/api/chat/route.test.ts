/**
 * /api/chat 路由测试(T2 Phase E / Task E2;T9 Phase B 起 inline 为 SSE)。
 *
 * 聊天路由在服务端组装 driver 并跑 runAgent(循环过 HTTP 合同,actor=agent,
 * channel=chat)。route 直测经"进程内回环":node:http server 把请求转交给真实
 * route handler(/api/entity、/api/exec、/.well-known/ui4a.json、/api/chat),
 * 聊天路由的 loopback fetch(取 request.url origin)原样命中——不依赖外部 dev server。
 *
 * T9 Phase B(SSE 流式 + chat-turn 落日志):
 * - inline 响应为 text/event-stream:每步一帧 {type:'step', message, rel},
 *   结束 {type:'final', payload:{sessionId, driver, ..., steps, successes}};
 *   本文件的 chat() helper 解析 SSE 帧并把 step 文本聚回 messages——既有
 *   I1/B4 断言(messages 口径)零改动;
 * - inline 回合完成后直写 chat-turn 事件(rel=chat:<sessionId>,detail 含
 *   goal/outcome/messages/driver)——双写者留痕,/api/events 可见;
 * - render 短路/参数错误/delegated 仍为一次性 JSON(形状不动)。
 *
 * 覆盖:
 * - I1(路由级):无完整 LLM 配置 → auto 回退 rule → B1 目标完成,文章计数 +1,
 *   轨迹消息含三步填充 + publish;
 * - B4(路由级):坏 key + 显式 llm → 401 错误原文进对话,route 不 5xx;
 * - T11 Phase B:chat-turn detail 含结构化 steps(与 trail 逐条等值);
 * - T11 Phase B Task 2:agent-decision 审计事件——inline rule/llm 回合每步一条
 *   (detail 五要素:step/driver/prompt/reasoning/op),落库失败不阻断响应;
 * - T11 Phase C Task 2:thinking 帧——llm 步 reasoning 整段成帧、先于同号 step
 *   帧推送;rule 回合零 thinking 帧、帧序列与现状逐帧一致;
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
const PUBLISH_TEST_GOAL = '对 article-drafting:main 执行 next 并 publish，发布一篇文章';
const PUBLISH_TEST_AUTHORIZATION = {
  sourceMessageId: 'route-test-turn',
  quote: PUBLISH_TEST_GOAL,
} as const;

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

/** 脚本化 LLM 桩(SSE 流式;T11 Phase C streamText 改造的传输形态——driver
 * 改走流式后桩必须讲 SSE):第一次调用返回 exec(next)+reasoning_content,
 * 其后一律 done+reasoning_content(不触网;reasoning 经 raw 部件进审计与
 * thinking 帧)。 */
function createScriptedLlmStub(): Promise<Server & { port(): number }> {
  return new Promise((resolve) => {
    let calls = 0;
    const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1755700000,
        model: 'glm-test',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}`;
    const stub = createServer((req, res) => {
      calls += 1;
      const tool =
        calls === 1
          ? {
              name: 'exec',
              args: {
                action: 'next',
                params: { title: 'LLM 决策的标题' },
                authorization: PUBLISH_TEST_AUTHORIZATION,
              },
              reasoning: '先补标题,再推进向导',
            }
          : { name: 'done', args: { summary: 'LLM 完成' }, reasoning: '字段已齐,收尾收工' };
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.end(
        `${[
          chunk({ reasoning_content: tool.reasoning }),
          chunk({
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: tool.name, arguments: JSON.stringify(tool.args) },
              },
            ],
          }),
          chunk({}, 'tool_calls'),
          'data: [DONE]',
        ].join('\n\n')}\n\n`,
      );
    }) as Server & { port(): number };
    stub.port = () => (stub.address() as { port: number }).port;
    stub.listen(0, '127.0.0.1', () => resolve(stub));
  });
}

/** AI-first B1 route fixture: the transport is scripted, while every decision
 * still traverses the production LLM driver/tool protocol. */
function createPublishingLlmStub(): Promise<Server & { port(): number }> {
  return new Promise((resolve) => {
    let calls = 0;
    const operations = [
      {
        name: 'exec',
        args: {
          action: 'next',
          params: { title: 'LLM 发布标题' },
          authorization: PUBLISH_TEST_AUTHORIZATION,
        },
      },
      {
        name: 'exec',
        args: {
          action: 'next',
          params: { category: 'tech', tags: 'chat' },
          authorization: PUBLISH_TEST_AUTHORIZATION,
        },
      },
      {
        name: 'exec',
        args: {
          action: 'next',
          params: { body: 'LLM 发布正文' },
          authorization: PUBLISH_TEST_AUTHORIZATION,
        },
      },
      {
        name: 'exec',
        args: {
          action: 'publish',
          params: { title: 'LLM 发布标题' },
          authorization: PUBLISH_TEST_AUTHORIZATION,
        },
      },
      { name: 'done', args: { summary: 'LLM 完成发布' } },
    ];
    const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-publish',
        object: 'chat.completion.chunk',
        created: 1755700000,
        model: 'test-model',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}`;
    const stub = createServer((_req, res) => {
      const operation = operations[Math.min(calls, operations.length - 1)]!;
      calls += 1;
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.end(
        `${[
          chunk({
            tool_calls: [
              {
                index: 0,
                id: `call_${calls}`,
                type: 'function',
                function: {
                  name: operation.name,
                  arguments: JSON.stringify(operation.args),
                },
              },
            ],
          }),
          chunk({}, 'tool_calls'),
          'data: [DONE]',
        ].join('\n\n')}\n\n`,
      );
    }) as Server & { port(): number };
    stub.port = () => (stub.address() as { port: number }).port;
    stub.listen(0, '127.0.0.1', () => resolve(stub));
  });
}

interface ChatResponseBody {
  sessionId?: string;
  turnId?: string;
  driver?: string;
  requestedDriver?: string;
  outcome?: string;
  summary?: string | null;
  messages?: { role: string; text: string }[];
  steps?: unknown[];
  successes?: unknown[];
  error?: string;
}

/** SSE 帧(T9 Phase B):step 逐步消息 / final 终帧 / error 兜底;
 * T11 Phase C 增 thinking 帧(llm 步推理自述,聚合整段一次性)。 */
interface SseFrame {
  type: 'session' | 'focus' | 'step' | 'final' | 'error' | 'thinking';
  turnId?: string;
  message?: { role: 'assistant'; text: string };
  rel?: string;
  refresh?: boolean;
  step?: number;
  text?: string;
  payload?: ChatResponseBody;
  error?: string;
}

/** 解析 SSE 帧流(`data: <json>` 空行分隔)。 */
function parseSseFrames(raw: string): SseFrame[] {
  return raw
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as SseFrame);
}

/**
 * POST /api/chat:inline 走 SSE(content-type 分派)——step 帧聚回 messages,
 * final payload 展开为 json(与旧一次性 JSON 同字段,既有断言零改动);
 * render/delegated/参数错误仍一次性 JSON,直解析。
 */
async function chat(body: Record<string, unknown>): Promise<{
  status: number;
  json: ChatResponseBody;
  raw: string;
  frames: SseFrame[];
  contentType: string;
}> {
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnId: 'route-test-turn', ...body }),
  });
  const raw = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const frames = parseSseFrames(raw);
    const finalFrame = frames.find((frame) => frame.type === 'final');
    const errorFrame = frames.find((frame) => frame.type === 'error');
    const messages = frames.flatMap((frame) =>
      frame.type === 'step' && frame.message !== undefined ? [frame.message] : [],
    );
    const json: ChatResponseBody =
      finalFrame?.payload !== undefined
        ? { ...finalFrame.payload, messages }
        : { error: errorFrame?.error ?? '(SSE 流无 final 帧)', messages };
    return { status: response.status, json, raw, frames, contentType };
  }
  return {
    status: response.status,
    json: JSON.parse(raw) as ChatResponseBody,
    raw,
    frames: [],
    contentType,
  };
}

async function articleCount(): Promise<number> {
  const response = await fetch(`${base}/api/entity?rel=articles`);
  return ((await response.json()) as { properties: { count: number } }).properties.count;
}

async function eventKinds(): Promise<string[]> {
  const response = await fetch(`${base}/api/events`);
  const body = (await response.json()) as { events: { kind: string }[] };
  return body.events.map((event) => event.kind);
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

describe('T15 U22:product chat runtime is AI-first', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  beforeEach(() => {
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

  it('rejects the removed product rule driver without creating events', async () => {
    const response = await chat({ goal: { verb: PUBLISH_TEST_GOAL }, driver: 'rule' });

    expect(response.status).toBe(400);
    expect(response.json.error).toContain('rule driver 已退出产品运行时');
    expect(await eventKinds()).toEqual([]);
  });

  it.each([
    ['default', undefined],
    ['auto', 'auto'],
    ['llm', 'llm'],
  ] as const)(
    '%s request reports missing LLM config and never mutates business state',
    async (_, driver) => {
      const before = await articleCount();
      const response = await chat({
        sessionId: `u22-${driver ?? 'default'}`,
        goal: { verb: PUBLISH_TEST_GOAL },
        ...(driver === undefined ? {} : { driver }),
      });

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('text/event-stream');
      expect(response.json).toMatchObject({
        driver: 'llm',
        requestedDriver: driver ?? 'auto',
        outcome: 'failed',
      });
      expect(response.json.summary).toContain('LLM 不可用');
      expect(response.json.summary).toContain('LLM_API_KEY, LLM_BASE_URL, LLM_MODEL');
      expect(response.json.summary).toContain('配置后可重试');
      expect(await articleCount()).toBe(before);
      expect(await eventKinds()).not.toContain('action-executed');
    },
  );

  it('does not bypass an unavailable LLM through a deterministic chat render shortcut', async () => {
    const response = await chat({
      sessionId: 'u22-render-unavailable',
      goal: { verb: '按分类展示文章' },
    });

    expect(response.json).toMatchObject({ driver: 'llm', outcome: 'failed' });
    expect(response.json.summary).toContain('LLM 不可用');
    expect(await eventKinds()).not.toContain('render-spec-frozen');
    expect(await eventKinds()).not.toContain('action-executed');
  });

  it('rejects delegated work before dispatch when the LLM profile is unavailable', async () => {
    const response = await chat({
      sessionId: 'u22-delegated-unavailable',
      mode: 'delegated',
      goal: { verb: PUBLISH_TEST_GOAL },
    });

    expect(response.status).toBe(503);
    expect(response.contentType).toContain('application/json');
    expect(response.json).toMatchObject({ driver: 'llm', outcome: 'failed' });
    expect(response.json.error).toContain('LLM 不可用');
    expect(await eventKinds()).not.toContain('delegation-requested');
    expect(await eventKinds()).not.toContain('action-executed');
  });
});

describe('AI-first 路由循环:配置 LLM 完成 B1', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;
  let stub: Server & { port(): number };

  beforeEach(async () => {
    stub = await createPublishingLlmStub();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
  });

  afterEach(async () => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  it('default/auto → llm:发布目标三步填充 + publish,文章计数 2→3', async () => {
    expect(await articleCount()).toBe(2);

    const { status, json } = await chat({
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: {
          title: 'chat 的第三篇',
          category: 'tech',
          tags: 'chat',
          body: '第三篇正文:由 chat 路由(LLM)发布。',
        },
      },
    });

    expect(status).toBe(200);
    expect(json.driver).toBe('llm');
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
        verb: PUBLISH_TEST_GOAL,
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

  it('SSE 帧协议:step 帧逐步先于 final,文本为 stepToMessage 口径', async () => {
    const { raw, frames, json, contentType } = await chat({
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: { title: '帧序', category: 'tech', tags: '', body: '正文' },
      },
    });

    expect(contentType).toContain('text/event-stream');
    // 帧序:若干 step → 恰好一条 final 收尾;终帧前无 final。
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[frames.length - 1]!.type).toBe('final');
    expect(
      frames
        .slice(0, -1)
        .every(
          (frame) => frame.type === 'step' || frame.type === 'session' || frame.type === 'focus',
        ),
    ).toBe(true);
    // step 帧文本口径与 trail.ts 一致(e2e 同一断言锚点)。
    const trajectory = frames
      .filter((frame) => frame.type === 'step')
      .map((frame) => frame.message!.text)
      .join('\n');
    expect(trajectory.match(/执行 next/g)).toHaveLength(3);
    expect(trajectory).toContain('执行 publish');
    expect(trajectory).toContain('完成');
    const refreshFocuses = frames.filter(
      (frame) => frame.type === 'focus' && frame.refresh === true,
    );
    expect(refreshFocuses).toHaveLength(4);
    expect(refreshFocuses.at(-1)?.rel).toBe('flow:article-drafting');
    expect(raw).toContain('data: ');
    expect(json.outcome).toBe('done');
  });

  it('chat-turn 落日志(T9 Phase B):inline 回合完成直写事件,rel=chat:<sessionId>', async () => {
    const { json } = await chat({
      sessionId: 'sess-turn',
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: { title: '回合留痕', category: 'essay', tags: '', body: '正文' },
      },
    });
    expect(json.outcome).toBe('done');

    const response = await fetch(`${base}/api/events`);
    const body = (await response.json()) as {
      events: {
        kind: string;
        rel: string;
        actor: string;
        channel: string;
        principal: string;
        detail: {
          sessionId: string;
          goal: { verb: string };
          outcome: string;
          messages: { role: string; text: string }[];
          driver: string;
        };
      }[];
    };
    const turns = body.events.filter((event) => event.kind === 'chat-turn');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      rel: 'chat:sess-turn',
      actor: 'agent',
      channel: 'chat',
      principal: 'user:sess-turn',
    });
    expect(turns[0]!.detail.sessionId).toBe('sess-turn');
    expect(turns[0]!.detail.goal.verb).toBe(PUBLISH_TEST_GOAL);
    expect(turns[0]!.detail.outcome).toBe('done');
    expect(turns[0]!.detail.driver).toBe('llm');
    expect(turns[0]!.detail.messages.map((message) => message.text).join('\n')).toContain(
      '执行 publish',
    );
  });

  it('chat-turn detail 含结构化 steps(T11 Phase B):与回合 trail 逐条等值', async () => {
    const { json } = await chat({
      sessionId: 'sess-steps',
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: { title: '结构化留痕', category: 'tech', tags: '', body: '正文' },
      },
    });
    expect(json.outcome).toBe('done');

    const response = await fetch(`${base}/api/events`);
    const body = (await response.json()) as {
      events: {
        kind: string;
        rel: string;
        detail: {
          messages: { role: string; text: string }[];
          steps: {
            step: number;
            rel: string;
            op: { kind: string; action?: string; summary?: string };
            outcome: string;
          }[];
        };
      }[];
    };
    const turns = body.events.filter(
      (event) => event.kind === 'chat-turn' && event.rel === 'chat:sess-steps',
    );
    expect(turns).toHaveLength(1);
    const { steps, messages } = turns[0]!.detail;
    // 结构化原料与 final 帧载荷的 trail(result.steps)逐条等值——
    // messages 是人读投影,steps 是同一轨迹的机器可读原料(架构决定 2)。
    expect(steps).toEqual(json.steps);
    expect(steps.length).toBeGreaterThan(0);
    // done 结局无 max-steps 补条:steps 与 messages 一步一条对应。
    expect(steps).toHaveLength(messages.length);
    expect(steps[0]!.op.kind, '首步是协议操作(navigate 或直接 exec)').toMatch(/^(navigate|exec)$/);
    expect(steps[steps.length - 1]!.op.kind).toBe('done');
    expect(
      steps.filter((step) => step.op.kind === 'exec' && step.op.action === 'next'),
    ).toHaveLength(3);
    expect(steps.some((step) => step.op.kind === 'exec' && step.op.action === 'publish')).toBe(
      true,
    );
    expect(
      steps.every((step) => typeof step.step === 'number' && typeof step.rel === 'string'),
    ).toBe(true);
  });
});

describe('T11 Phase B:agent-decision 审计事件(inline 每步决策一条)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  beforeEach(() => {
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

  /** agent-decision 事件行(只取本测试关心的字段)。 */
  interface DecisionEvent {
    seq: number;
    rel: string;
    actor: string;
    channel: string;
    principal: string;
    detail: {
      step: number;
      driver: string;
      prompt: unknown;
      reasoning: string | null;
      op: { kind: string; action?: string; params?: Record<string, unknown>; summary?: string };
    };
  }

  async function decisionsOf(sessionId: string): Promise<DecisionEvent[]> {
    const response = await fetch(`${base}/api/events`);
    const body = (await response.json()) as { events: (DecisionEvent & { kind: string })[] };
    return body.events.filter(
      (event) => event.kind === 'agent-decision' && event.rel === `chat:${sessionId}`,
    );
  }

  it('llm 回合(mock 端点):每步一条,prompt 为 system/user 全量原文,reasoning 填真值(T11 Phase C)', async () => {
    const stub = await createScriptedLlmStub();
    try {
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
      process.env.LLM_MODEL = 'test-model';

      const { json } = await chat({
        sessionId: 'sess-decision-llm',
        driver: 'llm',
        goal: {
          verb: PUBLISH_TEST_GOAL,
          fields: { title: 't', category: 'tech', tags: '', body: 'b' },
        },
      });
      expect(json.outcome).toBe('done');
      expect(json.driver).toBe('llm');

      const decisions = await decisionsOf('sess-decision-llm');
      expect(decisions.map((event) => event.detail.step)).toEqual([1, 2]);
      for (const event of decisions) {
        expect(event).toMatchObject({
          actor: 'agent',
          channel: 'chat',
          principal: 'user:sess-decision-llm',
        });
        expect(event.detail.driver).toBe('llm');
      }
      // reasoning 真值(T11 Phase C):driver 经 raw 部件解析 delta.reasoning_content,
      // 由审计包装器的 sink 捕获落库——两步各携该步自述。
      expect(decisions[0]!.detail.reasoning).toBe('先补标题,再推进向导');
      expect(decisions[1]!.detail.reasoning).toBe('字段已齐,收尾收工');
      expect(decisions[0]!.detail.op).toEqual({
        kind: 'exec',
        action: 'next',
        params: { title: 'LLM 决策的标题' },
        authorization: PUBLISH_TEST_AUTHORIZATION,
      });
      expect(decisions[1]!.detail.op).toEqual({ kind: 'done', summary: 'LLM 完成' });
      // prompt 全量(架构决定 3:训练提取免回放重建)——system 为协议核心原文,
      // user 内嵌目标 JSON;端点不返回 reasoning 时如实 null(验收 4)。
      const prompt = decisions[0]!.detail.prompt as { system: string; user: string };
      expect(prompt.system).toContain('UI4A 合同 agent');
      expect(prompt.user).toContain(PUBLISH_TEST_GOAL);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('agent-decision 落库失败不阻断响应(同 chat-turn 口径)', async () => {
    const stub = await createScriptedLlmStub();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
    // 注入 PG 触发器让 agent-decision 的 INSERT 抛错(其它 kind 不受影响)——
    // 审计写失败只 console.error,回合照常完成且 chat-turn 仍落库。
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_reject_agent_decision() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test 注入:agent-decision 写入故障'; END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS test_reject_agent_decision ON events;
      CREATE TRIGGER test_reject_agent_decision
        BEFORE INSERT ON events FOR EACH ROW
        WHEN (NEW.kind = 'agent-decision')
        EXECUTE FUNCTION test_reject_agent_decision();
    `);
    try {
      const { status, json } = await chat({
        sessionId: 'sess-decision-fail',
        driver: 'llm',
        goal: {
          verb: PUBLISH_TEST_GOAL,
          fields: { title: '写失败', category: 'essay', tags: '', body: '正文' },
        },
      });
      expect(status).toBe(200);
      expect(json.outcome).toBe('done');
      expect((json.steps ?? []).length).toBeGreaterThan(0);

      // 审计事件缺失(写失败),但 chat-turn 回合投影照常落库——响应才是合同。
      expect(await decisionsOf('sess-decision-fail')).toHaveLength(0);
      const response = await fetch(`${base}/api/events`);
      const body = (await response.json()) as { events: { kind: string; rel: string }[] };
      expect(
        body.events.some(
          (event) => event.kind === 'chat-turn' && event.rel === 'chat:sess-decision-fail',
        ),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      await pool.query(`
        DROP TRIGGER IF EXISTS test_reject_agent_decision ON events;
        DROP FUNCTION IF EXISTS test_reject_agent_decision;
      `);
    }
  });
});

describe('T11 Phase C Task 2:thinking 帧(SSE 推理自述管道)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  beforeEach(() => {
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

  it('llm 回合(mock 端点产 reasoning):thinking 帧携整段自述,先于同号 step 帧', async () => {
    const stub = await createScriptedLlmStub();
    try {
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
      process.env.LLM_MODEL = 'test-model';

      const { json, frames } = await chat({
        sessionId: 'sess-thinking-llm',
        driver: 'llm',
        goal: {
          verb: PUBLISH_TEST_GOAL,
          fields: { title: 't', category: 'tech', tags: '', body: 'b' },
        },
      });
      expect(json.outcome).toBe('done');
      expect(json.driver).toBe('llm');

      // 帧型序列(D22:reasoning 末尾齐发 → 整段一次性帧,逐步决策前推送即
      // 「先于同号 step 帧」):每步 thinking → step,final 收尾。
      expect(frames.filter((frame) => frame.type !== 'session').map((frame) => frame.type)).toEqual(
        ['thinking', 'focus', 'step', 'thinking', 'step', 'final'],
      );
      const thinking = frames.filter((frame) => frame.type === 'thinking');
      expect(thinking.every((frame) => frame.turnId === 'route-test-turn')).toBe(true);
      // 整段聚合:与脚本桩的 reasoning_content 逐字等值,步号从 1 递增。
      expect(thinking.map((frame) => [frame.step, frame.text])).toEqual([
        [1, '先补标题,再推进向导'],
        [2, '字段已齐,收尾收工'],
      ]);
      // step 号与对应 step 帧一致(便于客户端归步):第 N 条 thinking 紧贴
      // 第 N 条 step 之前。
      const stepFrames = frames.filter((frame) => frame.type === 'step');
      expect(stepFrames.every((frame) => frame.turnId === 'route-test-turn')).toBe(true);
      const final = frames.find((frame) => frame.type === 'final');
      expect(final?.turnId).toBe('route-test-turn');
      expect(final?.payload?.turnId).toBe('route-test-turn');
      thinking.forEach((frame, index) => {
        expect(frames.indexOf(frame)).toBeLessThan(frames.indexOf(stepFrames[index]!));
      });
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });
});

describe('B4(路由级):坏 key → 401 原文进对话,route 不 5xx', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;
  let stub: Server & { port(): number };

  beforeEach(async () => {
    stub = await createUnauthorizedStub();
    process.env.LLM_API_KEY = 'invalid-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
  });

  afterEach(async () => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  it('llm driver 401 → 200 响应携带失败轨迹与 401 原文', async () => {
    const before = await articleCount();
    const { status, json } = await chat({
      goal: { verb: PUBLISH_TEST_GOAL },
      driver: 'llm',
    });

    expect(status).toBe(200); // 委托不崩溃:拒绝/失败也是合同的一部分
    expect(json.outcome).toBe('failed');
    expect(json.driver).toBe('llm');
    const trajectory = JSON.stringify(json);
    expect(trajectory).toContain('401');
    expect(trajectory).toContain('令牌无效或已过期');
    expect(await articleCount()).toBe(before);
    expect(await eventKinds()).not.toContain('action-executed');
  });

  it('同一 session 再发一次:循环存活,行为一致', async () => {
    const first = await chat({ goal: { verb: PUBLISH_TEST_GOAL }, sessionId: 'b4', driver: 'llm' });
    expect(first.status).toBe(200);

    const second = await chat({
      goal: { verb: PUBLISH_TEST_GOAL },
      sessionId: 'b4',
      driver: 'llm',
    });
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
