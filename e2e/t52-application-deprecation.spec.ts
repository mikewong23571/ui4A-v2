/**
 * T52 Phase 4 — application deprecation 全景验收走查(spec §7;镜像 t48/t51 模式)。
 *
 * 人类在浏览器走完一个测试应用的完整生命周期:
 * 1. 出生:/meta 走合同 genesis(t48 模式:先 invalid 留痕 → revise 合法 → submit →
 *    激活实体两步确认 approve);bundle 带可写数据的 flow(向导 + 实例集合);
 * 2. 写数据:经新应用的 flow 入口(`flow:<name>-entry` 别名)写一条业务数据;
 * 3. 三门同门:agent 提交被引擎拒(I4,guard-failed actor-is-human);default 地板
 *    拒绝留痕(application-not-default)+ 实体页按钮 disabled;
 * 4. 停用:meta/applications 集合进入实体页 → deprecate 两步确认(reason 表单);
 * 5. 全收缩断言(US3/US5):meta/业务两面实体 404、flow 别名 404、sitemap 收缩、
 *    授予全集与「我的授权」面板收缩、反向锚(publishing)不受影响;
 * 6. 名字烧毁(US4):已停用名再建 application-bundle Draft,create 门即时拒绝
 *    留痕(审计集随停用 exec 即时物化进在线快照);
 * 7. 重放一致(I5/US2):/api/events 读回伴随事件对(action-executed +
 *    application-deprecated)序连续、detail 形状(name/reason/commandId)。
 *
 * 身份:local demo 自报域(actor=human、principal=local-user、channel=bios);
 * agent 同门以 body 显式 actor=agent 走同一 /_meta/api/exec。数据:共享测试库,
 * bundle 名随机后缀防冲突。
 *
 * 停用回执与烧毁集口径(T52 终验修复后的事实):
 * - 停用成功回执为 HTTP 200,回执实体 = 收缩后的 meta/applications 集合投影
 *   (D71.3:停用即离场,目标实体存在性隐藏——受影响面是集合,不是目标实体)。
 * - deprecatedApplications 审计集随停用 exec 即时物化进在线快照(选择性补折),
 *   同进程内烧毁名 create 即时 fail-closed;激活门(log 口径)语义由
 *   service.application-deprecation/name-burn 单测与 invariants 扩展覆盖。
 * - [口径 C] 停用应用的存量实例 rel 在 local demo(自报域)下仍 200 可读
 *   (受众层 assertReachable 仅 credential 模式执行;实例按 D71.4 保留)。走查
 *   脚本预期的「实例 rel 404」为 credential 模式语义(P3b 合同测试钉 403/授予内
 *   200),local 浏览器门停止该断言,如实记录。
 */
import { expect, test, type Page } from '@playwright/test';

const LENS = 'publishing';

