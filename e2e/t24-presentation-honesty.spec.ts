/**
 * T24 Phase C — 呈现诚实化 e2e 走查(验收口径 + 截图证据)。
 *
 * 走查定位:对 T24 两个功能面做浏览器级真人走查——
 * - canvas(A 阶段):首屏主区域零机制词(词表 lib/mechanism-words 直接 import,
 *   断言口径与组件级 canvas-first-screen.test 一致,升级到真实引擎/真实
 *   /api/presentation 链路);机制信息(surface ID/目录协商/sidecar 元数据/
 *   原始合同 JSON)只在「为什么这样展示」抽屉可达且如实在场;
 * - chat(B 阶段):无 LLM 时 assistant 诚实失败的中性分层形状(真实服务端
 *   路径:final 帧携带结构化 reason → 「失败 · code=」主行 + 「失败数据」
 *   details,无编造表述);思考折叠区与固定 op 活动语言的可视形状。
 *
 * LLM 在场/缺席的走查路径判定(如实说明):
 * - 本机 .env.local 配有 LLM profile,但真实 LLM 回合属门控 eval 域
 *   (eval/llm-thinking.spec.ts:RUN_LLM_E2E 门,默认 skip;其断言的
 *   「思考 · 步骤 N」文案已随 T24 保留)。本 spec 不打真实模型:
 *   a) 诚实失败路径 = 场景 server 显式清空 LLM 三项 env(chat.spec U22
 *      同款开关)→ 真实 /api/chat 的确定性降级;
 *   b) 思考区/活动语言形状 = page.route 合成 SSE(帧形状逐字段对齐
 *      src/chat/sse.ts 协议;与 chat.spec「停止」用例同一拦截手法)——
 *      真实浏览器渲染折叠/展开与 <a> 下钻,只排除模型时延这一不确定源。
 *      进行中指示「思考中 · 第 N 步」是 running 态瞬态,由组件级
 *      floating-chat.test 覆盖;本走查断言静止折叠形态与可展开性。
 *
 * 截图证据口径:每条用例 page.screenshot({fullPage:true}) 经
 * test.info().outputPath 落在 Playwright test-results 目录并以 attach 登记
 * (不 commit;报告引用 test-results 内路径与断言摘要)。
 */
import { expect, test, type Page } from '@playwright/test';

import { MECHANISM_WORDS } from '../apps/web/src/lib/mechanism-words';

import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 场景 server 冷启动(boot 重放 + 首次编译)给足;与 baseline/chat 同口径。
  test.setTimeout(180_000);
});

