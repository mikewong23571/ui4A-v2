/**
 * 工作线知情决定与进行中状态理解(T56 P4.1 常驻覆盖;G3 浏览器门禁)。
 *
 * - **US02 知情决定**(FR6):本线责任卡(P1 投影 approval 成员卡 + P3 决定面板)
 *   在同一主面可读目标对象/动作/依据(T54 知情确认词汇)、未知前值显式「未提供」;
 *   批准经 surface 两段式提交走原确认闸门(fresh read + POST /api/exec),
 *   回执保留、状态回读、过时动作消失。已决卡回执/驳回原因保留可读。
 * - **US03 理解进行**(FR3/FR10):active 引用对象执行声明动作后,成员卡状态
 *   指针与线叙述「上次停在哪」经客户端导航回线即可见(投影随事件更新),
 *   不要求手动整页刷新。
 * - fixture = Fixture A 完整集(work-thread-fixtures):确认挂起经真实 Cedar 门
 *   (agent 提议 202 suspended),零伪装(acceptance §1 纪律)。
 */
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

import {
  cleanupNotifyWorkflows,
  createFullThreadFixture,
  execAction,
  memberCard,
  openThreadOverview,
  runId,
  saveShot,
} from './work-thread-fixtures';

const REJECT_REASON = '证据不足，先补材料';
/** 确认实体依据行的真实投影措辞(Cedar 裁决说明;jsdom fixture 的
 * policy-reason 简写与生产投影不同,以真实服务端为准)。 */
const EVIDENCE_CEDAR = 'Cedar 未许可';
const EVIDENCE_SUSPENDED = '挂起等待人类确认';

test.describe.configure({ mode: 'serial' });

test.describe('work-thread decisions', () => {
  test('US02 知情决定:同一主面可读对象/动作/依据与「未提供」,两步批准回执保留、状态回读、过时动作消失', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await cleanupNotifyWorkflows();
    await withFreshServer(async () => {
      const fixture = await createFullThreadFixture(page, runId());
      await page.setViewportSize({ width: 1440, height: 900 });
      await openThreadOverview(page, fixture.thread);

      // 待决责任卡:同一主面可读目标对象/动作/依据,改变前后未知显式「未提供」。
      const duty = memberCard(page, fixture.pending);
      await expect(duty).toBeVisible();
      await expect(duty).toHaveAttribute('data-word', 'member-card');
      const info = duty.locator('[data-testid="decision-info"]');
      await expect(info).toBeVisible({ timeout: 15_000 });
      await expect(info).toContainText('post:post-welcome');
      await expect(info).toContainText('archive');
      await expect(info).toContainText(EVIDENCE_CEDAR);
      await expect(info).toContainText(EVIDENCE_SUSPENDED);
      await expect(info.locator('[data-decision-row="change"]')).toContainText('未提供');

      // 已决(驳回)责任卡:回执与驳回原因保留可读,动作面退场(A6/A4 反向)。
      const decided = memberCard(page, fixture.decided);
      await expect(decided.locator('[data-decision-row="receipt"]')).toContainText(
        '已由 human 驳回',
        { timeout: 15_000 },
      );
      await expect(decided.locator('[data-decision-row="reject-reason"]')).toContainText(
        REJECT_REASON,
      );
      await expect(decided.getByRole('button', { name: '批准' })).toHaveCount(0);
      await saveShot(page, 'p4-us02-decision-before');

      // 一次提交走原闸门:外层请求风险(零业务事件)→ 内层确认执行,全程零导航。
      const approveItem = duty.locator('[data-action-group-item="approve"]');
      await approveItem.locator('button[data-presentation-action="request-risk"]').click();
      await expect(approveItem.getByText('已请求“批准”，尚未执行。')).toBeVisible();
      const beforeUrl = page.url();
      await approveItem.locator('button[data-action="approve"]').click();
      expect(page.url()).toBe(beforeUrl);

      // 决定后回读:回执保留、状态回读更新、过时动作消失。
      await expect(
        memberCard(page, fixture.pending).locator('[data-decision-row="receipt"]'),
      ).toContainText('已由 human 批准', { timeout: 15_000 });
      await expect(
        memberCard(page, fixture.pending).getByRole('button', { name: '批准' }),
      ).toHaveCount(0);
      await saveShot(page, 'p4-us02-decision-after');

      // 状态回读以事件日志为准:confirmation-approved 由 human 经 confirmation 信道落账。
      const events = await page.request.get(`${SCENARIO_BASE}/api/events`);
      expect(events.ok()).toBe(true);
      const body = (await events.json()) as {
        events: Array<{ kind: string; rel?: string; actor?: string; channel?: string }>;
      };
      const approval = body.events.find(
        (event) => event.kind === 'confirmation-approved' && event.rel === fixture.pending,
      );
      expect(approval?.actor).toBe('human');
      expect(approval?.channel).toBe('confirmation');
      // archive 原动作随批准执行:欢迎文章离开 published(节点状态回读)。
      const post = (await (
        await page.request.get(`${SCENARIO_BASE}/api/entity?rel=post%3Apost-welcome`)
      ).json()) as { properties: { status?: string } };
      expect(post.properties.status).not.toBe('published');
    });
    await cleanupNotifyWorkflows();
  });

  test('US03 active 目标状态变化后,概览经导航回线即更新(成员卡状态指针与「上次停在哪」随合同变化)', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const thread = runId();
      await execAction(page, 'threads', 'create', {
        commandId: thread,
        goal: '推进发布向导并记录进展',
      });
      await execAction(page, `thread:${thread}`, 'attach', {
        category: 'active',
        rel: 'article-drafting:main',
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await openThreadOverview(page, thread);
      // 起步合同状态:statusPointer 逐字携带节点名(basic-info),不翻译不猜测。
      // 普通 active 对象采用摘要行;以 canonical data-rel 锚定同一成员。
      const activeCard = memberCard(page, 'article-drafting:main');
      await expect(activeCard).toBeVisible();
      await expect(activeCard).toHaveAttribute('data-word', 'member-row');
      await expect(activeCard).toContainText('basic-info');

      // 在注视面执行 active 对象的声明动作(参数表单默认收起,先开表单;
      // 节点字段 title 必填;human 常规动作零确认)。
      await page.getByRole('button', { name: /相关材料/ }).click();
      await page.locator('[data-desk-entry="article-drafting:main"] a').click();
      const next = page.locator('[data-action-group-item="next"]');
      await next.locator('button[data-presentation-action="open-form"]').click();
      // 短任务表单挂在 Dialog portal；以该声明动作的标题定位精确宿主。
      const nextDialog = page.getByRole('dialog', { name: '下一步', exact: true });
      await expect(nextDialog).toBeVisible();
      await nextDialog.getByRole('textbox', { name: /文章标题/ }).fill('T56 US03 推进');
      await nextDialog.locator('form').getByRole('button', { name: '下一步', exact: true }).click();
      // 对象面自身先见合同状态变化(分类 = classification 节点标题)。
      await expect(page.locator('main')).toContainText('分类', { timeout: 15_000 });

      // 「返回本线」客户端导航回概览:成员卡与叙述重渲,零手动整页刷新。
      await page.getByRole('link', { name: '返回本线' }).click();
      await expect(memberCard(page, 'article-drafting:main')).toContainText('classification', {
        timeout: 15_000,
      });
      await expect(page.locator('main')).toContainText('停在「classification」');
      await saveShot(page, 'p4-us03-overview-updated');
    });
  });
});
