/**
 * T7 Phase C / Task 3 — I3 交互必背书 E2E(GOAL I3 / T7 spec 验收 4)。
 *
 * GOAL 原文:「fuzz 所有可点元素:提交必映射到已声明 action,合同外按钮
 * 无法提交」。两层断言:
 *
 * 1) fuzz:枚举七个页面(首页/事件流/收件箱/实体页/BIOS 激活页/画布/舰队页)
 *    DOM 所有可点元素(button/a/[role=button])→ 每个必有 data-action
 *    (已声明动作)或 data-nav(合同导航/本地视图控件)或属展示类白名单。
 *    白名单口径:react-chrono(timeline 词条)内部控件——时间轴点位等
 *    纯展示组件自带的交互原语,无合同语义(不产生任何提交;词条实现
 *    见 apps/web/src/render/words/timeline.tsx 头注,toolbar 缺省关闭);
 *    Next dev overlay 在 nextjs-portal 影子 DOM 内,document 枚举不可见,
 *    且非应用树产物。每页断言 ≥1 可点元素(防空泛通过)。
 *
 * 2) 未声明按钮拒提交——口径:渲染层不产生合同外提交。直接 fetch 的注入
 *    按钮天然绕过渲染层(不属于本断言);可测口径是 React 树内合成路径:
 *    a. 在 React 渲染的容器(main)内注入未声明按钮,以冒泡合成事件点击
 *       (React 19 事件委托挂在根容器,经 delegation 派发)→ 监听网络,
 *       零 /api/exec 调用——渲染层不存在任何"环境级"提交通道,提交只可能
 *       发生在显式接线的已声明动作处理器上(ActionRunner data-action /
 *       画布 action 拦截门白名单,单测见 action-gate.test.ts);
 *    b. 正控制:点击已声明的 data-action 按钮(unpublish)→ 恰好一次
 *       /api/exec(已声明提交确实发生,裁决层裁决);
 *    c. 再次合成点击未声明按钮 → 仍恰好一次(不随注入增加)。
 */
import { expect, test, type Page } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './server-kit';

/** fuzz 页面清单(骨架五面 + 实体页;GOAL I3「所有页面」的本站全集)。 */
const PAGES: { name: string; path: string; ready: string }[] = [
  { name: '首页', path: '/', ready: '[data-testid="situation"]' },
  { name: '事件流', path: '/events', ready: '[data-word="timeline"], [data-testid="empty-events"]' },
  { name: '收件箱', path: '/entity?rel=inbox', ready: 'a[data-nav="home"]' },
  { name: '实体页(已发布文章,含动作)', path: '/entity?rel=post:post-welcome', ready: '[data-action]' },
  { name: 'BIOS 激活页', path: '/meta/activations', ready: 'a[data-nav="meta-back"]' },
  { name: '画布', path: '/canvas', ready: '[data-surface]' },
  { name: '舰队页', path: '/delegations', ready: '[data-testid="empty-fleet"], table' },
];

/** 单个可点元素的探针结果(page.evaluate 载荷形状)。 */
interface ClickableProbe {
  tag: string;
  text: string;
  action: string | null;
  nav: string | null;
  whitelisted: boolean;
}

/** 枚举 DOM 全部可点元素与标注(I3 白名单:timeline 词条内部控件)。 */
async function probeClickables(page: Page): Promise<ClickableProbe[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button, a, [role="button"]')).map((element) => ({
      tag: element.tagName.toLowerCase(),
      text: (element.textContent ?? '').trim().slice(0, 32),
      action: element.getAttribute('data-action'),
      nav: element.getAttribute('data-nav'),
      // react-chrono(timeline 词条)内部控件:纯展示组件的交互原语,无合同语义。
      whitelisted: element.closest('[data-word="timeline"]') !== null,
    })),
  );
}

/** 在 React 渲染容器内注入未声明按钮并以冒泡合成事件点击(React 树内路径)。 */
async function syntheticClickUndeclared(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector('main');
    if (host === null) throw new Error('main 容器不存在(React 树未渲染)');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '未声明按钮(注入)';
    host.appendChild(button);
    // 原生点击 + 手工冒泡合成事件双发:两者都经 React 根容器的事件委托,
    // 无已声明动作处理器接线 → 必须零提交。
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** /api/exec 请求计数器(网络监听;渲染层合同外提交的观测口径)。 */
function execCounter(page: Page): { count(): number } {
  let calls = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/exec')) calls += 1;
  });
  return { count: () => calls };
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  test.setTimeout(180_000);
});

test('I3 fuzz:全部页面所有可点元素必映射 data-action/data-nav(白名单:chrono 展示控件)', async ({ page }) => {
  await withFreshServer(async () => {
    for (const target of PAGES) {
      await page.goto(`${SCENARIO_BASE}${target.path}`);
      await page.waitForSelector(target.ready, { timeout: 30_000 });
      const clickables = await probeClickables(page);
      // 空泛防护:每页至少一个可点元素(否则 fuzz 无意义)。
      expect(
        clickables.length,
        `${target.name}(${target.path})应存在可点元素(fuzz 非空泛)`,
      ).toBeGreaterThan(0);
      const offenders = clickables.filter(
        (element) => element.action === null && element.nav === null && !element.whitelisted,
      );
      expect(
        offenders,
        `${target.name}(${target.path})存在未背书可点元素:\n${offenders
          .map((element) => `  <${element.tag}> "${element.text}"`)
          .join('\n')}`,
      ).toEqual([]);
    }
  });
});

test('I3 拒提交:React 树内合成点击未声明按钮 → 零 /api/exec;已声明按钮恰好一次(正控制)', async ({ page }) => {
  await withFreshServer(async () => {
    const exec = execCounter(page);

    // 实体页(已发布文章,声明 unpublish/archive 动作)。
    await page.goto(`${SCENARIO_BASE}/entity?rel=post:post-welcome`);
    await page.waitForSelector('[data-action]', { timeout: 30_000 });

    // a. 合成点击未声明按钮(React 树内,事件委托路径)→ 零提交。
    await syntheticClickUndeclared(page);
    await page.waitForTimeout(500);
    expect(exec.count(), '未声明按钮的合成点击不得产生 /api/exec 调用').toBe(0);

    // b. 正控制:点击已声明 data-action=unpublish → 恰好一次提交(裁决层裁决)。
    await page.click('[data-action="unpublish"]');
    await expect
      .poll(() => exec.count(), { timeout: 15_000 })
      .toBe(1);
    // 执行结果如实呈现(成功后实体刷新为 offline 视图)。
    await expect(page.locator('main')).toContainText('已下线', { timeout: 15_000 });

    // c. 再次合成点击未声明按钮 → 仍是恰好一次(不随注入增加)。
    await syntheticClickUndeclared(page);
    await page.waitForTimeout(500);
    expect(exec.count()).toBe(1);

    // 画布面同样成立:A2UI surface 宿主内合成点击 → 零提交
    //(画布提交唯一通道 = action 拦截门白名单,单测覆盖;此处 e2e 级复核)。
    await page.goto(`${SCENARIO_BASE}/canvas`);
    await page.waitForSelector('[data-surface]', { timeout: 30_000 });
    const canvasExec = execCounter(page);
    await syntheticClickUndeclared(page);
    await page.waitForTimeout(500);
    expect(canvasExec.count(), '画布内未声明按钮的合成点击不得产生 /api/exec 调用').toBe(0);
  });
});
