/**
 * GET /api/chat/history 路由测试(T9 Phase B / B3)。
 *
 * 历史 = chat-turn 事件的日志投影(服务端零会话态)。测试直接给定
 * 回合事件，再经 GET /api/chat/history?sessionId=… 读回序列。
 *
 * 覆盖:
 * - 已落回合:按 sessionId 过滤,goal/outcome/messages/driver 原样返回,
 *   seq 升序(两回合顺序保持);
 * - T11 Phase B:回合读出携带结构化 steps;
 * - 无该会话回合 → { turns: [] }(空态非错误);
 * - 缺 sessionId → 400;
 * - T56 P3.3 / D78 决定 5(历史时点读):user 原话事件按
 *   principal×sessionId×turnId 精确 join 出该回合当时的 clientView 与
 *   userContextKnown(不回填、不补造),读取按 {rel,principal} 过滤取界,
 *   生产 principal 轴下同 sessionId 异 principal 回合互不串入。
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identityMock = vi.hoisted(() => ({
  profile: 'local' as 'local' | 'production',
  principal: 'user:fixture-default',
}));

vi.mock('../../../../auth/request-identity', () => ({
  // 与 read-routes.production-auth.test.ts 同 impl:非凭据缺失错误 → 非 401。
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  requestIdentityProfile: vi.fn(() => identityMock.profile),
  resolveTrustedRequestIdentity: vi.fn(async () => ({
    authorizationMode: 'credential' as const,
    actor: 'human' as const,
    principal: identityMock.principal,
    scopes: ['ui4a:read'],
    grantedApplications: ['default'],
    channel: 'oidc',
    humanApprovalEligible: true,
  })),
}));

// A5 用例需要 chatHistoryPrincipal 走 production 分支但不启动整台 engine:
// getEngine 换桩,getDb 保持真实(db 项目真实库)。
vi.mock('../../../../engine/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../engine/service')>();
  return {
    ...actual,
    getEngine: vi.fn(async () => ({
      getSnapshot: () => ({ applications: { default: {} } }),
    })),
  };
});

import { appendEvent, ensureEventsTable } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { foldConversation } from '../../../../chat/conversation';
import { appendConversationMessage, loadAgentConversation } from '../../../../chat/session-events';
import { GET as getHistory } from './route';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

// ---- 进程内回环:HTTP → 真实 route handler(与 chat/route.test.ts 同方案)-----

let server: Server;
let base = '';

async function handler(pathname: string, request: Request): Promise<Response> {
  if (pathname === '/api/chat/history') return getHistory(request);
  return Response.json({ error: 'not found' }, { status: 404 });
}

interface HistoryTurn {
  seq: number;
  ts: string;
  sessionId: string;
  turnId: string;
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
  status: 'running' | 'final';
  citations?: { rel: string; pointer: string }[];
  clientView?: {
    schemaVersion: number;
    presence: {
      clientInstanceId: string;
      site: string;
      scope: string | null;
      thread: string | null;
      focus: string | { selection: string[] } | null;
    };
  };
  userContextKnown?: boolean;
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

/** 投影路由测试直接给定已完成的 AI-first 回合事件，不模拟模型决策。 */
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
      summary: '已发布',
      messages: [
        { role: 'assistant', text: '执行 publish(flow:article-drafting)' },
        { role: 'assistant', text: '完成: 已发布' },
      ],
      steps: [
        {
          step: 1,
          rel: 'flow:article-drafting',
          op: { kind: 'exec', action: 'publish', params: { title: verb } },
          outcome: 'executed',
        },
        {
          step: 2,
          rel: 'flow:article-drafting',
          op: { kind: 'done', summary: '已发布' },
          outcome: 'done',
        },
      ],
      driver: 'llm',
    },
  });
}

