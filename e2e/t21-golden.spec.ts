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

const variants = [
  [
    '在画布里打开标题为《第一篇》的文章',
    '文章一共多少篇？',
    '切换到全部文章视图',
    '当前画布展示什么？',
  ],
  [
    '展示《第一篇》这篇文章的详情',
    '现在总计有多少文章？',
    '让我浏览文章集合',
    '我此刻看到的是哪个视图？',
  ],
  [
    'Open the article titled 第一篇 on the canvas',
    'How many articles are there?',
    'Show the article list',
    'Which subject is visible now?',
  ],
  [
    '我想在画布阅读标题叫第一篇的内容',
    '全部文章数量是多少？',
    '把界面换成文章列表',
    '告诉我当前所在的页面',
  ],
] as const;

test('U1–U7 four natural-language variants meet the user-result quality gate', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const results: { variant: number; passed: boolean; summaries: Array<string | null> }[] = [];

  for (const [index, inputs] of variants.entries()) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: '展开聊天窗' }).click();

    await send(page, inputs[0]);
    await expect(page).toHaveURL(/\/canvas\?.*focus=post%3Afirst-post/, { timeout: 90_000 });
    const detailUrl = page.url();
    let turns = await waitForTurns(page, 1);

    await send(page, inputs[1]);
    turns = await waitForTurns(page, 2);
    const countPassed =
      turns[1]?.outcome === 'answered' &&
      /2\s*篇|共有\s*2|2 articles/i.test(turns[1]?.summary ?? '');
    const detailStayed = page.url() === detailUrl;

    await send(page, inputs[2]);
    await expect(page).toHaveURL(/\/canvas\?.*focus=articles(?:&|$)/, { timeout: 90_000 });
    turns = await waitForTurns(page, 3);
    const listPassed =
      turns[2]?.steps.some((step) => step.op.kind === 'present') === true &&
      /focus=articles(?:&|$)/.test(page.url());

    await send(page, inputs[3]);
    turns = await waitForTurns(page, 4);
    const locationPassed =
      turns[3]?.outcome === 'answered' &&
      /articles|文章集合|文章列表/i.test(turns[3]?.summary ?? '');
    results.push({
      variant: index + 1,
      passed: countPassed && detailStayed && listPassed && locationPassed,
      summaries: turns.map((turn) => turn.summary),
    });
  }

  await testInfo.attach('t21-variant-evidence.json', {
    body: Buffer.from(
      JSON.stringify({ model: process.env.LLM_MODEL, inputs: variants, results }, null, 2),
    ),
    contentType: 'application/json',
  });
  expect(results.filter((result) => result.passed).length / results.length).toBeGreaterThanOrEqual(
    0.8,
  );
});
