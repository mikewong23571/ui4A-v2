/** Standing home stories. Authored for the final merged verification, not a per-track server. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { SirenEntity } from '@ui4a/engine';

import { terminateStaleNotifyWorkflows } from '../../apps/web/src/temporal/notify';
import { SCENARIO_BASE, withFreshServer, withWorkerServer } from '../kits/server-kit';

const NO_MODEL = { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' };

async function exec(
  page: Page,
  rel: string,
  action: string,
  params?: Record<string, unknown>,
  principal = 'local-user',
) {
  const response = await page.request.post(`${SCENARIO_BASE}/api/exec`, {
    data: { rel, action, params, actor: 'human', principal, channel: 'e2e' },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function read(page: Page, rel: string): Promise<SirenEntity> {
  const response = await page.request.get(`${SCENARIO_BASE}/api/entity`, { params: { rel } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<SirenEntity>;
}

async function create(
  page: Page,
  goal: string,
  status: 'open' | 'paused' | 'completed' | 'archived' = 'open',
) {
  const id = randomUUID();
  await exec(page, 'threads', 'create', { goal, commandId: id });
  if (status !== 'open') {
    await exec(
      page,
      `thread:${id}`,
      status === 'paused' ? 'pause' : status === 'completed' ? 'complete' : 'archive',
    );
  }
  return `thread:${id}`;
}

async function home(page: Page) {
  await page.goto(SCENARIO_BASE);
  await expect(page.locator('main h1')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveText('我的事');
  await expect(page.locator('[data-surface]')).toBeVisible();
  await expect(page.getByTestId('canvas-errors')).toHaveCount(0);
}

async function capture(page: Page, info: TestInfo, name: string) {
  const imagePath = info.outputPath(`${name}.png`);
  await page.screenshot({ path: imagePath, fullPage: true });
  await info.attach(`${name}.png`, {
    path: imagePath,
    contentType: 'image/png',
  });
  await info.attach(`${name}.json`, {
    body: JSON.stringify({
      scenario: name,
      route: page.url(),
      viewport: page.viewportSize(),
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    }),
    contentType: 'application/json',
  });
}

test.describe.configure({ mode: 'serial' });
test.beforeEach(() => test.setTimeout(240_000));

test('home shows current work without delegations and separates history under the same authorized contract', async ({
  page,
}, info) => {
  await withFreshServer(async () => {
    const open = await create(page, '继续核验版本差异');
    const paused = await create(page, '等待补充评审材料', 'paused');
    const completed = await create(page, '已经完成的研究', 'completed');
    const archived = await create(page, '归档不代表已经验收', 'archived');
    await exec(
      page,
      'threads',
      'create',
      { goal: '其他人的私有目标', commandId: randomUUID() },
      'other-principal',
    );

    const current = await read(page, 'threads-current');
    const history = await read(page, 'threads-history');
    expect(current.entities?.map((entry) => entry.properties.rel)).toEqual(
      expect.arrayContaining([open, paused]),
    );
    expect(history.entities?.map((entry) => entry.properties.rel)).toEqual(
      expect.arrayContaining([completed, archived]),
    );
    expect(current.actions).toEqual([]);
    expect(history.actions).toEqual([]);
    expect((await read(page, 'delegations')).entities ?? []).toHaveLength(0);

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1080, height: 820 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      const { width } = viewport;
      await page.setViewportSize(viewport);
      await home(page);
      await expect(page.locator(`[data-word="member-row"][data-rel="${open}"]`)).toBeVisible();
      await expect(page.locator(`[data-word="member-row"][data-rel="${paused}"]`)).toBeVisible();
      await expect(page.locator(`[data-rel="${completed}"]`)).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('其他人的私有目标');
      await expect(page.locator('main')).toContainText('当前可见列表没有进行中的事项。');
      await expect(page.locator('main')).not.toContainText(/没有正在推进的工作/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const row = page.locator(`[data-word="member-row"][data-rel="${open}"]`);
      await expect(row.getByRole('button', { name: '更多操作' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(row.locator('[data-action]:visible')).toHaveCount(0);
      if (width === 1440 || width === 390) {
        await capture(page, info, `home-current-${width}`);
      }
    }
    await page.locator('a[href*="focus=threads-history"]').click();
    await expect(page).toHaveURL(/focus=threads-history/);
    await expect(page.getByText('已经完成的研究', { exact: true })).toBeVisible();
    await expect(page.getByText('归档不代表已经验收', { exact: true })).toBeVisible();
    await capture(page, info, 'home-history-390');
  }, NO_MODEL);
});

test('empty home offers goal-only creation; lost accepted response retries once with an auditable original source', async ({
  page,
}, info) => {
  await withFreshServer(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await home(page);
    await expect(page.locator('[data-word="member-row"]')).toHaveCount(0);
    await capture(page, info, 'home-empty-390');
    await page.getByRole('link', { name: '发起工作', exact: true }).click();
    await expect(page).toHaveURL(/focus=threads/);
    const trigger = page.getByRole('button', { name: '创建工作线', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '创建工作线' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(1);
    await expect(dialog.getByLabel(/提交标识|目标来源|工作线标识/)).toHaveCount(0);
    const goal = '给下周评审准备可核验的版本差异';
    await dialog.getByRole('textbox', { name: /目标/ }).fill(goal);
    await capture(page, info, 'home-create-dialog-390');
    const sent: Array<{ goal: string; commandId: string }> = [];
    await page.route('**/api/exec', async (route) => {
      const body = route.request().postDataJSON() as {
        rel: string;
        action: string;
        params: { goal: string; commandId: string };
      };
      if (body.rel !== 'threads' || body.action !== 'create') return route.continue();
      sent.push(body.params);
      if (sent.length === 1) {
        // Real server accepts, then only the browser's response is lost.
        const accepted = await route.fetch();
        expect(accepted.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await dialog.getByRole('button', { name: '创建工作线', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await capture(page, info, 'home-create-failure-390');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByRole('textbox', { name: /目标/ })).toHaveValue(goal);
    await dialog.getByRole('button', { name: '创建工作线', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(Object.keys(sent[0]).sort()).toEqual(['commandId', 'goal']);
    const createdRel = `thread:${sent[0].commandId}`;
    const created = await read(page, createdRel);
    const source = created.links.find((link) => link.rel.includes('source'));
    expect(source).toBeDefined();
    const inputRel = new URL(source!.href, SCENARIO_BASE).searchParams.get('rel')!;
    expect(inputRel).toBe(`thread-input:${sent[0].commandId}`);
    expect((await read(page, inputRel)).properties).toMatchObject({
      text: goal,
      owner: 'local-user',
    });
    const eventResponse = await page.request.get(
      `${SCENARIO_BASE}/api/events?kind=thread-created&limit=100`,
    );
    const events = (await eventResponse.json()) as {
      events: Array<{ detail: { threadId?: string } }>;
    };
    expect(
      events.events.filter((event) => event.detail.threadId === sent[0].commandId),
    ).toHaveLength(1);
    await page.goto(`${SCENARIO_BASE}/canvas?focus=${encodeURIComponent(createdRel)}`);
    await expect(page.getByRole('link', { name: '创建时的目标原文' })).toBeVisible();
    await page.getByRole('link', { name: '创建时的目标原文' }).click();
    await expect(page.locator('main')).toContainText(goal);
    await capture(page, info, 'home-created-source-390');
  }, NO_MODEL);
});

test('390px keyboard assistant shares session and unsent draft through work navigation and return', async ({
  page,
}, info) => {
  await withFreshServer(async () => {
    const rel = await create(page, '保持本次工作的上下文');
    const sessionId = randomUUID();
    await page.addInitScript((id) => localStorage.setItem('ui4a.chat.sessionId', id), sessionId);
    await page.setViewportSize({ width: 390, height: 844 });
    await home(page);
    const discuss = page.getByRole('button', { name: '与助手讨论', exact: true });
    await discuss.focus();
    await page.keyboard.press('Enter');
    const input = page.getByPlaceholder('输入目标…');
    await input.fill('先帮我核对目标，暂时不要执行');
    await capture(page, info, 'home-assistant-draft-390');
    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible();
    await expect(discuss).toBeFocused();
    await page
      .locator(`[data-word="member-row"][data-rel="${rel}"]`)
      .getByRole('link', { name: '保持本次工作的上下文' })
      .click();
    await expect(page).toHaveURL(/focus=thread%3A/);
    await page.getByRole('button', { name: '展开聊天窗' }).click();
    await expect(input).toHaveValue('先帮我核对目标，暂时不要执行');
    expect(await page.evaluate(() => localStorage.getItem('ui4a.chat.sessionId'))).toBe(sessionId);
    await page.keyboard.press('Escape');
    await page.goBack();
    await expect(page.locator('main h1')).toHaveText('我的事');
    await discuss.click();
    await expect(input).toHaveValue('先帮我核对目标，暂时不要执行');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }, NO_MODEL);
});

test('current responsibility stays expanded beside ordinary summary rows and remains actionable', async ({
  page,
}, info) => {
  await terminateStaleNotifyWorkflows(['c1']);
  await withWorkerServer(async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const rel = await create(page, '普通工作的管理动作按需展开');
    const proposal = await page.request.post(`${SCENARIO_BASE}/api/exec`, {
      data: {
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        principal: 'local-user',
        channel: 'e2e',
      },
    });
    expect(proposal.status()).toBe(202);
    await home(page);
    const card = page
      .locator('[data-word="member-card"]')
      .filter({ has: page.locator('[data-action-group-item="approve"]') });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('button', { name: '批准', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: '更多操作' })).toHaveCount(0);
    const row = page.locator(`[data-word="member-row"][data-rel="${rel}"]`);
    await expect(row.getByRole('button', { name: '更多操作' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await capture(page, info, 'home-responsibility-and-summary-1440');
    await card.getByRole('button', { name: '批准', exact: true }).click();
    await expect(card.getByText('已请求“批准”，尚未执行。')).toBeVisible();
    await card.locator('button[data-action="approve"]').click();
    await expect(card).toHaveCount(0);
    await expect(row).toBeVisible();
  }, NO_MODEL);
});
