/**
 * 工作线扩展性与大工作集(T56 P4.1 常驻覆盖;G3 浏览器门禁;US11/FR10)。
 *
 * - **受治理出生的第二 application**(Fixture H):走真实 genesis 合同路径
 *   (meta/drafts create → submit → 人类 approve 激活;cli-meta-drafts.spec
 *   同一 HTTP 口径)装入一个 UI 零硬编码的新 app,bundle 内声明 entry flow
 *   (节点动作 transition)与 30 个长标题 seed 实例。
 * - **零 UI 改动呈现**:新 app 的 seed 实例挂入工作线后,成员卡身份/状态、
 *   对象面身份与声明动作(提交复核 → 节点迁移)全部经同一 generic 管线呈现
 *   与执行;全程 canvas-errors 为空。
 * - **读请求有界(Fixture I)**:30 成员的线概览页加载期间的 /api/entity 读
 *   次数显著小于成员数(成员身份来自线投影单次读,不逐成员取数),材料计数
 *   与覆盖层条目数与 HTTP membership 一致。
 */
import { expect, test, type Page } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

import { execAction, openThreadOverview, saveShot } from './work-thread-fixtures';

const LENS = 'publishing';
const MATERIAL_COUNT = 30;

/** 新 app 的 application-bundle:entry flow(起草 → 复核)+ 30 个长标题 seed 实例。 */
function extBundlePayload(name: string): Record<string, unknown> {
  const flowName = `${name}-intake`;
  const instances: Record<string, unknown> = {};
  for (let index = 1; index <= MATERIAL_COUNT; index += 1) {
    const rel = `${flowName}:unit-${String(index).padStart(2, '0')}`;
    instances[rel] = {
      rel,
      flow: flowName,
      node: 'draft',
      fields: {
        title: {
          value: `扩展登记样例 ${String(index).padStart(2, '0')}·跨应用评审证据链与产出归档的长标题材料`,
          origin: 'default',
        },
      },
    };
  }
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name, version: 1 },
    applications: [
      { name, title: 'T56 扩展登记', intent: 'T56 P4.1 US11: governed genesis, zero UI hardcode' },
    ],
    capabilities: [],
    flows: [
      {
        name: flowName,
        title: '扩展登记',
        app: name,
        initial: 'draft',
        nodes: [
          {
            name: 'draft',
            title: '起草',
            fields: [
              {
                name: 'title',
                type: 'text',
                required: true,
                semantics: 'intent',
                title: '登记标题',
                presentation: { role: 'identity' },
              },
            ],
            actions: [
              {
                name: 'submit-review',
                title: '提交复核',
                to: 'review',
                method: 'POST',
                guards: [],
                fields: [],
                effect: [{ type: 'transition', to: 'review' }],
              },
            ],
          },
          { name: 'review', title: '复核', fields: [], actions: [] },
        ],
        fields: [],
      },
    ],
    seed: { rel: `seed:${name}`, detail: { instances } },
  };
}