beforeEach(async () => {
  identityMock.profile = 'local';
  identityMock.principal = 'user:fixture-default';
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

// ---- 场景 -------------------------------------------------------------------

describe('聊天历史投影(T9 Phase B)', () => {
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
    expect(turns[0]!.driver).toBe('llm');
    expect(turns[0]!.messages.map((message) => message.text).join('\n')).toContain('执行 publish');
    expect(turns.every((turn) => turn.sessionId === 'sess-h1')).toBe(true);
  });

  it('无该会话回合 → 空 turns(空态非错误)', async () => {
    const { status, json } = await history('?sessionId=sess-ghost');
    expect(status).toBe(200);
    expect(json.turns).toEqual([]);
  });

  it('joins canonical assistant citations to the exact final turnId without text matching', async () => {
    await runChatTurn('sess-citations', '相同回答文本');
    await runChatTurn('sess-citations', '相同回答文本');
    const rows = await pool.query<{ seq: string; detail: { turnId: string } }>(
      `SELECT seq::text, detail FROM events
       WHERE kind='chat-turn' AND rel='chat:sess-citations' ORDER BY seq ASC`,
    );
    const [first, second] = rows.rows;
    await appendEvent(pool, {
      kind: 'chat-message-appended',
      actor: 'agent',
      principal: 'user:sess-citations',
      channel: 'chat',
      rel: 'chat:sess-citations',
      detail: {
        sessionId: 'sess-citations',
        turnId: first!.detail.turnId,
        messageId: `${first!.detail.turnId}:assistant`,
        role: 'assistant',
        content: '相同回答文本',
        provenance: { kind: 'assistant-output' },
        citations: [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
      },
    });
    await appendEvent(pool, {
      kind: 'chat-message-appended',
      actor: 'agent',
      principal: 'user:sess-citations',
      channel: 'chat',
      rel: 'chat:sess-citations',
      detail: {
        sessionId: 'sess-citations',
        turnId: second!.detail.turnId,
        messageId: `${second!.detail.turnId}:assistant`,
        role: 'assistant',
        content: '相同回答文本',
        provenance: { kind: 'assistant-output' },
        citations: [{ rel: 'articles', pointer: '/properties/count' }],
      },
    });

    const { json } = await history('?sessionId=sess-citations');
    expect(json.turns?.map((turn) => turn.citations)).toEqual([
      [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
      [{ rel: 'articles', pointer: '/properties/count' }],
    ]);
  });

  it('started + progress 在 final 前即可恢复为 running 回合，刷新不丢在途消息', async () => {
    await appendEvent(pool, {
      kind: 'chat-turn-started',
      actor: 'agent',
      principal: 'user:sess-running',
      channel: 'chat',
      rel: 'chat:sess-running',
      detail: {
        sessionId: 'sess-running',
        turnId: 'turn-running',
        goal: { verb: '删除所有文章' },
        driver: 'llm',
        mode: 'inline',
      },
    });
    await appendEvent(pool, {
      kind: 'chat-turn-progress',
      actor: 'agent',
      principal: 'user:sess-running',
      channel: 'chat',
      rel: 'chat:sess-running',
      detail: {
        sessionId: 'sess-running',
        turnId: 'turn-running',
        message: { role: 'assistant', text: '导航到 articles' },
      },
    });

    const { json } = await history('?sessionId=sess-running');
    expect(json.turns).toMatchObject([
      {
        turnId: 'turn-running',
        status: 'running',
        goal: { verb: '删除所有文章' },
        messages: [{ role: 'assistant', text: '导航到 articles' }],
      },
    ]);
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
    expect(steps[0]!.op.kind, '首步是协议操作(navigate 或直接 exec)').toMatch(/^(navigate|exec)$/);
    expect(steps[steps.length - 1]!.op.kind).toBe('done');
    expect(
      steps.every((step) => typeof step.step === 'number' && typeof step.rel === 'string'),
    ).toBe(true);
  });

  it('缺 sessionId → 400', async () => {
    expect((await history('')).status).toBe(400);
  });
});

// ---- T56 P3.3 / D78 决定 5:历史时点读 ---------------------------------------

const RUN = 't56p33';

/** 合法 clientView(schemaVersion 2;presence 键与写侧 turn-context.ts 同构)。 */
function clientViewFor(thread: string, focus: string, clientInstanceId = `${RUN}-client`): unknown {
  return {
    schemaVersion: 2,
    presence: { clientInstanceId, site: 'workstation', scope: 'publishing', thread, focus },
  };
}

async function appendUserMessage(args: {
  sessionId: string;
  principal: string;
  turnId: string;
  content: string;
  clientView?: unknown;
}): Promise<void> {
  await appendEvent(pool, {
    kind: 'chat-message-appended',
    actor: 'human',
    principal: args.principal,
    channel: 'chat',
    rel: `chat:${args.sessionId}`,
    detail: {
      sessionId: args.sessionId,
      turnId: args.turnId,
      messageId: args.turnId,
      role: 'user',
      content: args.content,
      provenance: { kind: 'user-input' },
      ...(args.clientView === undefined ? {} : { clientView: args.clientView }),
    },
  });
}

async function appendFinalTurn(args: {
  sessionId: string;
  principal: string;
  turnId: string;
  verb: string;
  answer: string;
}): Promise<void> {
  await appendEvent(pool, {
    kind: 'chat-turn',
    actor: 'agent',
    principal: args.principal,
    channel: 'chat',
    rel: `chat:${args.sessionId}`,
    detail: {
      sessionId: args.sessionId,
      turnId: args.turnId,
      goal: { verb: args.verb },
      outcome: 'done',
      summary: args.answer,
      messages: [{ role: 'assistant', text: args.answer }],
      steps: [],
      driver: 'llm',
    },
  });
}

describe('聊天历史时点读(T56 P3.3 / D78 决定 5)', () => {
  it('A1 精确 join:同 session 两回合各自携带当时的 clientView,不串线不都标成最新线', async () => {
    const sessionId = `${RUN}-join-sess`;
    const principal = `user:${sessionId}`;
    const viewA = clientViewFor(`thread:${RUN}-thread-a`, `idea:${RUN}-idea-a`);
    const viewB = clientViewFor(`thread:${RUN}-thread-b`, `idea:${RUN}-idea-b`);
    // 写入顺序即真实顺序:A 回合在前,B 回合在后(B 是「最新」观察)。
    await appendUserMessage({
      sessionId,
      principal,
      turnId: `${RUN}-turn-a`,
      content: `在 A 线问 ${RUN}-idea-a`,
      clientView: viewA,
    });
    await appendFinalTurn({
      sessionId,
      principal,
      turnId: `${RUN}-turn-a`,
      verb: `在 A 线问 ${RUN}-idea-a`,
      answer: 'A 的回答',
    });
    await appendUserMessage({
      sessionId,
      principal,
      turnId: `${RUN}-turn-b`,
      content: `在 B 线问 ${RUN}-idea-b`,
      clientView: viewB,
    });
    await appendFinalTurn({
      sessionId,
      principal,
      turnId: `${RUN}-turn-b`,
      verb: `在 B 线问 ${RUN}-idea-b`,
      answer: 'B 的回答',
    });

    const { status, json } = await history(`?sessionId=${sessionId}`);
    expect(status).toBe(200);
    const turns = json.turns ?? [];
    expect(turns).toHaveLength(2);
    // 各回合携带「当时」的 clientView:A 回合不因 B 更晚而被改标。
    expect(turns[0]!.turnId).toBe(`${RUN}-turn-a`);
    expect(turns[0]!.userContextKnown).toBe(true);
    expect(turns[0]!.clientView?.presence.thread).toBe(`thread:${RUN}-thread-a`);
    expect(turns[0]!.clientView?.presence.focus).toBe(`idea:${RUN}-idea-a`);
    expect(turns[1]!.userContextKnown).toBe(true);
    expect(turns[1]!.clientView?.presence.thread).toBe(`thread:${RUN}-thread-b`);
    expect(turns[1]!.clientView?.presence.focus).toBe(`idea:${RUN}-idea-b`);
  });

  it('A2 缺失上下文显式建模:旧版无 clientView 与 user 事件整体缺失可区分,且都不补造', async () => {
    const sessionId = `${RUN}-gap-sess`;
    const principal = `user:${sessionId}`;
    // 回合一(旧 shape):user 事件在场但不携带 clientView。
    await appendUserMessage({
      sessionId,
      principal,
      turnId: `${RUN}-turn-old`,
      content: '旧版提问',
    });
    await appendFinalTurn({
      sessionId,
      principal,
      turnId: `${RUN}-turn-old`,
      verb: '旧版提问',
      answer: '旧版回答',
    });
    // 回合二:user 原话事件整体缺失(只有 chat-turn)。
    await appendFinalTurn({
      sessionId,
      principal,
      turnId: `${RUN}-turn-orphan`,
      verb: '缺原话的提问',
      answer: '缺原话的回答',
    });

    const { json } = await history(`?sessionId=${sessionId}`);
    const turns = json.turns ?? [];
    expect(turns).toHaveLength(2);
    // 事件在场但无观察:known=true、clientView 缺席(审计口径可分)。
    expect(turns[0]!.userContextKnown).toBe(true);
    expect('clientView' in turns[0]!).toBe(false);
    // 事件整体缺失:known=false(「当时上下文未知」的第二种来路)。
    expect(turns[1]!.turnId).toBe(`${RUN}-turn-orphan`);
    expect(turns[1]!.userContextKnown).toBe(false);
    expect('clientView' in turns[1]!).toBe(false);
  });

  it('A3 live/history 双路径一致:发送时装载的当时上下文与刷新后 history 恢复一致', async () => {
    const sessionId = `${RUN}-live-sess`;
    const principal = `user:${sessionId}`;
    const view = clientViewFor(`thread:${RUN}-live`, `idea:${RUN}-live-x`);
    // 发送侧走真实写路径(appendConversationMessage,与 post/turn-context.ts 同一函数)。
    await appendConversationMessage({
      sessionId,
      principal,
      turnId: `${RUN}-turn-live`,
      messageId: `${RUN}-turn-live`,
      role: 'user',
      content: `看一下 ${RUN}-live-x`,
      clientView: view as never,
    });
    await appendFinalTurn({
      sessionId,
      principal,
      turnId: `${RUN}-turn-live`,
      verb: `看一下 ${RUN}-live-x`,
      answer: 'live 回答',
    });

    // live 侧:与发送时 agent 会话装载同一读路径。
    const live = await loadAgentConversation(sessionId, principal);
    expect(live.clientView?.presence.thread).toBe(`thread:${RUN}-live`);
    expect(live.clientView?.sourceMessageId).toBe(`${RUN}-turn-live`);

    // history 侧:同批事件经 GET,恢复出同一观察(无 fact 包装,raw report)。
    const { json } = await history(`?sessionId=${sessionId}`);
    const turn = (json.turns ?? [])[0]!;
    expect(turn.userContextKnown).toBe(true);
    expect(turn.clientView).toEqual(view);

    // foldConversation(live 投影核心)与 history 输出按 presence 逐字段一致。
    const events = await pool.query(
      `SELECT seq, ts, kind, rel, principal, detail FROM events
       WHERE rel = $1 ORDER BY seq ASC`,
      [`chat:${sessionId}`],
    );
    const folded = foldConversation(events.rows as never, sessionId, principal);
    expect(folded.clientView?.presence).toEqual(turn.clientView?.presence);
  });

  it('A4 页边界:超过默认页上限(101)的事件量下目标回合完整重建,读按 {rel} 收窄', async () => {
    const sessionId = `${RUN}-boundary-sess`;
    const principal = `user:${sessionId}`;
    // 同 principal 的干扰会话:60 个回合事件(证明读取按 rel 收窄,而非全量扫描巧合)。
    for (let index = 0; index < 60; index += 1) {
      await appendFinalTurn({
        sessionId: `${RUN}-filler-sess`,
        principal,
        turnId: `${RUN}-filler-${index}`,
        verb: `干扰回合 ${index}`,
        answer: `干扰回答 ${index}`,
      });
    }
    // 目标会话:1 user + 1 started + 100 progress + 1 final + 1 assistant 引用 = 104 > 101。
    await appendUserMessage({
      sessionId,
      principal,
      turnId: `${RUN}-turn-big`,
      content: `大回合:${RUN}-big-x`,
      clientView: clientViewFor(`thread:${RUN}-big`, `idea:${RUN}-big-x`),
    });
    await appendEvent(pool, {
      kind: 'chat-turn-started',
      actor: 'agent',
      principal,
      channel: 'chat',
      rel: `chat:${sessionId}`,
      detail: {
        sessionId,
        turnId: `${RUN}-turn-big`,
        goal: { verb: `大回合:${RUN}-big-x` },
        driver: 'llm',
        mode: 'inline',
      },
    });
    for (let step = 1; step <= 100; step += 1) {
      await appendEvent(pool, {
        kind: 'chat-turn-progress',
        actor: 'agent',
        principal,
        channel: 'chat',
        rel: `chat:${sessionId}`,
        detail: {
          sessionId,
          turnId: `${RUN}-turn-big`,
          message: { role: 'assistant', text: `第 ${step} 步进行中` },
        },
      });
    }
    await appendFinalTurn({
      sessionId,
      principal,
      turnId: `${RUN}-turn-big`,
      verb: `大回合:${RUN}-big-x`,
      answer: '大回合的完整回答',
    });
    await appendEvent(pool, {
      kind: 'chat-message-appended',
      actor: 'agent',
      principal,
      channel: 'chat',
      rel: `chat:${sessionId}`,
      detail: {
        sessionId,
        turnId: `${RUN}-turn-big`,
        messageId: `${RUN}-turn-big:assistant`,
        role: 'assistant',
        content: '大回合的完整回答',
        provenance: { kind: 'assistant-output' },
        citations: [{ rel: `idea:${RUN}-big-x`, pointer: '/properties/status' }],
      },
    });

    const { status, json } = await history(`?sessionId=${sessionId}`);
    expect(status).toBe(200);
    const turns = json.turns ?? [];
    // 干扰会话不串入(rel 收窄;不被静默截没)。
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.turnId).toBe(`${RUN}-turn-big`);
    expect(turn.status).toBe('final');
    expect(turn.goal.verb).toBe(`大回合:${RUN}-big-x`);
    expect(turn.messages.map((message) => message.text)).toContain('大回合的完整回答');
    expect(turn.citations).toEqual([{ rel: `idea:${RUN}-big-x`, pointer: '/properties/status' }]);
    expect(turn.userContextKnown).toBe(true);
    expect(turn.clientView?.presence.focus).toBe(`idea:${RUN}-big-x`);
  });

  it('A5 跨 principal:生产 principal 轴下同 sessionId 异 principal 的回合互不串入', async () => {
    const sessionId = `${RUN}-x-sess`;
    // 双 principal fixture:同 sessionId、各自回合与各自 clientView。
    await appendUserMessage({
      sessionId,
      principal: 'user:p1',
      turnId: `${RUN}-turn-p1`,
      content: 'p1 的提问',
      clientView: clientViewFor(`thread:${RUN}-p1`, `idea:${RUN}-p1-x`, `${RUN}-client-p1`),
    });
    await appendFinalTurn({
      sessionId,
      principal: 'user:p1',
      turnId: `${RUN}-turn-p1`,
      verb: 'p1 的提问',
      answer: 'p1 的回答',
    });
    await appendUserMessage({
      sessionId,
      principal: 'user:p2',
      turnId: `${RUN}-turn-p2`,
      content: 'p2 的提问',
      clientView: clientViewFor(`thread:${RUN}-p2`, `idea:${RUN}-p2-x`, `${RUN}-client-p2`),
    });
    await appendFinalTurn({
      sessionId,
      principal: 'user:p2',
      turnId: `${RUN}-turn-p2`,
      verb: 'p2 的提问',
      answer: 'p2 的回答',
    });

    // 生产 principal 轴:chatHistoryPrincipal 按凭证(此处按 mock 的凭证解析)过滤。
    identityMock.profile = 'production';
    identityMock.principal = 'user:p1';
    const first = await history(`?sessionId=${sessionId}`);
    expect(first.status).toBe(200);
    expect(first.json.turns?.map((turn) => turn.turnId)).toEqual([`${RUN}-turn-p1`]);
    expect(first.json.turns?.[0]!.clientView?.presence.thread).toBe(`thread:${RUN}-p1`);

    identityMock.principal = 'user:p2';
    const second = await history(`?sessionId=${sessionId}`);
    expect(second.json.turns?.map((turn) => turn.turnId)).toEqual([`${RUN}-turn-p2`]);
    expect(second.json.turns?.[0]!.clientView?.presence.thread).toBe(`thread:${RUN}-p2`);
  });
});