/** 走查截图:落到 test-results/<spec>-<test>/ 目录并登记为附件。 */
async function shoot(page: Page, name: string): Promise<void> {
  const info = test.info();
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('canvas 首屏:focus 实体语义上屏,主区域零机制词;机制信息只住在抽屉', async ({ page }) => {
  await withFreshServer(async () => {
    // ---- sidecar 在场判定(与 canvas-body 同形的 /api/presentation 探测)-----
    // focus 路径的回执应携带 sidecar.id;若环境链路异常导致缺席,抽屉走查
    // 如实断言空态(不走条件伪装)。
    const probeResponse = await fetch(`${SCENARIO_BASE}/api/presentation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        principal: 'user:local',
        subject: 'post:first-post',
        intent: 'read',
        delivery: 'canvas',
        sourceMessageIds: [],
      }),
    });
    const probe = (await probeResponse.json()) as { sidecar?: { id?: unknown } };
    const sidecarExpected =
      probeResponse.ok && typeof probe.sidecar?.id === 'string' && probe.sidecar.id !== '';

    // ---- 首屏:语义 surface 上屏(成功渲染是机制词断言的前提)----------------
    await page.goto(`${SCENARIO_BASE}/canvas?focus=post%3Afirst-post`);
    const surface = page.locator('[data-surface="presentation-post%3Afirst-post"]');
    await expect(surface).toBeVisible();
    await expect(surface).toHaveAttribute('data-active', 'true');
    await expect(page.getByRole('heading', { name: '第一篇', exact: true })).toBeVisible();
    await expect(page.getByText('这是第一篇完整文章')).toBeVisible();

    // ---- 主区域零机制词(抽屉默认关闭;innerText 不含未渲染的抽屉内容)-------
    const mainText = await page.locator('main').innerText();
    const leaked = MECHANISM_WORDS.filter((word) => mainText.includes(word));
    expect(leaked, `canvas 首屏主区域泄漏机制词:${leaked.join('、')}`).toEqual([]);
    await shoot(page, 't24-canvas-first-screen');

    // ---- 抽屉:机制信息的唯一入口,如实在场 ----------------------------------
    await page.locator('[data-nav="local:canvas-why"]').click();
    const drawer = page.getByTestId('canvas-why-drawer');
    await expect(drawer).toBeVisible();
    // 目录协商结果(真实 catalog.json URI;机制词在抽屉内允许出现)。
    await expect(page.getByTestId('canvas-why-catalog')).toContainText(
      '目录协商:https://ui4a.dev/render/v1/catalog.json',
    );
    // surface ID(URL 编码形态;首屏禁词、抽屉如实列出)。
    await expect(page.getByTestId('canvas-why-surfaces')).toContainText(
      'presentation-post%3Afirst-post',
    );
    // sidecar 个人视图:按在场与否条件断言(操作可达 = 工具条按钮可见可点)。
    if (sidecarExpected) {
      await expect(drawer.getByText(/个人呈现 · v\d+ · (缓存|已固定)/)).toBeVisible();
      await expect(drawer.getByRole('button', { name: '收起视图' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '切换疏密' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '以后都这样看' })).toBeVisible();
      await expect(page.getByTestId('canvas-why-explain')).toBeEnabled();
    } else {
      await expect(drawer.getByText('当前没有 Sidecar 个人呈现。')).toBeVisible();
    }
    // 原始合同 JSON:details 展开,如实可见 focus 实体的 Siren 原文。
    await drawer.getByText('focus 实体 Siren JSON').click();
    await expect(page.getByTestId('canvas-why-raw-json')).toContainText('"rel": "post:first-post"');
    await shoot(page, 't24-canvas-why-drawer');
  });
});

test('chat 无 LLM:assistant 诚实失败——中性分层(失败 · code=)可见,零编造表述', async ({ page }) => {
  await withFreshServer(
    async () => {
      await page.goto(`${SCENARIO_BASE}/`);
      await page.locator('[data-nav="local:chat-open"]').click();
      await page.getByPlaceholder('输入目标…').fill('发布一篇文章');
      await page.getByRole('button', { name: '发送' }).click();

      // 中性结构化主行:结构标签 + 机械数据,无 phrasing 叙句。
      await expect(page.getByText(/^失败 · code=driver_fail/)).toBeVisible({ timeout: 60_000 });
      // LLM 缺席 → 无「助手表述」来源标注(分层不伪造表述)。
      await expect(page.getByText('助手表述')).toHaveCount(0);

      // 结构化本体收纳在「失败数据」details:code + 机械事实原文(可下钻)。
      const failureDetails = page.locator('details').filter({ hasText: '失败数据' });
      await failureDetails.locator('summary').click();
      await expect(failureDetails).toContainText('code=driver_fail');
      await expect(failureDetails).toContainText('LLM 不可用');
      await shoot(page, 't24-chat-honest-failure');
    },
    // 显式空配置压过 .env.local:e2e 进程无 LLM profile(chat.spec U22 同款)。
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});

test('chat 思考区与活动语言:折叠思考可展开,活动条目是事件流下钻链接(合成 SSE 走查)', async ({
  page,
}) => {
  // 帧形状逐字段对齐 src/chat/sse.ts 协议(略 turnId:客户端绑定到当前请求)。
  const frames = [
    { type: 'session', sessionId: 't24-walkthrough' },
    { type: 'thinking', step: 1, text: '先确认目标对应的入口实体,读取文章列表。' },
    {
      type: 'step',
      message: { role: 'assistant', text: 'navigate articles' },
      rel: 'articles',
      activity: { op: 'navigate', title: '文章列表' },
      eventSeq: 7,
    },
    { type: 'thinking', step: 2, text: '按分类组织计数,准备整理回答。' },
    { type: 'step', message: { role: 'assistant', text: 'answer' }, activity: { op: 'answer' } },
    {
      type: 'final',
      payload: {
        sessionId: 't24-walkthrough',
        driver: 'llm',
        requestedDriver: 'auto',
        outcome: 'done',
        summary: '已整理。',
        steps: [],
        successes: [],
      },
    },
  ];
  // 3100 webServer 首页(引擎零依赖):拦截 /api/chat 供确定性 SSE(帧协议同真流)。
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    });
  });

  await page.goto('/');
  await page.locator('[data-nav="local:chat-open"]').click();
  await page.getByPlaceholder('输入目标…').fill('按分类展示文章');
  await page.getByRole('button', { name: '发送' }).click();

  // 思考折叠区:每 (turnId,step) 一条,默认收起,展开读全文。
  const firstThinking = page.getByRole('button', { name: '思考 · 步骤 1' });
  await expect(firstThinking).toBeVisible();
  await expect(firstThinking).toHaveAttribute('aria-expanded', 'false');
  await firstThinking.click();
  await expect(firstThinking).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('先确认目标对应的入口实体,读取文章列表。')).toBeVisible();
  await expect(page.getByRole('button', { name: '思考 · 步骤 2' })).toBeVisible();

  // 活动语言:固定 op 词表(「正在读取 …」「正在整理回答」);活动条目是
  // 原生 <a>,指向本步事件的 /api/events?afterSeq= 定位窗口(eventSeq=7)。
  const activityLink = page.getByRole('link', { name: '正在读取 文章列表' });
  await expect(activityLink).toBeVisible();
  await expect(activityLink).toHaveAttribute('href', '/api/events?afterSeq=6');
  await expect(page.getByText('正在整理回答')).toBeVisible();
  await shoot(page, 't24-chat-thinking-activity');
});
