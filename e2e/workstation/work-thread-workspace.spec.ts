/**
 * T56 工作线工作台常驻 E2E(G3;acceptance §2 US01/US05/US07、design §1 几何契约、
 * DECISIONS D78 实测断点)。期望值基线 = `conductor/tracks/
 * t56-work-thread-workspace_20260905/probes/s3-layout-session.md` §1/§2 实测表。
 *
 * P2.1 Red 阶段骨架:实现未落地(P2.2 壳重构)前无法通过的用例一律 `test.fixme`
 * 并注明等 P2.2(不跑浏览器,只要求被 Playwright 收录、TS/lint 干净);现状应绿
 * 且必须保持的用例写成活跃 test。fixture 走规范 `/api/exec` create/attach
 * (acceptance §1 A 线;每次运行唯一前缀 `t56-<runId>`,隔离库由 server-kit 保证)。
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

async function measureGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const box = (el: Element): DOMRect => el.getBoundingClientRect();
    const main = document.querySelector('main');
    const aside = [...document.querySelectorAll('aside')].find((el) =>
      (el.textContent ?? '').includes('UI4A 助手'),
    );
    const mainRect = main === null ? null : box(main);
    const asideRect = aside === null ? null : box(aside);
    return {
      vw: window.innerWidth,
      mainWidth: Math.round(mainRect?.width ?? 0),
      assistantWidth: Math.round(asideRect?.width ?? 0),
      sideBySide:
        mainRect !== null &&
        asideRect !== null &&
        mainRect.width > 0 &&
        asideRect.width > 0 &&
        mainRect.right <= asideRect.left + 1,
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
      assistantLeft: Math.round(asideRect?.left ?? 0),
      assistantRight: Math.round(asideRect?.right ?? 0),
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

  test.fixme('US01 深链进入本线:目标/生命周期/当前可见责任为主内容,非说明书+应用书架(等 P2.2 去 noGaze 旁路)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
      const main = page.locator('main');
      // 目标完整可读 + 唯一 H1(线身份/目标,D78/design §1)+ 生命周期状态。
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

  test.fixme('US01 thread=T 无显式 focus:落本线概览而非默认对象注视(等 P2.2)', async ({ page }) => {
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

  test.fixme('US05 五视口×助手开/关:默认无永久材料栏、主区≥640 且≥两栏净宽 60%、无 body 横滚(D78 阈值 1072/1008,按剩余宽度判断;等 P2.2)', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      for (const viewport of D78_VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
        // 默认无永久材料栏(FR4/D78 决定 1;现状书桌常驻栏 → Red)。
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

  test.fixme('US05 390px 覆盖助手不超出屏幕 + Escape 可关 + 关闭后焦点恢复(design §1;等 P2.2)', async ({
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
      // 覆盖助手整体在视口内(现状 float 左缘 −10 / 停靠横滚 → Red)。
      const geometry = await measureGeometry(page);
      expect(geometry.assistantLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.assistantRight).toBeLessThanOrEqual(geometry.vw);
      expect(geometry.hscroll).toBe(false);
      // Escape 关闭 + 焦点恢复到唤起元素(现状无 keydown 处理/无恢复 → Red)。
      await page.keyboard.press('Escape');
      await expect(page.locator('aside', { hasText: 'UI4A 助手' })).toHaveCount(0);
      await expect(fab).toBeFocused();
    });
  });

  test.fixme('US05 200% 缩放(布局视口 960 CSS px):助手必须覆盖/单面,不得并排(D78;等 P2.2)', async ({
    page,
  }) => {
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

  test.fixme('US07 材料 X→Y→返回本线→后退:URL/常显/clientView 指向一致,线与 scope 保留(等 P2.2 客户端导航+材料入口;clientView 断言随 P3 ChatTurn 投影)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await withFreshServer(async () => {
      const thread = runId();
      await createThreadFixture(page, thread);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SCENARIO_BASE}/canvas?thread=${thread}&focus=thread%3A${thread}`);
      // 打开「相关材料」入口(FR4;等 P2.2)进入材料 X,再 Y:
      // 每步 URL 保留 thread(+scope),常显「当前对象」与 URL 一致;
      // 点「返回本线」回概览;浏览器后退回到 Y 且 thread/scope 不丢(US07)。
      // 书桌条目裸 <a> 硬导航(丢草稿根因)由组件 Red
      // thread-desk-navigation.test.tsx 钉住,P2.2 改 Link 后本用例转活跃。
    });
  });
});
