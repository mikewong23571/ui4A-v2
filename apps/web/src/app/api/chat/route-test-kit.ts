import { createServer, type Server } from 'node:http';

import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { GET as getSitemapRoute } from '../../.well-known/ui4a.json/route';
import { GET as getEntityRoute } from '../entity/route';
import { POST as postExecRoute } from '../exec/route';
import { GET as getEventsRoute } from '../events/route';
import { POST as postChat } from './route';

export const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

// ---- 进程内回环:HTTP → 真实 route handler -----------------------------------

let server: Server;
let base = '';
let sitemapRequests = 0;
export const PUBLISH_TEST_GOAL = '对 article-drafting:main 执行 next 并 publish，发布一篇文章';
export const PUBLISH_TEST_AUTHORIZATION = {
  sourceMessageId: 'route-test-turn',
  quote: PUBLISH_TEST_GOAL,
} as const;

export async function handler(pathname: string, request: Request): Promise<Response> {
  if (pathname === '/api/entity') return getEntityRoute(request);
  if (pathname === '/api/exec') return postExecRoute(request);
  if (pathname === '/api/events') return getEventsRoute(request);
  // sitemap 路由无查询参数(签名零参)
  if (pathname === '/.well-known/ui4a.json') {
    sitemapRequests += 1;
    return getSitemapRoute();
  }
  if (pathname === '/api/chat') return postChat(request);
  return Response.json({ error: 'not found' }, { status: 404 });
}

/** 401 LLM 桩:任何路径返回 401(B4 的确定性错误源)。 */
export function createUnauthorizedStub(): Promise<Server & { port(): number }> {
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
export function createScriptedLlmStub(): Promise<Server & { port(): number }> {
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
export function createPublishingLlmStub(): Promise<Server & { port(): number }> {
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

export function createOperationsLlmStub(
  operations: { name: string; args: Record<string, unknown> }[],
): Promise<Server & { port(): number }> {
  return new Promise((resolve) => {
    let calls = 0;
    const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-t21',
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
                id: `call_t21_${calls}`,
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

export interface ChatResponseBody {
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
export interface SseFrame {
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
export function parseSseFrames(raw: string): SseFrame[] {
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
export async function chat(body: Record<string, unknown>): Promise<{
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

export async function articleCount(): Promise<number> {
  const response = await fetch(`${base}/api/entity?rel=articles`);
  return ((await response.json()) as { properties: { count: number } }).properties.count;
}

export async function eventKinds(): Promise<string[]> {
  const response = await fetch(`${base}/api/events`);
  const body = (await response.json()) as { events: { kind: string }[] };
  return body.events.map((event) => event.kind);
}

export async function startChatRouteFixtures(): Promise<void> {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
  sitemapRequests = 0;
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
}

export async function stopChatRouteFixtures(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 当前回环 server 的 origin(startChatRouteFixtures 之后有效)。 */
export function chatRouteBase(): string {
  return base;
}

export function sitemapRequestCount(): number {
  return sitemapRequests;
}
