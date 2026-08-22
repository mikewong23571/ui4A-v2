/**
 * T7 Phase C / Task 2 — S5 渲染场景 E2E(GOAL S5 / T7 spec 验收 2/3/6)。
 *
 * 断言(GOAL 原文:「聊天说"按分类展示文章" → A2UI surface 渲染图表;
 * 渲染 spec 中不含任何字面数值,全部为实体引用」):
 * a) agent 路径(chat API,rule driver)发"按分类展示文章" → 响应携带
 *    render spec(chart 词条);spec 递归零字面(复用零字面校验器断言,
 *    全实体引用:collection + dimension 字段引用);
 * b) 画布(Playwright 打开 /canvas)出现 chart surface,渲染数值与
 *    /api/entity?rel=articles 快照逐项一致(按分类计数,aria-label 断言,
 *    期望值从快照动态计算——以种子+场景数据为准);
 * c) 凝固:第二次同 concern → 同 spec,事件仅一条 render-spec-frozen;
 * d) I2 e2e 级(可溯源):图表每个数值都能在实体快照找到出处
 *    (计数总和 = 集合成员数;每个 key 的 count = 快照同维成员数)。
 */
import { expect, test } from '@playwright/test';

import { validateSpec } from '../apps/web/src/render/validator';

import { SCENARIO_BASE, withFreshServer } from './server-kit';

interface ChatRenderResponse {
  sessionId: string;
  driver: string;
  outcome: string;
  messages: { role: string; text: string }[];
  render?: {
    concern: string;
    spec: { concern: string; component: string; bind: unknown };
    frozenNow: boolean;
    canvasUrl: string;
  };
}

async function chatDisplayArticles(): Promise<{ status: number; json: ChatRenderResponse }> {
  const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 's5-e2e',
      driver: 'rule',
      goal: { verb: '按分类展示文章' },
    }),
  });
  return { status: response.status, json: (await response.json()) as ChatRenderResponse };
}

