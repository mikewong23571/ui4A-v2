/**
 * T2 Phase E / Task E3 — chat 合同 E2E:B4(坏 key)、I1(无 key)、flow 导航补全。
 *
 * - B4:GLM_API_KEY=invalid + 显式 driver 'llm' + LLM_BASE_URL 指向本地 401 桩
 *   (确定性,零外网依赖;真实端点 401 形状同构)→ chat 响应包含 401 与错误原文,
 *   route 不 5xx;同一 session 再发一次行为一致(循环存活,委托不崩溃);
 * - I1:GLM_API_KEY=''(显式空,压过 .env.local)→ auto 回退 rule →
 *   B1 目标(fields 经 goal 传入)→ 文章计数 2→3,轨迹含三步填充 + publish,
 *   driver='rule'(无 LLM 网络调用的 e2e 级证据;单测级 auto 回退断言见
 *   packages/agent/src/llm-driver.test.ts);
 * - flow 导航补全:articles → flow 入口链接 → 向导实例(零 startRel 特权)。
 * - 悬浮窗:首页(3100 webServer)按钮可见、可展开(功能走查 HTTP 级由
 *   B4/I1 覆盖;完整 UI 走查留 Phase F 一并做)。
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

async function chat(
  body: Record<string, unknown>,
): Promise<{ status: number; json: ChatResponseBody; raw: string }> {
  const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return { status: response.status, json: JSON.parse(raw) as ChatResponseBody, raw };
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
    expect(wizard.actions.map((action) => action.name)).toEqual(['next']);
  });
});

test('I1:无 GLM_API_KEY → chat auto 回退 rule,B1 完成(文章 2→3)', async () => {
  await withFreshServer(
    async () => {
      expect(await articleCount()).toBe(2);

      const { status, json } = await chat({
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

      expect(await articleCount()).toBe(3);
    },
    // 显式空 key:进程 env 优先于 .env.local —— e2e 进程零 LLM 凭证
    { GLM_API_KEY: '' },
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
      { GLM_API_KEY: 'invalid-key', LLM_BASE_URL: `${stub.url()}/v4` },
    );
  } finally {
    await stub.close();
  }
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