async function metaExec(
  page: Page,
  rel: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.request.post(`${SCENARIO_BASE}/_meta/api/exec?scope=${LENS}`, {
    data: { rel, action, actor: 'human', principal: 'local-user', channel: 'e2e', params },
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe.configure({ mode: 'serial' });

test.describe('work-thread extensibility', () => {
  test('US11 第二应用零 UI 改动呈现 + 30 材料大工作集读取有界', async ({ page }) => {
    test.setTimeout(420_000);
    await withFreshServer(async () => {
      const appName = `t56ext${Math.random().toString(36).slice(2, 8)}`;
      const flowRel = `flow:${appName}-intake`;

      // 1) 受治理出生(H):create(合法 payload → ready)→ submit → 人类 approve。
      // 反向前置:批准前业务 sitemap 不含新 flow 入口(发现只来自批准)。
      const sitemapBefore = await page.request.get(`${SCENARIO_BASE}/.well-known/ui4a.json`);
      const surfacesBefore = (
        (await sitemapBefore.json()) as { surfaces: { rel: string }[] }
      ).surfaces.map((surface) => surface.rel);
      expect(surfacesBefore).not.toContain(flowRel);

      const created = await metaExec(page, 'meta/drafts', 'create', {
        kind: 'application-bundle',
        target: appName,
        payload: extBundlePayload(appName),
        commandId: `e2e:${appName}:create`,
      });
      expect(created.status).toBe(200);
      const draft = (created.body as { entity?: { properties?: { rel?: string } } }).entity;
      expect(draft?.properties?.rel).toMatch(/^draft:/);
      const draftRel = draft!.properties!.rel!;

      const submitted = await metaExec(page, draftRel, 'submit', {
        commandId: `e2e:${appName}:submit`,
      });
      expect(submitted.status).toBe(200);
      const activation = (submitted.body as { entity?: { properties?: { activation?: string } } })
        .entity?.properties?.activation;
      expect(activation).toMatch(/^meta\/activation:draft-/);

      const approved = await metaExec(page, activation!, 'approve', {
        commandId: `e2e:${appName}:approve`,
      });
      expect(approved.status).toBe(200);

      // 批准即发现:业务 sitemap 出现新 flow 入口(契约面,非 UI 硬编码)。
      const sitemapAfter = await page.request.get(`${SCENARIO_BASE}/.well-known/ui4a.json`);
      const surfacesAfter = (
        (await sitemapAfter.json()) as { surfaces: { rel: string }[] }
      ).surfaces.map((surface) => surface.rel);
      expect(surfacesAfter).toContain(flowRel);

      // 2) 30 材料大工作集(I):全部 seed 实例挂入一条线。
      const thread = `t56big${Math.random().toString(36).slice(2, 8)}`;
      await execAction(page, 'threads', 'create', {
        id: thread,
        goal: '大工作集读取有界走查',
        goalSource: `e2e:${thread}`,
      });
      const unitRels = Object.keys(
        (extBundlePayload(appName).seed as { detail: { instances: Record<string, unknown> } })
          .detail.instances,
      );
      for (const rel of unitRels) {
        await execAction(page, `thread:${thread}`, 'attach', { category: 'context', rel });
      }

      // 3) 概览呈现 + 读有界:成员身份来自线投影单次读;/api/entity 读次数
      //    显著小于成员数(有界,不随工作集线性增长)。
      const entityReads: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/entity')) entityReads.push(request.url());
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openThreadOverview(page, thread);
      await expect(page.getByRole('button', { name: /相关材料（30）/ })).toBeVisible();
      // 本线成员全部无声明动作 → generic 规划选 entity-link 词(导航卡)。
      await expect(page.locator('[data-word="entity-link"]')).toHaveCount(MATERIAL_COUNT);
      // 长标题身份可读(声明字段直出,零特判)。
      await expect(page.locator('main')).toContainText('扩展登记样例 07·');
      expect(
        entityReads.length,
        `/api/entity 读次数(${entityReads.length})应小于成员数`,
      ).toBeLessThan(MATERIAL_COUNT);
      console.log(
        `[US11] 30 成员概览页 /api/entity 读次数=${entityReads.length}(< ${MATERIAL_COUNT})`,
      );

      await page.getByRole('button', { name: /相关材料/ }).click();
      const dialog = page.getByTestId('thread-materials-dialog');
      await expect(page.getByTestId('desk-working-set-count')).toHaveText('工作集（30）');
      expect(dialog.locator('[data-desk-entry]')).toHaveCount(MATERIAL_COUNT);
      await saveShot(page, 'p4-us11-ext-app-bigset');

      // 4) 新 app 实例的对象面:同一 generic 管线呈现声明动作并可执行(零 UI 改动)。
      const firstUnit = `${appName}-intake:unit-01`;
      await page.goto(
        `${SCENARIO_BASE}/canvas?thread=${thread}&focus=${encodeURIComponent(firstUnit)}`,
      );
      await expect(page.locator('[data-surface]').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('main')).toContainText('扩展登记样例 01·');
      await expect(page.getByTestId('canvas-errors')).toHaveCount(0);
      await page
        .locator(
          '[data-action-group-item="submit-review"] button[data-presentation-action="open-form"]',
        )
        .click();
      await page.getByRole('textbox', { name: /登记标题/ }).fill('扩展登记样例 01(浏览器提交)');
      await page
        .locator(
          '[data-action-group-item="submit-review"] form button[data-action="submit-review"]',
        )
        .click();
      // 节点迁移生效(起草 → 复核):回到概览,成员卡状态指针逐字更新
      // (身份行取声明 title,以 href 锚定成员 rel)。
      await page.getByRole('link', { name: '返回本线' }).click();
      await expect(page.locator('[data-word="entity-link"][href*="unit-01"]')).toContainText(
        'review',
        { timeout: 15_000 },
      );
      await expect(page.getByTestId('canvas-errors')).toHaveCount(0);
    });
  });
});
