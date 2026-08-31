import { expect, test, type Page } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

interface PresenceEvent {
  kind: string;
  detail: { value?: unknown } | null;
}

function trackPresenceResponses(page: Page): Set<string> {
  const kinds = new Set<string>();
  page.on('response', async (response) => {
    if (!response.url().endsWith('/api/presence') || response.status() !== 200) return;
    const body = response.request().postDataJSON() as { kind?: unknown };
    if (typeof body.kind === 'string') kinds.add(body.kind);
  });
  return kinds;
}

async function presenceChangePoints(page: Page): Promise<string[]> {
  const response = await page.request.get(
    `${SCENARIO_BASE}/api/events?domain=presence&principal=local-user&limit=100`,
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { events: PresenceEvent[] };
  return body.events.map((event) => `${event.kind}:${JSON.stringify(event.detail?.value ?? null)}`);
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => test.setTimeout(180_000));

test('workstation 声明条与 presence 留痕同源，scope/出线保留其他 query', async ({ page }) => {
  await withFreshServer(async () => {
    // presence_current is an independently rebuildable projection and the shared E2E reset only
    // truncates events. Prime an opposite structured observation and wait for all four writes, so
    // every following assertion proves this browser navigation rather than inherited projection.
    const primeResponses = trackPresenceResponses(page);
    await page.goto(
      `${SCENARIO_BASE}/meta?scope=governance&thread=situation-prime&focus=meta%2Fflows`,
    );
    await expect.poll(() => primeResponses.size, { timeout: 15_000 }).toBe(4);

    const workstationResponses = trackPresenceResponses(page);
    await page.goto(
      `${SCENARIO_BASE}/canvas?mode=raw&scope=publishing&thread=release-1&focus=post%3Aone`,
    );
    await expect.poll(() => workstationResponses.size, { timeout: 15_000 }).toBe(4);
    const situation = page.getByRole('region', { name: '声明的处境' });
    await expect(situation).toBeVisible();
    await expect(situation.getByTestId('situation-site')).toHaveText('工作站');
    await expect(situation.getByTestId('situation-scope')).toHaveText('内容发布');
    await expect(situation.getByTestId('situation-thread')).toHaveText('无法读取');
    await expect(situation.getByTestId('situation-focus')).toHaveText('无法读取');
    // T39/D51:凭证授予决定权限；scope 只表达当前注意力，不进入授权签名。
    // (371f041 文案收敛后,「在哪」弹层以全量处境字段 + 授权 sitemap 驱动的
    // 「应用」选择器承载该语义,说明性句子不再占位——见 situation-bar.test。)
    await situation.getByRole('button', { name: '在哪' }).click();
    const situationDialog = page.getByRole('dialog', { name: '当前在哪' });
    await expect(situationDialog).toBeVisible();
    await expect(situationDialog).toContainText('内容发布');
    await expect(situationDialog.locator('#situation-scope-selector')).toBeVisible();

    await expect
      .poll(() => presenceChangePoints(page), { timeout: 15_000 })
      .toEqual(
        expect.arrayContaining([
          'presence-site-changed:"workstation"',
          'presence-scope-changed:"publishing"',
          'presence-thread-changed:"release-1"',
          'presence-focus-changed:"post:one"',
        ]),
      );

    await situation.getByRole('link', { name: '退出工作线' }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('thread'), { timeout: 15_000 })
      .toBeNull();
    expect(new URL(page.url()).searchParams.get('mode')).toBe('raw');
    expect(new URL(page.url()).searchParams.get('scope')).toBe('publishing');
    expect(new URL(page.url()).searchParams.get('focus')).toBe('post:one');
    // T35 D-7:未声明 = 条上无芯片(弹层 dd 显示原始 null,不作断言目标)。
    await expect(situation.locator('span[data-testid="situation-thread"]')).toHaveCount(0);
    await expect
      .poll(() => presenceChangePoints(page), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['presence-thread-changed:null']));

    await situation.getByRole('link', { name: '清除应用' }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('scope'), { timeout: 15_000 })
      .toBeNull();
    expect(new URL(page.url()).searchParams.get('mode')).toBe('raw');
    expect(new URL(page.url()).searchParams.get('focus')).toBe('post:one');
    await expect(situation.locator('span[data-testid="situation-scope"]')).toHaveCount(0);
    await expect
      .poll(() => presenceChangePoints(page), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['presence-scope-changed:null']));

    await page.goto(`${SCENARIO_BASE}/meta?scope=governance&focus=meta%2Fflow%3Aarticle-drafting`);
    await expect(situation.getByTestId('situation-site')).toHaveText('定义站');
    await expect(situation.getByTestId('situation-scope')).toHaveText('Agent 治理');
    await expect(situation.getByTestId('situation-focus')).toHaveText('文章发布向导');
    await expect
      .poll(() => presenceChangePoints(page), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['presence-site-changed:"meta"']));
  });
});
