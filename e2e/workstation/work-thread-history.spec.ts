/**
 * 工作线当时/当前与可辨引用(T56 P4.1 常驻覆盖;G3 浏览器门禁)。
 *
 * - **US08 当时与当前**(FR7):同一 chat session 在 A/B 两条线提问(真实
 *   /api/chat 回合;LLM 未配置 → 回合确定性诚实失败,chat 投影与 user 消息
 *   的 clientView 真实落账),刷新后历史重放:每回合显式「当时」线/注视
 *   (turn-context-notice,join 自 user 事件,服务端真相)、消息重放、不串台;
 *   当前输入范围常显条与当前 URL 一致;旧版回合(user 事件缺失,隔离库 harness
 *   直接 seed chat-turn 事件)显式「当时上下文未知」,不被当前 presence 补造。
 * - **US09 可辨引用**(FR8):chat 传输层注入 SSE 终帧 sources(chat-citations
 *   spec 同一手法的 harness 注入,零产品改动),三型引用 chip 同屏可辨:
 *   精确型(当前名 +「(当前名称)」时点标注 + pointer 对照)、集合/成员型
 *   (集合级依据徽标 + 时点边界行,不解引用成员身份)、不可读(跨 principal
 *   403 → rel + 原路径 +「当前不可读」);点击落点保留 thread。
 */
import { expect, test, type Page } from '@playwright/test';

import { appendEvent } from '../../packages/db/src/events';
import { getPool } from '../../packages/db/src/pool';

