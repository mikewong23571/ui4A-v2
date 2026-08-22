/**
 * T2 Phase E / Task E3 — chat 合同 E2E:B4(坏 key)、I1(无 key)、flow 导航补全。
 *
 * - B4:provider-neutral LLM 配置 + 显式 driver 'llm' + LLM_BASE_URL 指向本地 401 桩
 *   (确定性,零外网依赖;真实端点 401 形状同构)→ chat 响应包含 401 与错误原文,
 *   route 不 5xx;同一 session 再发一次行为一致(循环存活,委托不崩溃);
 * - I1:LLM 配置三项显式清空(压过 .env.local)→ auto 回退 rule →
 *   B1 目标(fields 经 goal 传入)→ 文章计数 2→3,轨迹含三步填充 + publish,
 *   driver='rule'(无 LLM 网络调用的 e2e 级证据;单测级 auto 回退断言见
 *   packages/agent/src/llm-driver.test.ts);
 * - flow 导航补全:articles → flow 入口链接 → 向导实例(零 startRel 特权)。
 * - 悬浮窗:首页(3100 webServer)按钮可见、可展开。
 *
 * T9 Phase B:inline 响应改 SSE 流(text/event-stream;step 帧逐步 + final
 * 终帧)——chat() helper 解析帧并把 step 文本聚回 messages,既有断言口径
 * 不变;新增:帧序断言(step 先于 final)与「停止」按钮可点的 UI 走查。
 * T11 Phase C:rule 路径断言零 thinking 帧且不炸(spec 验收 5 前半;thinking
 * 帧为 llm 步推理自述,rule driver 零回调零帧)。
 */
import { createServer } from 'node:http';

import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './server-kit';

interface ChatResponseBody {
  sessionId: string;
  driver: 'rule' | 'llm';
  outcome: 'done' | 'failed' | 'max-steps';
  summary: string | null;
  messages: { role: 'assistant'; text: string }[];
  error?: string;
}

/** SSE 帧(T9 Phase B):step 逐步消息 / final 终帧 / error 兜底;
 * T11 Phase C 增 thinking 帧(llm 步推理自述;rule 路径零帧,仅作类型容错);
 * 本轮增 thinking-delta(推理增量)与 render(渲染 LLM 路径 SSE 化的回执帧)。 */
interface SseFrame {
  type: 'step' | 'final' | 'error' | 'thinking' | 'thinking-delta' | 'render';
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

test('I1:无 LLM 配置 → chat auto 回退 rule,B1 完成(文章 2→3)', async () => {
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
      expect(json.driver, 'auto 在无 key 环境必须解析为 rule').toBe('rule');
      expect(json.outcome, JSON.stringify(json.messages)).toBe('done');

      const trajectory = json.messages.map((message) => message.text).join('\n');
      expect(trajectory.match(/执行 next/g)).toHaveLength(3);
      expect(trajectory).toContain('执行 publish');
      expect(trajectory).toContain('完成');

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
      // T11 Phase C(spec 验收 5 前半):rule driver 无 reasoning → 零 thinking
      // 帧,rule 路径帧序列与现状逐帧一致。
      expect(frames.filter((frame) => frame.type === 'thinking')).toHaveLength(0);

      expect(await articleCount()).toBe(3);
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

        // 顺带:同 server 上 rule 通道不受坏 key 影响(auto 显式空 key 时同样成立)
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
      // 「看看」是展示意图词(hasDisplayIntent 命中)但无集合词 → rule 模板
      // miss;无 key → LLM 路径跳过(I1)→ SSE 流内交回普通 agent 循环。
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
    // 显式空配置:e2e 进程无 LLM profile(rule 确定路径,I1 口径)
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
