/**
 * T2 Phase E / Task E3 — chat 合同 E2E:B4(坏 key)、U22(无 key安全)、flow 导航补全。
 *
 * - B4:provider-neutral LLM 配置 + 显式 driver 'llm' + LLM_BASE_URL 指向本地 401 桩
 *   (确定性,零外网依赖;真实端点 401 形状同构)→ chat 响应包含 401 与错误原文,
 *   route 不 5xx;同一 session 再发一次行为一致(循环存活,委托不崩溃);
 * - U22:LLM 配置三项显式清空(压过 .env.local)→ auto 仍解析为 llm，
 *   Assistant 诚实失败且文章集合与业务事件保持不变；
 * - flow 导航补全:articles → flow 入口链接 → 向导实例(零 startRel 特权)。
 * - 悬浮窗:首页(3100 webServer)按钮可见、可展开。
 *
 * T9 Phase B:inline 响应改 SSE 流(text/event-stream;step 帧逐步 + final
 * 终帧)——chat() helper 解析帧并把 step 文本聚回 messages,既有断言口径
 * 不变;新增:帧序断言(step 先于 final)与「停止」按钮可点的 UI 走查。
 * T11 Phase C:thinking 帧为 LLM 推理自述；配置缺失时自然零帧。
 * T49 D68(会话双轴):sessionId=会话分组键(旧形状键并存/缺省代铸/非法 400),
 * 清单多会话与 history 读回隔离的本地 profile 全路径(U1–U5/U8/U10)。
 */
import { createServer } from 'node:http';

import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

interface ChatResponseBody {
  sessionId: string;
  driver: 'llm';
  outcome: 'done' | 'failed' | 'max-steps';
  summary: string | null;
  messages: { role: 'assistant'; text: string }[];
  error?: string;
}

/** SSE 帧(T9 Phase B):step 逐步消息 / final 终帧 / error 兜底;
 * T11 Phase C 增 thinking 帧(llm 步推理自述;rule 路径零帧,仅作类型容错);
 * 本轮增 thinking-delta(推理增量)与 render(渲染 LLM 路径 SSE 化的回执帧);
 * T49:session 帧(P3 起首帧必达,携带服务端确认的会话分组键)。 */
interface SseFrame {
  type: 'session' | 'step' | 'final' | 'error' | 'thinking' | 'thinking-delta' | 'render';
  sessionId?: string;
  message?: { role: 'assistant'; text: string };
  step?: number;
  text?: string;
  payload?: Omit<ChatResponseBody, 'messages'>;
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

async function chat(
  body: Record<string, unknown>,
): Promise<{ status: number; json: ChatResponseBody; raw: string; frames: SseFrame[] }> {
  const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  // T9 Phase B:inline 为 SSE——step 帧聚回 messages,final payload 展开为
  // json(与旧一次性 JSON 同字段,既有断言口径不变);render/delegated 仍 JSON。
  if (contentType.includes('text/event-stream')) {
    const frames = parseSseFrames(raw);
    const finalFrame = frames.find((frame) => frame.type === 'final');
    const messages = frames.flatMap((frame) =>
      frame.type === 'step' && frame.message !== undefined ? [frame.message] : [],
    );
    const json = {
      ...(finalFrame?.payload ?? {}),
      messages,
      ...(finalFrame === undefined
        ? { error: frames.find((frame) => frame.type === 'error')?.error ?? '(无 final 帧)' }
        : {}),
    } as ChatResponseBody;
    return { status: response.status, json, raw, frames };
  }
  return { status: response.status, json: JSON.parse(raw) as ChatResponseBody, raw, frames: [] };
}

async function articleCount(): Promise<number> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`);
  const body = (await response.json()) as { properties: { count: number } };
  return body.properties.count;
}

/** GET /api/chat/history?sessionId= 的回合投影(T49 读回隔离断言)。 */
async function chatHistory(sessionId: string): Promise<{ turns: { goal: { verb: string } }[] }> {
  const response = await fetch(
    `${SCENARIO_BASE}/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { turns: { goal: { verb: string } }[] };
}

/** 本地 401 桩:任何路径返回 401(B4 的确定性错误源,真实 GLM 401 同构)。 */
interface UnauthorizedStub {
  url(): string;
  close(): Promise<void>;
}

function startUnauthorizedStub(): Promise<UnauthorizedStub> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { code: '1002', message: '令牌无效或已过期' } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: () => `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

// ---- 场景(串行复用 3110)----------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  test.setTimeout(180_000);
});

test('flow 导航补全:articles → flow 入口链接 → 向导实例(零 startRel 特权)', async () => {
  await withFreshServer(async () => {
    const articles = (await (await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`)).json()) as {
      links: { rel: string[]; href: string }[];
    };

    const entry = articles.links.find((link) => link.rel.includes('flow'));
    expect(entry, 'articles 应携带 flow 入口链接').toBeDefined();

    const wizardResponse = await fetch(`${SCENARIO_BASE}${entry!.href}`);
    expect(wizardResponse.status).toBe(200);
    const wizard = (await wizardResponse.json()) as {
      class: string[];
      properties: { rel: string; flow: string; node: string };
      actions: { name: string }[];
    };
    expect(wizard.class).toContain('flow-instance');
    expect(wizard.properties).toMatchObject({
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'basic-info',
    });
    expect(wizard.actions.map((action) => action.name)).toEqual(['next', 'abandon']);
  });
});