import { DATABASE_URL, SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

import {
  NO_LLM_ENV,
  expectAssistantTurnFailed,
  openThreadOverview,
  runId,
  saveShot,
  sendChatGoal,
} from './work-thread-fixtures';

test.describe.configure({ mode: 'serial' });

/** 打开本线并展开助手(FAB → 输入区可见)。 */
async function openThreadWithAssistant(page: Page, threadId: string): Promise<void> {
  await openThreadOverview(page, threadId);
  await page.getByRole('button', { name: '展开聊天窗' }).click();
  await expect(page.getByPlaceholder('输入目标…')).toBeVisible();
}

test.describe('work-thread history', () => {
  test('US08 同 session A/B 线历史:刷新重放各回合当时上下文,未知回合显式未知,当前输入范围正确', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const lineA = runId();
      const lineB = runId();
      for (const [id, goal] of [
        [lineA, 'A 线评审线'],
        [lineB, 'B 线发布线'],
      ] as const) {
        await page.request.post(`${SCENARIO_BASE}/api/exec`, {
          data: {
            rel: 'threads',
            action: 'create',
            params: { commandId: id, goal },
            actor: 'human',
            principal: 'local-user',
            channel: 'e2e',
          },
        });
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      // A 线提问(真实回合;诚实失败但 user 消息 + clientView 落账)。
      await openThreadWithAssistant(page, lineA);
      await sendChatGoal(page, 'A 线:当前进行到哪一步了?');
      await expectAssistantTurnFailed(page);
      const sessionLabel = await page
        .locator('span', { hasText: /^会话 / })
        .first()
        .innerText();

      // 切 B 线提问:同一 session(localStorage 持久),不自动换会话。
      await openThreadWithAssistant(page, lineB);
      await expect(page.locator('span', { hasText: /^会话 / }).first()).toHaveText(sessionLabel);
      await sendChatGoal(page, 'B 线:还有哪些在等我?');
      await expectAssistantTurnFailed(page);

      // 刷新恢复:两回合消息重放,各自「当时」线/注视,不把 B 标签贴到 A 回答。
      await page.reload();
      await openThreadWithAssistant(page, lineB);
      const sessionId = await page.evaluate(() =>
        window.localStorage.getItem('ui4a.chat.sessionId'),
      );
      expect(sessionId).toBeTruthy();
      const notice = page.getByTestId('turn-context-notice');
      await expect(notice).toBeVisible({ timeout: 15_000 });
      const rows = notice.locator('[data-testid="turn-context-row"]');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveAttribute('data-known', 'true');
      await expect(rows.nth(0)).toContainText(`线 ${lineA}`);
      await expect(rows.nth(0)).toContainText(`注视 thread:${lineA}`);
      await expect(rows.nth(1)).toHaveAttribute('data-known', 'true');
      await expect(rows.nth(1)).toContainText(`线 ${lineB}`);
      await expect(rows.nth(1)).not.toContainText(`线 ${lineA}`);
      await expect(page.getByText('A 线:当前进行到哪一步了?')).toBeVisible();
      await expect(page.getByText('B 线:还有哪些在等我?')).toBeVisible();

      // 当前输入范围正确(常显条与当前 URL 同源:B 线)。
      const strip = page.getByTestId('input-scope-strip');
      await expect(strip).toHaveAttribute('data-thread', lineB);
      await expect(strip).toContainText(`线 ${lineB}`);

      // 历史会话面板:同一 session 一行(2 回合),当前标记在场。
      await page.getByRole('button', { name: '历史会话' }).click();
      await expect(page.getByRole('button', { name: /2 回合/ })).toBeVisible();
      await saveShot(page, 'p4-us08-history-ab-context');
      await page.getByRole('button', { name: '返回会话' }).click();

      // 旧版回合(user 事件缺失):隔离库 harness 直接 seed chat-turn 事件,
      // 历史侧显式「当时上下文未知」,不用当前 B 线补造(D78 决定 5)。
      const pool = getPool(DATABASE_URL);
      await appendEvent(pool, {
        kind: 'chat-turn',
        actor: 'agent',
        channel: 'chat',
        principal: 'local-user',
        rel: `chat:${sessionId}`,
        detail: {
          sessionId,
          turnId: 't56-legacy-turn',
          goal: { verb: '旧版回合(无当时观察)' },
          outcome: 'done',
          summary: '旧版回答。',
          messages: [{ role: 'assistant', text: '旧版回答。' }],
          steps: [],
          driver: 'llm',
        },
      });
      await page.reload();
      await openThreadWithAssistant(page, lineB);
      const rowsAfter = page
        .getByTestId('turn-context-notice')
        .locator('[data-testid="turn-context-row"]');
      await expect(rowsAfter).toHaveCount(3, { timeout: 15_000 });
      const legacy = rowsAfter.nth(2);
      await expect(legacy).toHaveAttribute('data-known', 'false');
      await expect(legacy).toContainText('当时上下文未知');
      await expect(legacy).not.toContainText(`线 ${lineB}`);
    }, NO_LLM_ENV);
  });

  test('US09 可辨引用:精确/集合/不可读三型 chip 同屏可辨,集合引用不指向今日成员,点击保留 thread', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const thread = runId();
      await page.request.post(`${SCENARIO_BASE}/api/exec`, {
        data: {
          rel: 'threads',
          action: 'create',
          params: { commandId: thread, goal: '引用可辨性走查' },
          actor: 'human',
          principal: 'local-user',
          channel: 'e2e',
        },
      });
      // 跨 principal 线(引用不可读样本):local-user 读它 → 403 结构化 denied。
      const secret = `${thread}-secret`;
      await page.request.post(`${SCENARIO_BASE}/api/exec`, {
        data: {
          rel: 'threads',
          action: 'create',
          params: { commandId: secret, goal: '他人私有线' },
          actor: 'human',
          principal: 'user:mallory',
          channel: 'e2e',
        },
      });
      const deniedRead = await page.request.get(
        `${SCENARIO_BASE}/api/entity?rel=thread%3A${secret}`,
      );
      expect(deniedRead.status()).toBe(403);

      // chat 传输层注入(harness 手法,chat-citations spec 同口径;非产品改动):
      // 三型 sources —— 精确实体 / 集合成员指针 / 不可读 thread。
      const frames = [
        {
          type: 'step',
          message: { role: 'assistant', text: '依据如下。' },
          activity: { op: 'answer' },
        },
        {
          type: 'final',
          payload: {
            sessionId: 'e2e-us09-citations',
            driver: 'llm',
            requestedDriver: 'auto',
            outcome: 'answered',
            summary: '依据如下。',
            steps: [],
            successes: [],
            sources: [
              { rel: 'post:first-post', pointer: '/properties/fields/body' },
              { rel: 'articles', pointer: '/entities/1/properties/rel' },
              { rel: `thread:${secret}`, pointer: '/properties/status' },
            ],
          },
        },
      ];
      await page.route('**/api/chat', async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        }),
      );

      await page.setViewportSize({ width: 1440, height: 900 });
      await openThreadWithAssistant(page, thread);
      await sendChatGoal(page, '给出依据');
      const citations = page.getByLabel('回答依据');
      await expect(citations).toBeVisible({ timeout: 15_000 });

      // 精确型:当前名 +「(当前名称)」时点标注;声明字段标题(正文)与
      // 原 pointer(审计 title 属性)同在。
      const exact = citations.locator('[data-rel="post:first-post"]');
      await expect(exact).toContainText('第一篇');
      await expect(exact).toContainText('(当前名称)');
      await expect(exact).toContainText('正文');
      await expect(exact).toHaveAttribute('title', /\/properties\/fields\/body/);

      // 集合/成员型:集合级依据徽标 + 时点边界行;只读顶层集合,不显示
      // 「今日第 N 项」成员身份(响应里真实成员名不得泄入 chip)。
      const collection = citations.locator('[data-rel="articles"]');
      await expect(collection).toContainText('集合级依据');
      await expect(collection).toContainText('articles');
      const collectionItem = collection.locator('xpath=ancestor::li[1]');
      await expect(collectionItem).toContainText('回答依据当时的集合内容');
      await expect(collectionItem).toContainText('不指向今天同一位置的条目');
      await expect(citations).not.toContainText('欢迎来到 UI4A');

      // 不可读(跨 principal 403):回退 rel +「当前不可读」,不猜名称;
      // 原 pointer 留审计 title。
      const denied = citations.locator(`[data-rel="thread:${secret}"]`);
      await expect(denied).toContainText(`thread:${secret}`);
      await expect(denied).toHaveAttribute('title', /\/properties\/status/);
      await expect(denied).toContainText('当前不可读');
      await saveShot(page, 'p4-us09-citations-kinds');

      // 点击精确引用:落点保留 thread/scope(线与注视不丢)。
      await exact.click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get('focus'), { timeout: 15_000 })
        .toBe('post:first-post');
      expect(new URL(page.url()).searchParams.get('thread')).toBe(thread);
    });
  });
});