/** 业务事件行(/api/events)。 */
interface LoggedEvent {
  seq: number;
  domain?: string;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * 合法最小可写 bundle(t48 fixture 扩展:向导 flow 带 add 动作,append 产出
 * `<name>-item` 实例并归入 `<name>-items` 集合;seed 物化向导唯一实例,使
 * `flow:<name>-entry` 具备向导别名语义)。全新名。
 */
function bundlePayloadJson(name: string, title: string): string {
  return JSON.stringify(
    {
      schema: 'https://ui4a.dev/application-bundle/v1',
      bundle: { name, version: 1 },
      applications: [
        { name, title, intent: 'T52 deprecation walkthrough: governed birth, data, death' },
      ],
      capabilities: [],
      flows: [
        {
          name: `${name}-entry`,
          title: 'Walkthrough entry',
          app: name,
          initial: 'start',
          fields: [],
          nodes: [
            {
              name: 'start',
              title: 'Start',
              fields: [
                {
                  name: 'title',
                  type: 'text',
                  required: true,
                  semantics: 'intent',
                  title: '记录标题',
                },
              ],
              actions: [
                {
                  name: 'add',
                  title: 'Add record',
                  to: 'recorded',
                  guards: [],
                  fields: [],
                  effect: [
                    { type: 'transition', to: 'recorded' },
                    {
                      type: 'append',
                      collection: `${name}-items`,
                      'resource-type': `${name}-item`,
                      flow: `${name}-item`,
                      'name-from': 'title',
                      node: 'open',
                    },
                  ],
                },
              ],
            },
            { name: 'recorded', title: 'Recorded', fields: [], actions: [] },
          ],
        },
        {
          name: `${name}-item`,
          title: 'Walkthrough item',
          app: name,
          initial: 'open',
          fields: [{ name: 'title', type: 'text', semantics: 'intent', title: '记录标题' }],
          collections: [{ collection: `${name}-items`, title: 'Walkthrough items' }],
          nodes: [{ name: 'open', title: 'Open', fields: [], actions: [] }],
        },
      ],
      seed: {
        rel: `seed:${name}`,
        detail: {
          instances: {
            [`${name}-entry:main`]: {
              rel: `${name}-entry:main`,
              flow: `${name}-entry`,
              node: 'start',
              fields: {},
            },
          },
        },
      },
    },
    null,
    2,
  );
}

/** 缺字段 payload:schema 词不对 → parse-error issue(拒绝留痕起手,t48 同形)。 */
const INVALID_PAYLOAD_JSON = JSON.stringify(
  { schema: 'https://example.com/not-a-bundle' },
  null,
  2,
);

async function getJson(
  page: Page,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.request.get(path);
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

async function installedApplicationNames(page: Page): Promise<string[]> {
  const { status, body } = await getJson(page, '/_meta/api/entity?rel=meta%2Fapplications');
  expect(status, 'meta/applications 应为 200').toBe(200);
  const entities = (body.entities ?? []) as { properties?: { name?: unknown } }[];
  return entities.map((member) => String(member.properties?.name ?? ''));
}

/** 业务 sitemap 的 surface rel 与 flows 清单。 */
async function businessSitemap(page: Page): Promise<{ surfaces: string[]; flows: string[] }> {
  const { status, body } = await getJson(page, '/.well-known/ui4a.json');
  expect(status).toBe(200);
  return {
    surfaces: ((body.surfaces ?? []) as { rel: string }[]).map((surface) => surface.rel),
    flows: ((body.flows ?? []) as { name: string }[]).map((flow) => flow.name),
  };
}

async function getEvents(page: Page): Promise<LoggedEvent[]> {
  // /api/events 单页上限 100(合同);本走查事件超百条,按 afterSeq 翻页读全。
  const events: LoggedEvent[] = [];
  let afterSeq = 0;
  for (;;) {
    const { status, body } = await getJson(page, `/api/events?afterSeq=${afterSeq}`);
    expect(status).toBe(200);
    const page_ = (body.events ?? []) as LoggedEvent[];
    events.push(...page_);
    if (page_.length < 100) return events;
    afterSeq = page_[page_.length - 1]!.seq;
  }
}

/** 轮询事件日志直至目标事件出现(伴随事件对留痕的等待口径)。 */
async function waitForEvent(
  page: Page,
  match: (event: LoggedEvent) => boolean,
  timeoutMs = 20_000,
): Promise<LoggedEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await getEvents(page)).find(match);
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error('等待事件留痕超时(停用是否真的执行?)');
    await page.waitForTimeout(500);
  }
}

