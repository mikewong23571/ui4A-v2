import { expect, test, type Page } from '@playwright/test';

const RUN_LLM_EVAL = process.env.RUN_LLM_EVAL === '1';
test.skip(!RUN_LLM_EVAL, 'RUN_LLM_EVAL=1 is required for the T21 real-LLM Golden Story');
test.describe.configure({ mode: 'serial' });

interface HistoryTurn {
  outcome: string;
  status: 'running' | 'final';
  summary: string | null;
  steps: { op: { kind: string; subject?: string }; outcome: string }[];
}

async function sessionId(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('ui4a.chat.sessionId') ?? '');
}

async function waitForTurns(page: Page, count: number): Promise<HistoryTurn[]> {
  const id = await sessionId(page);
  expect(id).not.toBe('');
  let turns: HistoryTurn[] = [];
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/chat/history?sessionId=${encodeURIComponent(id)}`,
        );
        const body = (await response.json()) as { turns?: HistoryTurn[] };
        turns = body.turns ?? [];
        return turns.length >= count && turns[count - 1]?.status === 'final' ? count : 0;
      },
      { timeout: 90_000 },
    )
    .toBe(count);
  return turns;
}

async function send(page: Page, text: string): Promise<void> {
  const textbox = page.getByRole('textbox', { name: '输入目标…' });
  await textbox.fill(text);
  await textbox.press('Enter');
}

test('U1–U7 Golden Story keeps clientView and lastNavigation honest across detail/count/list/location', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const beforeArticles = await (await page.request.get('/api/entity?rel=articles')).json();

  await page.goto('/');
  await page.getByRole('button', { name: '展开聊天窗' }).click();

  await send(page, '请把标题叫《第一篇》的文章详情显示在画布上');
  await expect(page).toHaveURL(/\/canvas\?.*focus=post%3Afirst-post/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: '第一篇', exact: true })).toBeVisible();
  let turns = await waitForTurns(page, 1);
  expect(turns[0]?.outcome).toBe('answered');
  expect(turns[0]?.steps.some((step) => step.op.kind === 'present')).toBe(true);

  const detailUrl = page.url();
  await send(page, '总共有几篇？');
  turns = await waitForTurns(page, 2);
  expect(turns[1]?.outcome).toBe('answered');
  expect(turns[1]?.summary).toMatch(/2\s*篇|共有\s*2/);
  expect(page.url()).toBe(detailUrl);
  await expect(page.getByRole('heading', { name: '第一篇', exact: true })).toBeVisible();

  await send(page, '我要看看列表');
  await expect(page).toHaveURL(/\/canvas\?.*focus=articles(?:&|$)/, { timeout: 90_000 });
  await expect(page.getByRole('link', { name: '欢迎来到 UI4A', exact: true })).toBeVisible();
  turns = await waitForTurns(page, 3);
  expect(turns[2]?.outcome).toBe('answered');
  expect(turns[2]?.steps.some((step) => step.op.kind === 'present')).toBe(true);

  await send(page, '我现在在哪？');
  turns = await waitForTurns(page, 4);
  expect(turns[3]?.outcome).toBe('answered');
  expect(turns[3]?.summary).toMatch(/articles|文章集合|文章列表/);
  expect(page.url()).toMatch(/focus=articles(?:&|$)/);

  const afterArticles = await (await page.request.get('/api/entity?rel=articles')).json();
  expect(afterArticles).toEqual(beforeArticles);

  const id = await sessionId(page);
  const audit = (await (
    await page.request.get(`/api/events?principal=${encodeURIComponent(`user:${id}`)}&limit=100`)
  ).json()) as {
    events: { kind: string; detail: { prompt?: { user?: string } } }[];
  };
  expect(audit.events.some((event) => event.kind === 'chat-navigation-completed')).toBe(true);
  expect(
    audit.events.some(
      (event) =>
        event.kind === 'agent-decision' &&
        event.detail.prompt?.user?.includes('"clientInstanceId"') === true &&
        event.detail.prompt.user.includes('"navigationId"'),
    ),
  ).toBe(true);
  expect(
    audit.events.filter((event) =>
      ['action-executed', 'entity-appended', 'spawn-requested', 'plan-executed'].includes(
        event.kind,
      ),
    ),
  ).toEqual([]);
});