/** /api/entity?rel=articles 快照 → 按分类计数(成员 fields.category 分组)。 */
async function articlesByCategory(): Promise<{ counts: Map<string, number>; members: number }> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`);
  const body = (await response.json()) as {
    properties: { count: number };
    entities: { properties: { rel: string; fields: { category?: unknown } } }[];
  };
  const counts = new Map<string, number>();
  for (const member of body.entities) {
    const category = member.properties.fields?.category;
    if (typeof category !== 'string')
      throw new Error(`成员 ${member.properties.rel} 缺 category 字段(快照形状意外)`);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return { counts, members: body.entities.length };
}

async function frozenEventCount(): Promise<number> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  const body = (await response.json()) as { events: { kind: string }[] };
  return (body.events ?? []).filter((event) => event.kind === 'render-spec-frozen').length;
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  test.setTimeout(180_000);
});

test('S5:聊天"按分类展示文章" → 零字面 spec → 画布 chart 与快照逐项一致 → 凝固', async ({
  page,
}) => {
  await withFreshServer(
    async () => {
      // ---- a) agent 路径(chat API,rule driver)→ render spec 生成 ----------
      const first = await chatDisplayArticles();
      expect(first.status).toBe(200);
      expect(first.json.outcome, JSON.stringify(first.json.messages)).toBe('done');
      expect(first.json.driver).toBe('rule');
      expect(first.json.render).toBeDefined();

      const spec = first.json.render!.spec;
      expect(spec).toEqual({
        concern: 'articles-by-category',
        component: 'chart',
        bind: { series: { collection: 'articles', dimension: 'articles.fields.category' } },
      });
      // S5 铁律断言:spec 递归零字面(零字面校验器;模型发不出一个数字)。
      expect(validateSpec(spec)).toEqual({ valid: true });
      expect(first.json.render!.frozenNow).toBe(true);
      expect(first.json.render!.canvasUrl).toBe('/canvas?concern=articles-by-category');

      // 首冻留痕:事件日志恰一条 render-spec-frozen。
      expect(await frozenEventCount()).toBe(1);

      // ---- b) 画布 chart surface:渲染数值与实体快照逐项一致 ---------------
      const snapshot = await articlesByCategory();
      expect(snapshot.members).toBeGreaterThanOrEqual(2); // 种子 2 篇起步
      const expectedLabel = `维度计数:${[...snapshot.counts.entries()].map(([key, count]) => `${key}=${count}`).join(', ')}`;
      // 种子场景的具体形状(tech/essay 各一篇)——快照动态计算为主断言,
      // 此处锚定种子数据,防快照解析逻辑自身出错。
      expect(expectedLabel).toBe('维度计数:tech=1, essay=1');

      await page.goto(`${SCENARIO_BASE}/canvas?concern=articles-by-category`);
      const surface = page.locator('[data-surface="articles-by-category"]');
      await expect(surface).toBeVisible();
      // ?concern= 激活:排最前 + data-active(chat 回执的画布入口形态)。
      await expect(surface).toHaveAttribute('data-active', 'true');
      await expect(page.locator('[data-surface]').first()).toHaveAttribute(
        'data-concern',
        'articles-by-category',
      );

      const chart = surface.locator('[data-word="chart"]');
      await expect(chart).toBeVisible();
      // I2 e2e 级:图表数值与快照逐项一致(aria-label 为断言锚点)。
      await expect(chart).toHaveAttribute('aria-label', expectedLabel);
      // 图表主体真实渲染(SVG 柱状,非空占位)。
      await expect(chart.locator('svg')).toBeVisible();

      // ---- d) 可溯源:每个数值都在实体快照有出处 ---------------------------
      const rendered = await chart.getAttribute('aria-label');
      const entries = (rendered ?? '')
        .replace(/^维度计数:/, '')
        .split(', ')
        .map((entry) => {
          const [key, count] = entry.split('=');
          return { key: key ?? '', count: Number(count) };
        });
      expect(entries.length).toBe(snapshot.counts.size);
      let total = 0;
      for (const entry of entries) {
        const origin = snapshot.counts.get(entry.key);
        expect(origin, `维度 ${entry.key} 必须在实体快照有出处`).toBeDefined();
        expect(entry.count).toBe(origin); // 逐项一致(不发明、不丢失)
        total += entry.count;
      }
      expect(total).toBe(snapshot.members); // 计数总和 = 集合成员数(零遗漏)

      // ---- c) 凝固:同 concern 二次请求 → 同 spec,仅一条 frozen 事件 -------
      const second = await chatDisplayArticles();
      expect(second.status).toBe(200);
      expect(second.json.render!.spec).toEqual(spec);
      expect(second.json.render!.frozenNow).toBe(false);
      expect(await frozenEventCount()).toBe(1);

      // 凝固稳定:重载画布,同一布局同一数值(空间记忆锚点不动)。
      await page.reload();
      await expect(
        page.locator('[data-surface="articles-by-category"] [data-word="chart"]'),
      ).toHaveAttribute('aria-label', expectedLabel);
    },
    // 显式空配置:e2e 进程无 LLM profile(rule 确定路径,I1 口径)
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});

test('S5 附:展示意图的第二形态——"展示文章列表" → table 词条,成员与快照一致', async ({ page }) => {
  await withFreshServer(
    async () => {
      const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 's5-e2e-table',
          driver: 'rule',
          goal: { verb: '展示文章列表' },
        }),
      });
      const json = (await response.json()) as ChatRenderResponse;
      expect(response.status).toBe(200);
      // 无维度词 → table 词条(集合直列),同样零字面。
      expect(json.render!.spec).toEqual({
        concern: 'articles-list',
        component: 'table',
        bind: { rows: { collection: 'articles' } },
      });
      expect(validateSpec(json.render!.spec)).toEqual({ valid: true });
      expect(json.render!.canvasUrl).toBe('/canvas?concern=articles-list');

      // 画布:table surface 渲染集合成员(标题来自实体快照,零发明)。
      const articles = (await (await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`)).json()) as {
        entities: { properties: { fields: { title?: unknown } } }[];
      };
      const titles = articles.entities
        .map((member) => member.properties.fields?.title)
        .filter((title): title is string => typeof title === 'string');
      expect(titles.length).toBe(articles.entities.length);

      await page.goto(`${SCENARIO_BASE}/canvas?concern=articles-list`);
      const surface = page.locator('[data-surface="articles-list"]');
      await expect(surface).toBeVisible();
      await expect(surface.locator('[data-word="table"]')).toBeVisible();
      for (const title of titles) {
        await expect(surface.locator('[data-word="table"]')).toContainText(title);
      }
    },
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});

test('S5 附:render 回执即达即跳——悬浮聊天发送展示意图 → 自动导航画布并激活(同屏协同)', async ({
  page,
}) => {
  await withFreshServer(
    async () => {
      await page.goto(`${SCENARIO_BASE}/`);
      await page.getByRole('button', { name: '展开聊天窗' }).click();
      await page.getByPlaceholder('输入目标…').fill('按分类展示文章');
      await page.getByRole('button', { name: '发送' }).click();

      // 回执即达即跳:URL 自动切到画布(客户端软导航——main 内容区切换,
      // 悬浮面板在 root layout 不重挂载)。
      await expect(page).toHaveURL(/\/canvas\?concern=articles-by-category$/);
      const surface = page.locator('[data-surface="articles-by-category"]');
      await expect(surface).toBeVisible();
      await expect(surface).toHaveAttribute('data-active', 'true');

      // 同屏协同:面板保持打开,回执消息与手动回入口链接仍在。
      await expect(page.getByText(/已生成渲染「articles-by-category」/)).toBeVisible();
      await expect(page.getByRole('link', { name: /在画布查看/ })).toBeVisible();
    },
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});
