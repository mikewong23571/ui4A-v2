// T33 授权与注意力范畴分离 — 五景走查(spec/plan Phase 0 完成的定义锚)。
//
// 覆盖面说明(诚实边界):本文件跑在 local 自报身份剖面(e2e 统一装置),
// 其中 c/d 两景的判权语义需要多凭证环境,其可执行证据在 Phase B 已落地为
// route 级 vitest 锚点(与 plan 偏离已登记:不另造 e2e 多凭证装置,时间成本
// 不成比例):
//   c(授予外结构化 denied + 人话)→ apps/web/src/app/api/presentation/
//      route.production-auth.test.ts + engine/presentation/broker.test.ts
//      (denied reasonCode 分流锚)+ components/chat/presentation-words.test.ts
//      (人话词表锚)+ components/canvas/presentation-surface-host.test.tsx(denied 分支);
//   d(跨 principal 404 存在性隐藏)→ apps/web/src/app/api/presentation/
//      sidecar/route.production-auth.test.ts('keeps 404 existence hiding …')。
//
// D51 不变量对应:
//   a→#2(授予内零可见授权事件)/b→#1+#2 咽喉链全自动/
//   e→#4(镜头与焦点切换永不产生 denied)
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

interface PresentationReceipt {
  status?: unknown;
  sidecar?: { id?: unknown };
  surfaceUrl?: unknown;
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => test.setTimeout(180_000));

test('a. focus 直达:/canvas?focus=<rel> 无 sidecarId 时自动呈现且画布零错误', async ({ page }) => {
  await withFreshServer(async () => {
    await page.goto(`${SCENARIO_BASE}/canvas?focus=post%3Apost-welcome`);
    // 冷启动兜底:dev 首编 + 取数链,统一放宽窗口(与 b 景同口径)
    await expect(page.locator('[data-surface]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="canvas-errors"]')).toHaveCount(0);
    // 欢迎文章的身份词必须出现在画面上——不是空壳成功
    await expect(page.locator('[data-surface]')).toContainText('欢迎来到 UI4A');
  });
});

test('b. 咽喉链全自动:present→ready→sidecar 回放→画布可达', async ({ page }) => {
  await withFreshServer(async () => {
    const created = await fetch(`${SCENARIO_BASE}/api/presentation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: 't33:e2e:b',
        principal: 'local-user',
        subject: 'post:first-post',
        intent: 'read',
        delivery: 'canvas',
        sourceMessageIds: [],
      }),
    });
    expect(created.ok).toBe(true);
    const receipt = (await created.json()) as PresentationReceipt;
    expect(receipt.status).toBe('ready');
    expect(typeof receipt.sidecar?.id).toBe('string');
    const sidecarId = receipt.sidecar!.id as string;

    const replayed = await fetch(
      `${SCENARIO_BASE}/api/presentation/sidecar?sidecarId=${encodeURIComponent(sidecarId)}`,
    );
    expect(replayed.status).toBe(200);

    await page.goto(
      `${SCENARIO_BASE}/canvas?sidecar=${encodeURIComponent(sidecarId)}&focus=post%3Afirst-post`,
    );
    // 冷启动延迟兜底:dev 首编 + 取数链,5s 默认窗口不够(见 Phase 0 gate 记录)
    await expect(page.locator('[data-surface]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="canvas-errors"]')).toHaveCount(0);
  });
});

test('c. 授予外访问得到结构化 denied(证据锚点:Phase B vitest)', async () => {
  // 多凭证语义无法在本 local 剖面表达;route 级证据由 Phase B 新谓词测试承担,
  // 已落地(见文件头路径清单):present reasonCode 分流(broker.test)、
  // sidecar 403 结构化 denied(sidecar/route.production-auth.test)、人话词表。
  test.skip(true, '凭证域场景:证据锚点在 Phase B vitest(route.production-auth 系列)');
});

test('d. 他人 sidecar id 得 404(证据锚点:Phase B vitest)', async () => {
  // 跨 principal 存在性隐藏同样依赖真实双主体;占位理由同 c。已落地:
  // apps/web/src/app/api/presentation/sidecar/route.production-auth.test.ts
  // → 'keeps 404 existence hiding for another principal stored Sidecar id'。
  test.skip(true, '多主体场景:证据锚点在 Phase B vitest(sidecar route production-auth)');
});

test('e. 多主体切换零 denied:focus/present 在授予集合内连续变换不产生任何拒绝', async () => {
  await withFreshServer(async () => {
    for (const subject of [
      'articles',
      'flow:article-drafting',
      'workspace:my-work',
      'post:first-post',
      'post:post-welcome',
    ]) {
      const response = await fetch(`${SCENARIO_BASE}/api/presentation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          requestId: `t33:e2e:e:${subject}`,
          principal: 'local-user',
          subject,
          intent: 'read',
          delivery: 'canvas',
          sourceMessageIds: [],
        }),
      });
      expect(response.ok, `${subject} HTTP`).toBe(true);
      const receipt = (await response.json()) as PresentationReceipt;
      expect(receipt.status, `${subject} receipt`).not.toBe('failed');
      expect(['ready', 'fallback'], `${subject} terminal`).toContain(String(receipt.status));
    }
  });
});
