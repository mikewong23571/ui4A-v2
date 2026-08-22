/**
 * T14 Phase D — walkthrough remediation 的脚本化复验。
 *
 * 单个 fresh-dev 场景按原 walkthrough 次序覆盖 US-1/US-2/US-13/US-14，
 * 让人类 renderer 与 agent chat 共用同一事件日志；断言只落在本 track
 * 修复的 #1–#7，不复制全量 B/S/I 回归（由 pnpm e2e 负责）。
 */
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './server-kit';

test.use({ baseURL: SCENARIO_BASE });
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

interface ArticleCollection {
  properties: { count: number };
  entities: {
    properties: {
      rel: string;
      fields?: Record<string, unknown>;
    };
  }[];
}

interface LoggedEvent {
  seq: number;
  kind: string;
  actor: string | null;
  action: string | null;
}

interface ChatFinalPayload {
  driver: 'rule' | 'llm';
  outcome: 'done' | 'failed' | 'max-steps';
}

interface ChatFrame {
  type: 'step' | 'final' | 'error' | 'thinking' | 'thinking-delta' | 'render';
  payload?: ChatFinalPayload;
  error?: string;
}

interface RenderResponse {
  outcome: string;
  render?: {
    concern: string;
    spec: { component: string };
    canvasUrl: string;
  };
}

async function articles(): Promise<ArticleCollection> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`);
  expect(response.status).toBe(200);
  return (await response.json()) as ArticleCollection;
}

async function events(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { events: LoggedEvent[] };
  return body.events;
}

function parseSseFrames(raw: string): ChatFrame[] {
  return raw
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as ChatFrame);
}

async function publishViaChat(): Promise<ChatFrame[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 't14-walkthrough-agent',
      driver: 'rule',
      goal: {
        verb: '发布一篇文章',
        fields: {
          title: 'walkthrough-agent',
          category: 'essay',
          tags: 'agent-walkthrough',
          body: 'T14 walkthrough agent 合同路径。',
        },
      },
    }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  return parseSseFrames(await response.text());
}

async function requestRender(verb: string): Promise<RenderResponse> {
  const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: `t14-render-${verb}`,
      driver: 'rule',
      goal: { verb },
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as RenderResponse;
}

test('US-1/2/13/14:双执行者发布 → 稳定渲染 → 可读审计，#1–#7 闭环', async ({ page }) => {
  await withFreshServer(
    async () => {
      // US-1:renderer 路径。首页与字段先用人话；ready 页复用前序 title。
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '运行概览' })).toBeVisible();
      await expect(page.getByText('执行中委托')).toBeVisible();
      await expect(page.getByTestId('stat-running-help')).toHaveText('已派发且尚未完成的委托数量');

      await page.click('a[data-rel="flow:article-drafting"]');
      await page.fill('#root_title', 'walkthrough-human');
      await page.getByRole('button', { name: '下一步' }).click();
      await page.selectOption('#root_category', 'tech');
      await page.fill('#root_tags', 'human-walkthrough');
      await page.getByRole('button', { name: '下一步' }).click();
      await page.fill('#root_body', 'T14 walkthrough human renderer 路径。');
      await page.getByRole('button', { name: '完成编辑' }).click();

      await expect(page.locator('h1')).toHaveText('就绪');
      await expect(page.getByLabel('文章标题')).toHaveValue('walkthrough-human');
      await expect(page.getByText(/用于生成文章地址/)).toBeVisible();
      await page.getByRole('button', { name: '发布' }).click();
      await expect(page.locator('h1')).toHaveText('基本信息');

      const afterHuman = await articles();
      const humanArticle = afterHuman.entities.find(
        (entity) => entity.properties.fields?.title === 'walkthrough-human',
      );
      expect(humanArticle?.properties.fields).toMatchObject({
        category: 'tech',
        tags: 'human-walkthrough',
      });

      // US-2:agent 经 chat 合同走同一条发布 flow，保留逐步帧与审计事件。
      const frames = await publishViaChat();
      expect(frames.length).toBeGreaterThan(1);
      expect(frames.at(-1)?.type).toBe('final');
      expect(frames.at(-1)?.payload).toMatchObject({ driver: 'rule', outcome: 'done' });

      const afterAgent = await articles();
      expect(afterAgent.properties.count).toBe(4);
      const agentArticle = afterAgent.entities.find(
        (entity) => entity.properties.fields?.title === 'walkthrough-agent',
      );
      expect(agentArticle?.properties.fields).toMatchObject({
        category: 'essay',
        tags: 'agent-walkthrough',
      });

      const sharedLog = await events();
      const publishActors = sharedLog
        .filter((event) => event.kind === 'action-executed' && event.action === 'publish')
        .map((event) => event.actor);
      expect(publishActors).toEqual(expect.arrayContaining(['human', 'agent']));
      expect(sharedLog.some((event) => event.kind === 'agent-decision')).toBe(true);
      expect(sharedLog.some((event) => event.kind === 'chat-turn')).toBe(true);

      // US-13:table/chart 两种词条均从同一集合生成；新增成员字段完整，chart
      // 无坏成员警告，重载后凝固 surface 与数据计数保持稳定。
      const tableRender = await requestRender('展示文章列表');
      expect(tableRender).toMatchObject({
        outcome: 'done',
        render: { concern: 'articles-list', spec: { component: 'table' } },
      });
      const chartRender = await requestRender('按分类展示文章');
      expect(chartRender).toMatchObject({
        outcome: 'done',
        render: { concern: 'articles-by-category', spec: { component: 'chart' } },
      });

      await page.goto(chartRender.render!.canvasUrl);
      const chart = page.locator('[data-surface="articles-by-category"] [data-word="chart"]');
      await expect(chart).toHaveAttribute('aria-label', '维度计数:tech=2, essay=2');
      await expect(page.getByTestId('surface-warning')).toHaveCount(0);
      await expect(page.getByTestId('canvas-errors')).toHaveCount(0);
      await page.reload();
      await expect(chart).toHaveAttribute('aria-label', '维度计数:tech=2, essay=2');

      // US-14:/events 逐页展开完整共享日志；每条有时间、机械摘要、默认
      // 折叠的原始审计层，human/agent/chat/decision 均可辨。
      const totalEvents = (await events()).length;
      await page.goto('/events');
      const disclosures = page.locator('details[data-nav="local:event-detail"]');
      await expect(disclosures.first()).toBeVisible();
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const loadMore = page.getByRole('button', { name: '加载更多' });
        if ((await loadMore.count()) === 0) break;
        const before = await disclosures.count();
        await loadMore.click();
        await expect(disclosures).not.toHaveCount(before);
      }
      await expect(disclosures).toHaveCount(totalEvents);
      await expect(page.locator('[data-word="timeline"] time')).toHaveCount(totalEvents);
      await expect(
        page.locator('[data-word="timeline"] p', { hasText: '执行「publish」' }).first(),
      ).toBeVisible();
      await expect(
        page.locator('[data-word="timeline"] p', { hasText: '聊天回合' }).first(),
      ).toBeVisible();
      await expect(
        page.locator('[data-word="timeline"] p', { hasText: '步决策(rule)' }).first(),
      ).toBeVisible();
      const auditText = (await disclosures.allTextContents()).join('\n');
      expect(auditText).toContain('"actor": "human"');
      expect(auditText).toContain('"actor": "agent"');
      expect(auditText).toContain('"detail"');
      await disclosures.first().locator('summary').click();
      await expect(disclosures.first()).toHaveAttribute('open', '');
    },
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});