test('U22:无 LLM 配置 → chat auto 诚实失败、零业务副作用', async () => {
  await withFreshServer(
    async () => {
      expect(await articleCount()).toBe(2);

      const { status, json, frames } = await chat({
        sessionId: 'i1-e2e',
        goal: {
          verb: '发布一篇文章',
          fields: {
            title: 'chat e2e 的第三篇',
            category: 'tech',
            tags: 'e2e',
            body: '第三篇正文:由 chat 路由(rule 回退)经 HTTP 合同发布。',
          },
        },
      });

      expect(status).toBe(200);
      expect(json.driver, 'auto 在无 key 环境仍必须解析为 llm').toBe('llm');
      expect(json.outcome, JSON.stringify(json.messages)).toBe('failed');
      expect(json.summary).toContain('LLM 不可用');
      expect(json.summary).toContain('配置后可重试');

      // T14:session 首帧先确立可恢复回合；step/focus 过程帧均先于 final。
      expect(frames.length).toBeGreaterThan(1);
      expect(frames[frames.length - 1]!.type).toBe('final');
      expect(frames[0]!.type).toBe('session');
      expect(
        frames
          .slice(0, -1)
          .every(
            (frame) => frame.type === 'session' || frame.type === 'step' || frame.type === 'focus',
          ),
      ).toBe(true);
      // 配置缺失发生在模型调用前，因此没有伪造的 thinking 帧。
      expect(frames.filter((frame) => frame.type === 'thinking')).toHaveLength(0);

      expect(await articleCount()).toBe(2);
    },
    // 显式空配置:进程 env 优先于 .env.local —— e2e 进程无 LLM profile
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});

test('B4:坏 key → 401 原文进对话,route 不 5xx;同 session 再发一次存活', async () => {
  const stub = await startUnauthorizedStub();
  try {
    await withFreshServer(
      async () => {
        const first = await chat({
          sessionId: 'b4-e2e',
          goal: { verb: '发布一篇文章' },
          driver: 'llm',
        });
        expect(first.status, '失败也是合同的一部分:route 不 5xx').toBe(200);
        expect(first.json.outcome).toBe('failed');
        expect(first.json.driver).toBe('llm');
        expect(first.raw).toContain('401');
        expect(first.raw).toContain('令牌无效或已过期');

        // 同一 session 再发一次:循环存活,行为一致(委托不崩溃)
        const second = await chat({
          sessionId: 'b4-e2e',
          goal: { verb: '发布一篇文章' },
          driver: 'llm',
        });
        expect(second.status).toBe(200);
        expect(second.json.outcome).toBe('failed');
        expect(second.raw).toContain('401');

        // 同一 server 上不存在 rule 旁路；失败始终来自当前 LLM profile。
      },
      {
        LLM_API_KEY: 'invalid-key',
        LLM_BASE_URL: `${stub.url()}/v4`,
        LLM_MODEL: 'test-model',
      },
    );
  } finally {
    await stub.close();
  }
});

test('渲染路径 SSE 化兜底:展示意图 rule miss + 无 key → 同流交回 agent 循环(零 render 帧)', async () => {
  await withFreshServer(
    async () => {
      // 「看看」是展示意图但无 key；AI-first 配置闸先诚实失败，不走机械 render。
      const { status, frames, raw } = await chat({
        sessionId: 'render-sse-fallback',
        goal: { verb: '看看站点地图' },
      });

      expect(status).toBe(200);
      // 诚实失败口径:不产 render 回执帧,不留半成品。
      expect(raw).not.toContain('"type":"render"');
      expect(frames.filter((frame) => frame.type === 'render')).toHaveLength(0);
      // 无 LLM → 零思考增量帧。
      expect(frames.filter((frame) => frame.type === 'thinking-delta')).toHaveLength(0);
      // 循环兜底:frame 序列 = step 帧 + final 终帧(与常规 inline 同构)。
      expect(frames[frames.length - 1]!.type).toBe('final');
      expect(frames.some((frame) => frame.type === 'step')).toBe(true);
    },
    // 显式空配置:e2e 进程无 LLM profile(U22 故障安全口径)
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});

test('T49 D68:会话双轴——多会话清单/旧形状并存/缺省代铸/非法拒绝', async () => {
  await withFreshServer(
    async () => {
      // 旧形状键(修复前部署 sessionId=principal 的落库形状):字符集合法,
      // D68 下作为普通会话分组键延续(U8 诚实投影,零迁移零双轨)。
      const preD68 = await chat({ sessionId: 'e2e-pre-d68', goal: { verb: '旧形状会话回合' } });
      expect(preD68.status).toBe(200);
      expect(preD68.json.outcome, '空 LLM profile:回合确定性诚实失败').toBe('failed');
      expect(preD68.frames[0]!.type).toBe('session');
      expect(preD68.frames[0]!.sessionId).toBe('e2e-pre-d68');

      // 现行客户端铸发的 UUID 会话键(U1 第二会话)。
      const uuidKey = '11111111-2222-4333-8444-555555555555';
      const uuidTurn = await chat({ sessionId: uuidKey, goal: { verb: 'UUID 会话回合' } });
      expect(uuidTurn.status).toBe(200);

      // 缺省 sessionId → 服务端代铸 UUID v4 经 session 帧下发(U5 自愈链路起点)。
      const minted = await chat({ goal: { verb: '缺省会话回合' } });
      expect(minted.status).toBe(200);
      expect(minted.frames[0]!.type).toBe('session');
      expect(minted.frames[0]!.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      // 非法 sessionId → 400 结构化拒绝,不 5xx(U5)。
      const bad = await chat({ sessionId: '!bad', goal: { verb: '非法键回合' } });
      expect(bad.status).toBe(400);
      expect(typeof bad.json.error).toBe('string');
      expect(bad.json.error).toContain('sessionId');

      // 清单(本地 demo 全量分组):三会话并存,每行 turns ≥ 1(U1/U8/U10)。
      const sessionsResponse = await fetch(`${SCENARIO_BASE}/api/chat/sessions`);
      expect(sessionsResponse.status).toBe(200);
      const sessionsBody = (await sessionsResponse.json()) as {
        sessions: { sessionId: string; turns: number }[];
      };
      expect(sessionsBody.sessions.length).toBeGreaterThanOrEqual(3);
      const ids = sessionsBody.sessions.map((row) => row.sessionId);
      expect(ids).toContain('e2e-pre-d68');
      expect(ids).toContain(uuidKey);
      expect(ids).toContain(minted.frames[0]!.sessionId!);
      for (const row of sessionsBody.sessions) {
        expect(row.turns, `${row.sessionId} 应至少一回合`).toBeGreaterThanOrEqual(1);
      }

      // history 读回隔离(U3):各会话只见自己的回合,goal 原样、互不串台。
      const preD68History = await chatHistory('e2e-pre-d68');
      expect(preD68History.turns).toHaveLength(1);
      expect(preD68History.turns[0]!.goal.verb).toBe('旧形状会话回合');
      const uuidHistory = await chatHistory(uuidKey);
      expect(uuidHistory.turns).toHaveLength(1);
      expect(uuidHistory.turns[0]!.goal.verb).toBe('UUID 会话回合');

      // 同会话第二回合 → turns=2(刷新续会回归口径的代理锚定,U4)。
      const second = await chat({ sessionId: uuidKey, goal: { verb: 'UUID 会话第二回合' } });
      expect(second.status).toBe(200);
      const afterSecond = await chatHistory(uuidKey);
      expect(afterSecond.turns).toHaveLength(2);
    },
    // 显式空配置:回合确定性 failed,chat 事件仍全量落库(既有 U22 口径)。
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});

// ---- 悬浮窗可见性(3100 webServer,首页无引擎依赖)---------------------------

test('悬浮聊天窗在首页可见且可展开', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: '展开聊天窗' });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByPlaceholder('输入目标…')).toBeVisible();
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
});

test('工作台:「停止」running 时可点,点击中断展示并留痕说明(T9 Phase B / B2)', async ({ page }) => {
  // 拦截 /api/chat 为迟到的 SSE 流:running 窗口的确定性来源(不依赖引擎)。
  await page.route('**/api/chat', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: 'data: {"type":"final","payload":{"sessionId":"e2e-stop","driver":"rule","requestedDriver":"auto","outcome":"done","summary":"晚到","steps":[],"successes":[]}}\n\n',
      });
    } catch {
      // 客户端已中止(停止):fulfill 落空属预期路径。
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: '展开聊天窗' }).click();
  await page.getByPlaceholder('输入目标…').fill('发布一篇文章');
  await page.getByRole('button', { name: '发送' }).click();

  const stop = page.getByRole('button', { name: '停止' });
  await expect(stop).toBeVisible();
  await expect(stop, 'running 时停止必须可点(onCancel 已接线)').toBeEnabled();
  await stop.click();
  await expect(page.getByText('已停止(仅中断展示,服务端轨迹已在事件日志留痕)')).toBeVisible();
  // isRunning 归位:发送按钮回来。
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
});
