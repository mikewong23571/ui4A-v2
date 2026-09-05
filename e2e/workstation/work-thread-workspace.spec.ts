/**
 * T56 工作线工作台常驻 E2E(G3;acceptance §2 US01/US05/US07、design §1 几何契约、
 * DECISIONS D78 实测断点)。期望值基线 = `conductor/tracks/
 * t56-work-thread-workspace_20260905/probes/s3-layout-session.md` §1/§2 实测表。
 *
 * P2.2 起,壳重构已落地(去 noGaze 旁路/无永久材料栏/剩余宽度助手/覆盖层
 * 交互/客户端导航),「等 P2.2」的 fixme 转为活跃 test;仅 clientView 断言
 * (依赖 P3 ChatTurn 投影)保留 fixme 并注明。fixture 走规范 `/api/exec`
 * create/attach(acceptance §1 A 线;每次运行唯一前缀 `t56-<runId>`,隔离库
 * 由 server-kit 保证)。
 */
import { expect, test, type Page } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

/** 每场景唯一前缀(acceptance §1:`t56-<runId>`,防跨轮次残留)。 */
function runId(): string {
  return `t56-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function execAction(
  page: Page,
  rel: string,
  action: string,
  params?: Record<string, unknown>,
): Promise<void> {
  const response = await page.request.post(`${SCENARIO_BASE}/api/exec`, {
    data: {
      rel,
      action,
      ...(params === undefined ? {} : { params }),
      actor: 'human',
      principal: 'local-user',
      channel: 'e2e',
    },
  });
  expect(response.ok()).toBe(true);
}

/** acceptance §1 A 线(最小集):open + 明确目标 + context/active/approval
 * (t26 同款 attach 口径,approval 允许 dangling;跨第二应用 context、历史决定
 * 与显式 event 的完整 fixture 随 P4 全景验收补齐)。 */
async function createThreadFixture(page: Page, threadId: string): Promise<void> {
  await execAction(page, 'threads', 'create', {
    id: threadId,
    goal: '完成一项跨应用评审并记录决定',
    goalSource: 'e2e:t56',
  });
  await execAction(page, `thread:${threadId}`, 'attach', { category: 'context', rel: 'articles' });
  await execAction(page, `thread:${threadId}`, 'attach', {
    category: 'active',
    rel: 'article-drafting:main',
  });
  await execAction(page, `thread:${threadId}`, 'attach', {
    category: 'approval',
    rel: `confirmation:${threadId}`,
  });
}

async function coreEventKinds(page: Page): Promise<string[]> {
  const response = await page.request.get(`${SCENARIO_BASE}/api/events?domain=core`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { events: Array<{ kind: string }> };
  return body.events.map((event) => event.kind);
}

interface Geometry {
  vw: number;
  mainWidth: number;
  assistantWidth: number;
  /** 助手与主区并排(主区右缘不与助手重叠)= 非覆盖/非浮层形态。 */
  sideBySide: boolean;
  /** body 横向滚动(document scrollWidth 超出视口)。 */
  hscroll: boolean;
  assistantLeft: number;
  assistantRight: number;
}

/** 助手宿主:并排形态是 aside;覆盖悬浮是右下 fixed 容器——两者都以
 * ChatPanel 头部「UI4A 助手」文本定位。 */
async function measureGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const box = (el: Element): DOMRect => el.getBoundingClientRect();
    const main = document.querySelector('main');
    const assistant = [...document.querySelectorAll('aside, .fixed')].find((el) =>
      (el.textContent ?? '').includes('UI4A 助手'),
    );
    const mainRect = main === null ? null : box(main);
    const assistantRect = assistant === null ? null : box(assistant);
    return {
      vw: window.innerWidth,
      mainWidth: Math.round(mainRect?.width ?? 0),
      assistantWidth: Math.round(assistantRect?.width ?? 0),
      sideBySide:
        mainRect !== null &&
        assistantRect !== null &&
        mainRect.width > 0 &&
        assistantRect.width > 0 &&
        mainRect.right <= assistantRect.left + 1,
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
      assistantLeft: Math.round(assistantRect?.left ?? 0),
      assistantRight: Math.round(assistantRect?.right ?? 0),
    };
  });
}

// design §1 验证视口(200% 缩放单独用例:布局视口 960 CSS px + deviceScaleFactor 2)。
const D78_VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1080x820', width: 1080, height: 820 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
] as const;

test.describe.configure({ mode: 'serial' });

test.describe('work-thread-workspace', () => {
  test('US07 外部直接进对象不隐式建线(现状即绿,钉住防回归)', async ({ page }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SCENARIO_BASE}/canvas?focus=articles`);
      // 前置:对象/集合面真实上屏(排除「没加载所以没建线」的假绿)。
      await expect(page.locator('[data-surface]').first()).toBeVisible();
      await expect(page.locator('[data-testid="canvas-errors"]')).toHaveCount(0);
      // D44/FR1:直进对象不隐式创建工作线(成员只由显式 attach 事件决定)。
      expect(await coreEventKinds(page)).not.toContain('thread-created');
    });
  });

  test('US01 深链进入本线:目标/生命周期/当前可见责任为主内容,非说明书+应用书架(D78 去 noGaze 旁路)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
      const main = page.locator('main');
      // 目标完整可读 + 唯一 H1(线目标,D78/design §1)+ 生命周期状态。
      await expect(main.getByText('完成一项跨应用评审并记录决定')).toBeVisible();
      await expect(main.locator('h1')).toHaveCount(1);
      // 主区域不是旁路说明书/应用书架(F02/FR1/US01)。
      await expect(main).not.toContainText('左侧书桌常驻');
      await expect(page.getByTestId('application-entry-strip')).toHaveCount(0);
      // 当前可见责任入口可到达(D78 决定 3 口径:approval 成员卡,D50 责任卡;
      // 「被裁剪 vs 真空」不可辨,文案只陈述「当前可见」)。精确责任断言随
      // P1.2 投影成员卡落地后在 P4 细化。
      await expect(main.getByText('进行中')).toBeVisible();
    });
  });

  test('US01 thread=T 无显式 focus:落本线概览而非默认对象注视(D78)', async ({ page }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}`);
      // 可解释本线落点:唯一 H1 = 线目标,而非默认 articles 集合面(FR1)。
      const main = page.locator('main');
      await expect(main.locator('h1')).toHaveCount(1);
      await expect(main.locator('h1')).toContainText('完成一项跨应用评审并记录决定');
    });
  });

  test('US05 五视口×助手开/关:默认无永久材料栏、主区≥640 且≥两栏净宽 60%、无 body 横滚(D78 阈值 1072/1008,按剩余宽度判断)', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      for (const viewport of D78_VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
        // 默认无永久材料栏(FR4/D78 决定 1)。
        await expect(page.getByTestId('thread-desk-rail')).toHaveCount(0);
        // 关助手:主面全宽可读,无 body 横滚。
        let geometry = await measureGeometry(page);
        expect(geometry.hscroll, `${viewport.name} 关助手横滚`).toBe(false);
        // 开助手:并排/覆盖由剩余宽度决定(vw−48−助手宽≥640),非整屏 lg:。
        await page.getByRole('button', { name: '展开聊天窗' }).click();
        geometry = await measureGeometry(page);
        expect(geometry.hscroll, `${viewport.name} 开助手横滚`).toBe(false);
        if (geometry.sideBySide) {
          expect(geometry.mainWidth, `${viewport.name} 并排主区宽`).toBeGreaterThanOrEqual(640);
          const net = geometry.mainWidth + geometry.assistantWidth;
          expect(geometry.mainWidth / net, `${viewport.name} 并排占比`).toBeGreaterThanOrEqual(0.6);
        }
      }
    });
  });

  test('US05 390px 覆盖助手不超出屏幕 + Escape 可关 + 关闭后焦点恢复(design §1)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
      const fab = page.getByRole('button', { name: '展开聊天窗' });
      await fab.click();
      // 覆盖助手(剩余宽度不足 → float 覆盖层,宽度收窄 min(24rem, 100vw−2rem))
      // 整体在视口内,不带动 body 横滚。
      const geometry = await measureGeometry(page);
      expect(geometry.assistantLeft, '覆盖助手左缘不裁出屏').toBeGreaterThanOrEqual(0);
      expect(geometry.assistantRight, '覆盖助手右缘不出屏').toBeLessThanOrEqual(geometry.vw);
      expect(geometry.hscroll).toBe(false);
      // Escape 关闭 + 焦点恢复到唤起元素(design §1 覆盖层交互下限)。
      await page.keyboard.press('Escape');
      await expect(page.getByPlaceholder('输入目标…')).toHaveCount(0);
      await expect(fab).toBeFocused();
    });
  });

  test('US05 200% 缩放(布局视口 960 CSS px):助手必须覆盖/单面,不得并排(D78)', async ({ page }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      await page.setViewportSize({ width: 960, height: 540 });
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
      await page.getByRole('button', { name: '展开聊天窗' }).click();
      const geometry = await measureGeometry(page);
      // 960 < 1008(320px 助手阈值):任何助手宽度都不得并排。
      expect(geometry.sideBySide, '200% 缩放禁止并排').toBe(false);
      expect(geometry.hscroll).toBe(false);
    });
  });

  test('US07 材料 X→Y→返回本线→后退:URL/覆盖层/线保留一致(FR4·FR7/US07;客户端导航+材料入口)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
      // 「相关材料」入口(FR4)默认收起;展开覆盖层进 X(articles,context 成员)。
      const materials = page.getByRole('button', { name: /相关材料/ });
      await expect(materials).toHaveAttribute('aria-expanded', 'false');
      await materials.click();
      await page.locator('[data-desk-entry="articles"] a').click();
      await expect(page).toHaveURL(new RegExp(`thread=${thread}&focus=articles`));
      // 选中即关覆盖层(不自动打开下一条材料)。
      await expect(page.getByTestId('thread-materials-dialog')).toHaveCount(0);
      // 再进 Y(article-drafting:main,active 成员):URL 保留 thread。
      await page.getByRole('button', { name: /相关材料/ }).click();
      await page.locator('[data-desk-entry="article-drafting:main"] a').click();
      await expect(page).toHaveURL(new RegExp(`thread=${thread}&focus=article-drafting%3Amain`));
      // 「返回本线」客户端导航回概览,线保留(US01)。
      await page.getByRole('link', { name: '返回本线' }).click();
      await expect(page).toHaveURL(new RegExp(`thread=${thread}&focus=thread%3A${thread}`));
      // 浏览器后退:回到 Y 且 thread 不丢(US07;客户端导航历史)。
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`thread=${thread}&focus=article-drafting%3Amain`));
    });
  });

  test.fixme(
    'US07 clientView:X→Y→本线每步发送的 clientView.presence 与 URL 一致,历史回合当时上下文未知显式呈现' +
      '(等 P3:ChatTurn 投影 clientView/userContextKnown 与引用时点语义)',
    async () => {
      // P3.3/P3.4 落地后补:发送侧 clientView 由 URL 单一来源捕获(S3 §3 实测
      // 无漂移),历史侧按 principal×session×turn 精确 join、不回填。
    },
  );
});