/** meta exec(浏览器人通道:自报域 actor=human;agent 同门由 body 显式覆盖)。 */
async function execMeta(
  page: Page,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.request.post(`/_meta/api/exec?scope=${LENS}`, {
    data: body,
    headers: { 'content-type': 'application/json' },
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test('golden path: 出生→写数据→三门同门→停用→全收缩→烧毁→事件对', async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = Math.random().toString(36).slice(2, 8);
  const bundleName = `t52-walkthrough-${suffix}`;
  const appTitle = `T52 Deprecation ${suffix}`;
  const entryFlowRel = `flow:${bundleName}-entry`;
  const itemFlowRel = `flow:${bundleName}-item`;
  const recordTitle = `t52 record ${suffix}`;
  const itemRel = `${bundleName}-item:t52-record-${suffix}`;
  const collectionRel = `${bundleName}-items`;
  const reason = `T52 walkthrough cleanup ${suffix}`;

  await test.step('出生(反向前置):/meta 走合同 genesis,invalid 留痕 → revise → submit', async () => {
    expect(await installedApplicationNames(page)).not.toContain(bundleName);
    await page.goto(`/meta?scope=${LENS}`);
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('link', { name: '打开 受治理草稿' }).click();
    await expect(page).toHaveURL(new RegExp(`rel=meta%2Fdrafts.*scope=${LENS}`));
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });

    // 集合动作 Create Draft:kind=application-bundle + 缺字段 payload(拒绝留痕起手)
    await page.getByRole('button', { name: 'Create Draft' }).click();
    const form = page.locator('div[data-action="create"]');
    await expect(form).toBeVisible();
    await form
      .getByRole('combobox', { name: /kind/ })
      .selectOption({ label: 'application-bundle' });
    await form.getByRole('textbox', { name: /target/ }).fill(bundleName);
    await form.getByRole('textbox', { name: /payload/ }).fill(INVALID_PAYLOAD_JSON);
    await form.locator('button[type="submit"]').click();
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });
    const member = page.locator('a[data-nav="meta:collection-member"]', { hasText: bundleName });
    await expect(member).toBeVisible({ timeout: 15_000 });
    await member.click();
    await expect(page).toHaveURL(/rel=draft%3A/);

    // Draft 详情:invalid 留痕(parse-error + checks FAIL)→ revise 修正为 ready
    const header = page.getByRole('main').locator('header').first();
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: bundleName, level: 1 })).toBeVisible();
    await expect(header).toContainText('invalid');
    await expect(page.getByText('parse-error').first()).toBeVisible();
    const checks = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Checks' }) });
    await expect(checks).toContainText('FAIL');

    await page.getByRole('button', { name: 'Revise Draft' }).click();
    const reviseForm = page.locator('div[data-action="revise"]');
    await expect(reviseForm).toBeVisible();
    await reviseForm
      .getByRole('textbox', { name: /payload/ })
      .fill(bundlePayloadJson(bundleName, appTitle));
    await reviseForm.locator('button[type="submit"]').click();
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });
    await expect(header).toContainText('ready', { timeout: 15_000 });

    // submit → pending-approval
    await page.locator('button[data-action="submit"]').click();
    await expect(header).toContainText('pending-approval', { timeout: 15_000 });
    await expect(page.getByText('Human-only decision')).toBeVisible();
  });

  let installedCount = 0;
  await test.step('激活:两步确认 approve → 应用出生、flow 入口进 sitemap', async () => {
    const draftRel = new URL(page.url()).searchParams.get('rel')!;
    const draftId = draftRel.slice('draft:'.length);
    // 反向断言:approve 之前新名未出生
    expect(await installedApplicationNames(page)).not.toContain(bundleName);
    expect((await businessSitemap(page)).surfaces).not.toContain(entryFlowRel);

    await page.goto(
      `/meta/entity?rel=${encodeURIComponent(`meta/activation:draft-${draftId}`)}&scope=${LENS}`,
    );
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('region', { name: '人类责任点' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已请求' })).toBeVisible();
    await page.getByRole('button', { name: '确认并执行Approve' }).click();
    await expect(page.getByRole('status', { name: '执行结果' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

    // 出生完成:集合含新 app(记录基数),业务 sitemap 含新 flow 入口
    const names = await installedApplicationNames(page);
    expect(names).toContain(bundleName);
    installedCount = names.length;
    const sitemap = await businessSitemap(page);
    expect(sitemap.surfaces).toContain(entryFlowRel);
    expect(sitemap.flows).toContain(`${bundleName}-entry`);
  });

  await test.step('写数据:经 flow 入口向导写一条业务数据(实例在场)', async () => {
    // 浏览器直达 flow 入口别名页:向导实例面渲染,add 动作声明可达
    await page.goto(`/entity?rel=${encodeURIComponent(entryFlowRel)}`);
    await expect(
      page.locator('[data-action-group-item="add"] button[data-presentation-action="open-form"]'),
    ).toBeVisible({ timeout: 60_000 });

    // 人类走表单写数据(flow 入口别名 → 向导实例 → append 产出业务实例);
    // 执行成功后实体面刷新为向导新状态(identity = 写入的标题、节点 Recorded)
    await page
      .locator('[data-action-group-item="add"] button[data-presentation-action="open-form"]')
      .click();
    await page.getByRole('textbox', { name: /记录标题/ }).fill(recordTitle);
    await page.locator('form button[data-action="add"]').click();
    await expect(page.getByRole('heading', { name: recordTitle, level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator('section[aria-label="属性"] tbody tr', { hasText: 'Recorded' }),
    ).toBeVisible({ timeout: 15_000 });

    // 实例在场:实例 rel 可读,集合成员含新实例
    const instance = await getJson(page, `/api/entity?rel=${encodeURIComponent(itemRel)}`);
    expect(instance.status, '写数据后业务实例应在场').toBe(200);
    const collection = await getJson(page, `/api/entity?rel=${encodeURIComponent(collectionRel)}`);
    expect(collection.status).toBe(200);
    const members = ((collection.body.entities ?? []) as { properties?: { rel?: unknown } }[]).map(
      (entry) => String(entry.properties?.rel ?? ''),
    );
    expect(members, '集合应含新写的业务实例').toContain(itemRel);
  });

  await test.step('agent 同门(US1/I4):body 显式 actor=agent → 引擎拒并留痕', async () => {
    const rejected = await execMeta(page, {
      rel: `meta/application:${bundleName}`,
      action: 'deprecate',
      actor: 'agent',
      principal: 'user:t52-agent',
      channel: 'e2e',
      params: { reason: 'agent attempt' },
    });
    expect(rejected.status, 'agent deprecate 应被引擎拒(422)').toBe(422);
    expect(rejected.body.layer).toBe('guard-failed');
    expect(String(rejected.body.reason)).toContain('actor-is-human');

    // 拒绝留痕(I6):action-rejected 带同一理由;应用仍在场(拒绝不改状态)
    const events = await getEvents(page);
    const trace = events.find(
      (event) =>
        event.kind === 'action-rejected' &&
        event.rel === `meta/application:${bundleName}` &&
        event.action === 'deprecate',
    );
    expect(trace, 'agent 拒绝应留痕 action-rejected').toBeDefined();
    expect(trace).toMatchObject({ actor: 'agent', principal: 'user:t52-agent' });
    expect(String(trace!.reason)).toContain('actor-is-human');
    expect(await installedApplicationNames(page)).toContain(bundleName);
  });

  await test.step('default 地板(D71.6):guard 拒绝留痕 + 实体页按钮 disabled', async () => {
    const rejected = await execMeta(page, {
      rel: 'meta/application:default',
      action: 'deprecate',
      params: { reason: 'floor probe' },
    });
    expect(rejected.status, 'default deprecate 应被 guard 拒(422)').toBe(422);
    expect(rejected.body.layer).toBe('guard-failed');
    expect(String(rejected.body.reason)).toContain('application-not-default');

    const events = await getEvents(page);
    expect(
      events.find(
        (event) =>
          event.kind === 'action-rejected' &&
          event.rel === 'meta/application:default' &&
          event.action === 'deprecate' &&
          event.reason?.includes('application-not-default'),
      ),
      'default 地板拒绝应留痕',
    ).toBeDefined();

    // 实体页投影:按钮 disabled + 人话 hint(同源 guard-results)
    await page.goto(
      `/meta/entity?rel=${encodeURIComponent('meta/application:default')}&scope=${LENS}`,
    );
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    const floor = page.getByRole('button', { name: '停用', exact: true });
    await expect(floor).toBeVisible();
    await expect(floor).toBeDisabled();
    await expect(floor).toHaveAttribute('title', /默认应用不可停用/);
  });

  await test.step('停用:集合进入实体页 → reason 表单 + high 两步确认 → 执行', async () => {
    // 从 meta/applications 集合导航进入(walkthrough 路径,非直连 URL)
    await page.goto(`/meta/entity?rel=meta%2Fapplications&scope=${LENS}`);
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    const member = page.locator('a[data-nav="meta:collection-member"]', { hasText: appTitle });
    await expect(member).toBeVisible({ timeout: 15_000 });
    await member.click();
    await expect(page).toHaveURL(new RegExp(`rel=meta%2Fapplication%3A${bundleName}`));
    await expect(page.getByTestId('meta-content-ready')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: appTitle, level: 1 })).toBeVisible();

    // canonical 动作面:deprecate 按钮出现且可用(非 default,人类渲染器解除 disabled)
    await expect(page.getByRole('heading', { name: '可用动作' })).toBeVisible();
    const deprecate = page.getByRole('button', { name: '停用', exact: true });
    await expect(deprecate).toBeVisible();
    await expect(deprecate).toBeEnabled();

    // reason 表单 + high 两步确认:先显式请求(尚未执行),再确认执行
    await deprecate.click();
    const form = page.locator('div[data-action="deprecate"]');
    await expect(form).toBeVisible();
    await form.getByRole('textbox', { name: /^reason/i }).fill(reason);
    await form.locator('button[type="submit"]').click();
    await expect(page.getByRole('status').filter({ hasText: '尚未执行' })).toBeVisible();

    // 成功回执(D71.3):停用即离场,受影响面是集合——HTTP 200 + 回执实体 =
    // 收缩后的 meta/applications 集合投影(成员不含停用名)。两步确认的第二步
    // 是唯一 POST(action-runner 客户端门,第一步「尚未执行」不发请求)。
    const execDone = page.waitForResponse(
      (response) =>
        response.url().includes('/_meta/api/exec') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '确认并执行停用' }).click();
    const response = await execDone;
    expect(response.status(), '停用成功回执应为 200').toBe(200);
    const receipt = (await response.json()) as {
      entity?: { class?: string[]; entities?: { properties?: { name?: unknown } }[] };
    };
    expect(receipt.entity?.class, '回执实体应为 meta/applications 集合').toContain(
      'meta/applications',
    );
    const receiptMembers = (receipt.entity?.entities ?? []).map((member) =>
      String(member.properties?.name ?? ''),
    );
    expect(receiptMembers, '集合成员不含停用应用').not.toContain(bundleName);

    // 伴随事件对留痕:铸造口径(actor/principal/channel)。
    const deprecated = await waitForEvent(
      page,
      (event) =>
        event.kind === 'application-deprecated' && event.rel === `meta/application:${bundleName}`,
    );
    expect(deprecated).toMatchObject({ actor: 'human', principal: 'local-user', channel: 'bios' });
  });

  await test.step('全收缩(US3/US5):实体/集合/别名/sitemap/授予/面板,反向锚不受影响', async () => {
    // meta 集合不含该应用;计数回到出生前基数
    const names = await installedApplicationNames(page);
    expect(names, '停用应用应退出 meta/applications 集合').not.toContain(bundleName);
    expect(names.length, '集合计数应回到出生前基数').toBe(installedCount - 1);
    expect(names, '反向锚:publishing 不受影响').toContain('publishing');

    // 两面实体存在性隐藏(404,与「从未安装」同形)
    const metaEntity = await getJson(
      page,
      `/_meta/api/entity?rel=${encodeURIComponent(`meta/application:${bundleName}`)}`,
    );
    expect(metaEntity.status, 'meta/application:<name> 应 404(存在性隐藏)').toBe(404);
    const businessEntity = await getJson(
      page,
      `/api/entity?rel=${encodeURIComponent(`application:${bundleName}`)}`,
    );
    expect(businessEntity.status, 'application:<name> 应 404(存在性隐藏)').toBe(404);

    // flow 面整体不可达:入口别名与实例集合(flow:<name>)均 404
    for (const rel of [entryFlowRel, itemFlowRel]) {
      const flow = await getJson(page, `/api/entity?rel=${encodeURIComponent(rel)}`);
      expect(flow.status, `${rel} 应 404(置废 flow 别名/集合收缩)`).toBe(404);
    }

    // 业务 sitemap:surface 与扁平 flows 都不含该应用入口
    const sitemap = await businessSitemap(page);
    expect(sitemap.surfaces).not.toContain(entryFlowRel);
    expect(sitemap.flows).not.toContain(`${bundleName}-entry`);
    // 反向锚:publishing 的入口仍在
    expect(sitemap.surfaces).toContain('flow:article-drafting');

    // 业务应用目录集合不含停用应用
    const applications = await getJson(page, '/api/entity?rel=applications');
    const memberRels = ((applications.body.entities ?? []) as { href?: string }[]).flatMap(
      (entry) => {
        const rel =
          entry.href === undefined
            ? undefined
            : new URL(entry.href, 'http://x').searchParams.get('rel');
        return rel === null || rel === undefined ? [] : [rel];
      },
    );
    expect(memberRels).not.toContain(`application:${bundleName}`);
    expect(memberRels).toContain('application:publishing');

    // 授予全集收缩(local demo 全集口径):session 投影不再含该名
    const session = await getJson(page, '/api/auth/session');
    expect(session.status).toBe(200);
    const granted = session.body.grantedApplications as string[];
    expect(granted, '授予全集应收缩(停用名出局)').not.toContain(bundleName);
    expect(granted).toContain('publishing');
    expect(granted).toContain('default');

    // 「我的授权」面板如实(T51):渲染同一 API 投影
    await page.goto('/session');
    await expect(page.getByRole('heading', { name: '我的授权', level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    const facts = page.locator('section[aria-label="授权事实"]');
    await expect(facts).toBeVisible({ timeout: 15_000 });
    await expect(facts).not.toContainText(bundleName);
    await expect(facts).toContainText('publishing');

    // [口径 C] 存量实例 rel 在 local demo(自报域)下仍可读:受众层仅 credential
    // 模式裁决(P3b 合同测试钉 403/授予内 200);走查脚本预期的 404 属 credential
    // 语义,此面停止断言(见文件头「口径 C」)。实例在事件与 fold 中完整保留。
  });

  await test.step('名字烧毁(US4):已停用名再建 Draft,create 门即时拒绝留痕', async () => {
    // 停用 exec 后审计集(deprecatedApplications)即时物化进在线快照:同进程内
    // create 门即时 fail-closed(D71.5),无需重启、无需等激活门。
    const rebirth = await execMeta(page, {
      rel: 'meta/drafts',
      action: 'create',
      params: {
        kind: 'application-bundle',
        target: bundleName,
        commandId: `t52-rebirth-${suffix}`,
        payload: JSON.parse(bundlePayloadJson(bundleName, `Rebirth ${suffix}`)),
      },
    });
    expect(rebirth.status, '烧毁名 create 应被 guard 拒(422)').toBe(422);
    expect(rebirth.body.layer).toBe('guard-failed');
    expect(String(rebirth.body.reason)).toContain('deprecated');

    // 留痕(I6)+ 零 Draft 建立:action-rejected 同理由,rebirth 无 draft-created。
    const events = await getEvents(page);
    const rejected = events.find(
      (event) =>
        event.kind === 'action-rejected' &&
        event.rel === 'meta/drafts' &&
        event.action === 'create',
    );
    expect(rejected, '烧毁拒绝应留痕 action-rejected').toBeDefined();
    expect(String(rejected!.reason)).toContain('deprecated');
    expect(
      events.filter(
        (event) =>
          event.kind === 'draft-created' &&
          JSON.stringify(event.detail).includes(`t52-rebirth-${suffix}`),
      ),
      '烧毁名拒绝之外零 Draft 建立',
    ).toEqual([]);
    // 烧毁名不得再出生:application-seeded 仅 genesis 一条。
    expect(
      events.filter(
        (event) =>
          event.kind === 'application-seeded' && event.rel === `meta/application:${bundleName}`,
      ),
      '烧毁名不得再出生(application-seeded 仅 genesis 一条)',
    ).toHaveLength(1);
  });

  await test.step('重放一致(US2/I5):伴随事件对序连续、detail 形状完整', async () => {
    // 序连续按 core 业务流口径断言:事件 batch 逐行 INSERT(seq 逐条分配),
    // 其它域的 fire-and-forget 追加(如 recipe 预生成的 presentation 事件)可能
    // 在 seq 空间穿插;原子性承诺是「同事务提交」——core 流内相邻即证。
    const events = (await getEvents(page)).filter((event) => event.domain === 'core');
    const companion = events.filter(
      (event) =>
        event.kind === 'application-deprecated' && event.rel === `meta/application:${bundleName}`,
    );
    expect(companion, '停用伴随事件应恰一条').toHaveLength(1);
    const executed = events.find(
      (event) =>
        event.kind === 'action-executed' &&
        event.rel === `meta/application:${bundleName}` &&
        event.action === 'deprecate',
    );
    expect(executed, 'action-executed 应在场').toBeDefined();
    // 伴随事件对序连续:application-deprecated 在 core 流内紧随 action-executed
    expect(events[events.indexOf(executed!) + 1], '伴随事件对在 core 流内相邻').toBe(companion[0]);
    // detail 形状:name/reason/commandId(确定性铸造)
    expect(companion[0]!.detail).toMatchObject({
      name: bundleName,
      reason,
      commandId: `application-deprecate:${bundleName}`,
    });
    // 全 log 重放/重启不复活语义由 invariants 扩展(e2e/invariants/deprecation-replay)覆盖。
  });
});
