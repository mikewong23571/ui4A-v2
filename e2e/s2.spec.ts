/**
 * T4 Phase D / Task D1 — S2 全链路 E2E(arch-brief §9.2、§11 铁律 5)。
 *
 * S2 断言原文五要素,逐条落测:
 * ① 非法定义被拒且留痕(agent add-action to 不存在节点 → 422 guard 层,
 *    /api/events action-rejected 带原因);
 * ② 修正(to: done)→ submit → checks 八项过 → pending-approval(activation
 *    实体含机械 diff[新增 pin 可见]与 checks);
 * ③ 机械 diff 上人类批准:BIOS 页 /meta/activations → 详情 diff 可见 →
 *    approve(actor=human)→ definition-activated 留痕;
 * ④ sitemap 重生成:/.well-known/ui4a.json version 变化、ready 节点 action
 *    schema 含 pin;
 * ⑤ agent 下一步即可用新动作,无任何 prompt 改动(见下"零 prompt 口径")。
 *
 * 执行方式报告口径:
 * - agent 经 /_meta 合同 = runAgent + rule driver 起点显式 meta/flows
 *   (createContractClient 的 baseUrl 组合出 /_meta 前缀——agent 包零改动,
 *   同一循环协议走定义平面);向导预走/第二次激活的人类批准用直接 exec 序列
 *   (场景装置,身份仍是 human/bios)。
 * - 零 prompt 口径:文件级单例 driver(所有 runAgent 共用同一实例),
 *   packages/agent 代码与动词词表零改动;新动作 pin 由 driver 经合同动态发现
 *   (目标动词只表达意图「置顶」,匹配的是激活后合同里出现的动作 title)。
 *   rule driver 的 done 启发式按动作名×词表桥接确认完成,中文意图动词(加动作/
 *   置顶)无法确认 done——这些提案循环用 maxSteps 预算单发执行,成功以
 *   successes(合同事实)断言。
 * - S2 语义澄清(Phase B 报告):「agent 下一步可用新动作」落在激活后出生/
 *   派生的实例上——v1 在途实例对新动作 undeclared。article-drafting 的向导是
 *   seed 单例、恒 born v1,故「激活后出生的实例 exec pin」由第二次修订实现:
 *   post-status 的 published 节点加 pin(自环 transition + set-field pinned),
 *   agent 在两次激活后发布的新文章(post 实例 born v2)即可 exec pin——这正是
 *   验收 2「B 场景文章上」与验收 4 在途/新实例对照的口径。
 *
 * 重放(验收 5):S2 全链事件 TRUNCATE 后原序回灌 → 重启 server 全量 fold →
 * 活跃定义 v2 含 pin、activation 终态(artifact hash)与在线一致。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { runAgent } from '@ui4a/agent';
import { createRuleDriver } from '@ui4a/agent/testkit/rule-driver';
import type { TrailStep } from '@ui4a/agent';
import { expect, test } from '@playwright/test';

import { appendEvent, listEvents } from '../apps/web/src/db/events';
import { getPool } from '../apps/web/src/db/pool';
import {
  DATABASE_URL,
  SCENARIO_BASE,
  SCENARIO_PORT,
  truncateEvents,
  waitUntilHealthy,
  waitUntilPortFree,
  withFreshServer,
} from './server-kit';

// 本文件全部用例指向场景 server(3110)。
test.use({ baseURL: SCENARIO_BASE });

const REPO_ROOT = path.join(__dirname, '..');
const META_BASE = `${SCENARIO_BASE}/_meta`;
const AGENT_PRINCIPAL = 'user:mike';
const HUMAN_PRINCIPAL = 'local-user';

/** 零 prompt 口径的载体:同一 driver 实例服务本文件全部 runAgent 调用。 */
const agentDriver = createRuleDriver();

// ---- 合同客户端形状 -----------------------------------------------------------

interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
  reason: string | null;
  detail: unknown;
}

interface EntityShape {
  class: string[];
  properties: Record<string, unknown>;
  actions: { name: string; title: string; fields?: Record<string, unknown> }[];
  entities?: EntityShape[];
  links?: { rel: string[]; href: string }[];
}

interface SitemapShape {
  version: string;
  surfaces: { rel: string; title: string }[];
  flows: {
    name: string;
    nodes: { name: string; actions: { name: string; fields: Record<string, unknown> }[] }[];
  }[];
}

async function getEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

async function getMetaEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${META_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET /_meta ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

async function exec(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${SCENARIO_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

/** /_meta 站点 exec(agent 提议 / human 审批共用同一裁决端点)。 */
async function execMeta(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${META_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events: LoggedEvent[] }).events;
}

function eventsOf(events: LoggedEvent[], kind: string): LoggedEvent[] {
  return events.filter((event) => event.kind === kind);
}

async function getSitemap(): Promise<SitemapShape> {
  const response = await fetch(`${SCENARIO_BASE}/.well-known/ui4a.json`);
  expect(response.status).toBe(200);
  return (await response.json()) as SitemapShape;
}

function flowOf(sitemap: SitemapShape, name: string): SitemapShape['flows'][number] {
  const flow = sitemap.flows.find((candidate) => candidate.name === name);
  expect(flow, `sitemap 应含 flow ${name}`).toBeDefined();
  return flow!;
}

function nodeActionsOf(
  flow: SitemapShape['flows'][number],
  node: string,
): { name: string; fields: Record<string, unknown> }[] {
  const found = flow.nodes.find((candidate) => candidate.name === node);
  expect(found, `flow ${flow.name} 应含节点 ${node}`).toBeDefined();
  return found!.actions;
}

/** runAgent 的 /_meta 合同选项(agent 经合同走定义平面)。 */
function metaAgentOptions(maxSteps?: number): {
  baseUrl: string;
  fetchImpl: typeof fetch;
  startRel: string;
  actor: 'agent';
  principal: string;
  channel: string;
  maxSteps?: number;
} {
  return {
    baseUrl: META_BASE,
    fetchImpl: (url, init) => fetch(url, init),
    startRel: 'meta/flows',
    actor: 'agent',
    principal: AGENT_PRINCIPAL,
    channel: 'e2e',
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
}

function opKinds(steps: TrailStep[]): string[] {
  return steps.map((step) => step.op.kind);
}

/** add-action 的 goal.fields(与 lifecycle 声明的 node/action 参数 schema 对齐)。 */
function addPinGoalFields(
  node: string,
  to: string,
  effect: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    node,
    action: { name: 'pin', title: '置顶', to, guards: [], effect },
  };
}

/** article-drafting 的 pin(effect: transition;spec 架构决定 8 原样)。 */
function pinOnReady(to: string): Record<string, unknown> {
  return addPinGoalFields('ready', to, [{ type: 'transition' }]);
}

/**
 * post-status 的 pin(第二次修订):published 自环 transition + set-field pinned。
 * 自环 = 置顶不改文章节点;set-field 让「文章实体出现 pin 相关状态」可断言。
 */
function pinOnPublished(): Record<string, unknown> {
  return addPinGoalFields('published', 'published', [
    { type: 'transition' },
    { type: 'set-field', field: 'pinned', value: true },
  ]);
}

/** agent(直接 exec)把 seed 向导走到 ready——在途 v1 实例的装置。 */
async function agentWalkWizardToReady(title: string): Promise<void> {
  const steps = [
    { action: 'next', params: { title } },
    { action: 'next', params: { category: 'tech', tags: 's2' } },
    { action: 'next', params: { body: 'S2 场景正文:在途实例按出生版本走完。' } },
  ];
  for (const step of steps) {
    const { status } = await exec({
      rel: 'article-drafting:main',
      action: step.action,
      params: step.params,
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(status, `向导 ${step.action} 应 200`).toBe(200);
  }
}

// ---- 场景 server 生命周期(重放用例需要"不 TRUNCATE 的二次 boot")--------------

interface ServerHandle {
  kill: () => Promise<void>;
}

async function killGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // 已退出。
  }
  await waitUntilPortFree(SCENARIO_PORT, 15_000);
}

/** 自起场景 dev server(3110,独立 distDir;缺省先 TRUNCATE,重放二次 boot 关闭)。 */
async function spawnScenarioServer(options?: { truncateFirst?: boolean }): Promise<ServerHandle> {
  await waitUntilPortFree(SCENARIO_PORT, 15_000);
  if (options?.truncateFirst !== false) {
    await truncateEvents();
  }
  const child: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(SCENARIO_PORT),
      UI4A_DIST_DIR: '.next-e2e',
      DATABASE_URL,
    },
    detached: true,
    stdio: 'ignore',
  });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  await waitUntilHealthy(SCENARIO_BASE, 90_000);
  if (exited) {
    throw new Error('场景 dev server 提前退出(检查端口 3110 是否被占用)');
  }
  return {
    kill: async () => {
      await killGroup(child).catch(() => undefined);
    },
  };
}

// ---- 场景(串行复用 3110)------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译),30s 不够。
  test.setTimeout(180_000);
});

test('S2 主链路:非法定义拒且留痕 → 修正 → submit/pending(diff+checks)→ BIOS 人类批准 → sitemap bump → 在途 v1 undeclared → agent 零 prompt 用新动作 pin', async ({
  page,
}) => {
  await withFreshServer(async () => {
    // ---- 基线:激活前的业务 sitemap(ready 只有 publish;无任何 _meta 入口)----
    const sitemapBefore = await getSitemap();
    expect(
      nodeActionsOf(flowOf(sitemapBefore, 'article-drafting'), 'ready').map((a) => a.name),
    ).toEqual(['publish']);
    expect(
      sitemapBefore.surfaces.every((surface) => !surface.rel.startsWith('meta/')),
      '业务 sitemap 不得出现 _meta/meta 入口(跨站规则)',
    ).toBe(true);

    // ---- 在途 v1 实例装置:agent 把 seed 向导走到 ready(激活前出生)----------
    await agentWalkWizardToReady('s2 wizard draft');

    // ---- ① 前置:agent 经 /_meta 合同 revise(active v1 → draft)--------------
    const revise = await runAgent(
      agentDriver,
      { verb: 'revise', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(revise.outcome, `轨迹:${JSON.stringify(opKinds(revise.steps))}`).toBe('done');
    expect(revise.successes.map((entry) => entry.action)).toEqual(['revise']);
    expect((await getMetaEntity('meta/flow:article-drafting')).properties).toMatchObject({
      status: 'draft',
      version: 1,
    });

    // ---- ① 非负例:add-action 的 to 指向不存在节点 → 422 拒且留痕 -------------
    const bad = await runAgent(
      agentDriver,
      {
        verb: '加动作',
        resource: 'article-drafting',
        fields: pinOnReady('nonexistent-node'),
      },
      metaAgentOptions(),
    );
    expect(bad.outcome, '非法提案应终局 failed(引擎拒后无可行路径)').toBe('failed');
    expect(bad.successes).toEqual([]);
    const rejectedStep = bad.steps.find((step) => step.outcome === 'rejected');
    expect(rejectedStep?.op).toMatchObject({ kind: 'exec', action: 'add-action' });
    expect(rejectedStep?.rejection).toMatchObject({ layer: 'guard-failed' });
    expect(rejectedStep?.rejection?.reason).toContain('to-exists');

    const rejectedEvents = eventsOf(await getEvents(), 'action-rejected').filter(
      (event) => event.action === 'add-action',
    );
    expect(rejectedEvents, '非法定义拒绝必须留痕(I6)').toHaveLength(1);
    expect(rejectedEvents[0]).toMatchObject({
      rel: 'meta/flow:article-drafting',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
    });
    expect(rejectedEvents[0].reason).toContain('to-exists');

    // ---- ② 修正:to: done → 通过;submit → checks 八项过 → pending-approval ----
    const good = await runAgent(
      agentDriver,
      { verb: '加动作', resource: 'article-drafting', fields: pinOnReady('done') },
      metaAgentOptions(2), // 单发预算:执行成功即达成本提案(done 启发式不覆盖中文动词)
    );
    expect(good.successes.map((entry) => entry.action)).toEqual(['add-action']);
    expect(good.steps.at(-1)?.outcome).toBe('executed');

    const submit = await runAgent(
      agentDriver,
      { verb: 'submit', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(submit.outcome, `轨迹:${JSON.stringify(opKinds(submit.steps))}`).toBe('done');
    expect(submit.successes.map((entry) => entry.action)).toEqual(['submit']);

    // activation 实体:pending-approval + checks 八项全过 + 机械 diff(纯数据)
    const activation = await getMetaEntity('meta/activation:a1');
    expect(activation.properties).toMatchObject({
      id: 'a1',
      flow: 'article-drafting',
      status: 'pending-approval',
      version: 2,
      'requested-by': { actor: 'agent', principal: AGENT_PRINCIPAL },
    });
    const checks = activation.properties.checks as { name: string; pass: boolean }[];
    expect(checks.map((check) => check.name).sort()).toEqual([
      'app-known',
      'capability-registered',
      'edge-targets-exist',
      'effect-known',
      'executor-profile-valid',
      'field-types-known',
      'guards-registered',
      'initial-exists',
      'submission-policy-valid',
      'terminal-reachable',
    ]);
    expect(checks.every((check) => check.pass)).toBe(true);

    const diff = activation.properties.diff as {
      algorithm: string;
      before: { nodes: { name: string; actions: { name: string }[] }[] };
      after: { nodes: { name: string; actions: { name: string }[] }[] };
      changed: { added: unknown[]; deleted: unknown[]; updated: unknown[] };
    };
    expect(diff.algorithm).toBe('deep-object-diff');
    const afterReady = diff.after.nodes.find((node) => node.name === 'ready');
    expect(afterReady?.actions.map((action) => action.name)).toEqual(['publish', 'pin']);
    expect(JSON.stringify(diff.changed.added), '机械 diff 的新增视角应含 pin').toContain('pin');
    const beforeReady = diff.before.nodes.find((node) => node.name === 'ready');
    expect(beforeReady?.actions.map((action) => action.name)).toEqual(['publish']);

    // 定义实体随 lifecycle 转 pending-approval;事件链 revise→edited→submitted(actor=agent)
    expect((await getMetaEntity('meta/flow:article-drafting')).properties).toMatchObject({
      status: 'pending-approval',
    });
    const eventsMid = await getEvents();
    expect(eventsOf(eventsMid, 'definition-revised')).toHaveLength(1);
    expect(eventsOf(eventsMid, 'definition-revised')[0]).toMatchObject({
      rel: 'meta/flow:article-drafting',
      actor: 'agent',
    });
    const submitted = eventsOf(eventsMid, 'definition-submitted');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ rel: 'meta/flow:article-drafting', actor: 'agent' });
    expect(submitted[0].detail).toMatchObject({ name: 'article-drafting', passed: true });

    // ---- ③ human BIOS 批准(UI 走查:队列 → 详情 diff → approve)-------------
    await page.goto('/meta/activations');
    await expect(page.getByText('激活队列(待审 1)')).toBeVisible();
    await expect(page.locator('a[href="/meta/activation/a1"]')).toContainText(
      'a1 · article-drafting → v2 · 提议 agent',
    );
    await page.click('a[href="/meta/activation/a1"]');

    // 详情:checks 八行全过;机械 diff 可见且含 pin(react-diff-view 内建渲染,验收 6)
    await expect(page.getByRole('heading', { name: '激活 a1' })).toBeVisible();
    const checkRows = page.locator('section[aria-label="不变式检查"] tbody tr');
    await expect(checkRows).toHaveCount(10);
    for (let index = 0; index < 10; index += 1) {
      await expect(checkRows.nth(index)).toContainText('通过');
    }
    const diffSection = page.locator('section[aria-label="机械 diff"]');
    // diff 只呈现变更路径(deep-object-diff 视角):新增动作 pin 的声明全文可见
    await expect(diffSection).toContainText('pin');
    await expect(diffSection).toContainText('置顶');
    await expect(diffSection).toContainText('"to":"done"');

    // approve(renderer 恒 human;guard actor-is-human 对 BIOS 面放行)
    await page.click('button[data-action="approve"]');
    await expect(page.locator('button[data-action="approve"]')).toHaveCount(0);
    await expect(
      page.locator('section[aria-label="属性"] tbody tr', { hasText: 'approved' }).first(),
    ).toBeVisible();

    // 事件链:definition-activated(actor=human、principal=local-user、channel=bios)
    const activated = eventsOf(await getEvents(), 'definition-activated');
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({
      rel: 'meta/flow:article-drafting',
      action: 'approve',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'bios',
    });
    expect(activated[0].detail).toMatchObject({
      name: 'article-drafting',
      version: 2,
      activationId: 'a1',
      decidedBy: { actor: 'human', principal: HUMAN_PRINCIPAL },
    });

    // ---- ③' BIOS 拓扑图(T13 验收 2):/meta/flow/<name> 与 /meta/self 只读拓扑可见
    await page.goto('/meta/flow/article-drafting');
    const topology = page.locator('section[aria-label="拓扑"]');
    await expect(topology).toBeVisible();
    // 节点标注 title;边标注 action 名(v2 已激活:ready 节点 publish/pin 双边)。
    await expect(topology).toContainText('基本信息');
    await expect(topology).toContainText('就绪');
    await expect(topology).toContainText('publish');
    await expect(topology).toContainText('pin');
    // 只读口径:拓扑区不提供任何编辑入口(无拖拽连线 handle 交互按钮)。
    await expect(topology.locator('button')).toHaveCount(0);
    // /meta/self 同形投影:definition-lifecycle 拓扑同样渲染。
    await page.goto('/meta/self');
    const selfTopology = page.locator('section[aria-label="拓扑"]');
    await expect(selfTopology).toBeVisible();
    await expect(selfTopology).toContainText('待批准');

    // ---- ③'' 版本两版对比(T13 Phase B 验收 3):版本区 v1/v2 可见,选 v1×v2 →
    // 机械 diff 含 pin(v2 新增动作;只读对比,数据来自版本子实体嵌入全文)----
    await page.goto('/meta/flow/article-drafting');
    const versionSection = page.locator('section[aria-label="版本历史"]');
    await expect(versionSection).toBeVisible();
    await expect(versionSection.locator('tr[data-version="1"]')).toBeVisible();
    await expect(versionSection.locator('tr[data-version="2"]')).toBeVisible();
    await versionSection.locator('select[data-compare="base"]').selectOption('1');
    await versionSection.locator('select[data-compare="candidate"]').selectOption('2');
    const versionDiff = versionSection.locator('[data-bios="diff"]');
    await expect(versionDiff).toBeVisible();
    await expect(versionDiff).toContainText('pin');

    // ---- ④ sitemap 重生成(version 变化;ready 节点 action schema 含 pin)------
    const sitemapAfter = await getSitemap();
    expect(sitemapAfter.version).not.toBe(sitemapBefore.version);
    const readyActions = nodeActionsOf(flowOf(sitemapAfter, 'article-drafting'), 'ready');
    expect(readyActions.map((action) => action.name)).toEqual(['publish', 'pin']);
    const pinSchema = readyActions.find((action) => action.name === 'pin');
    expect(pinSchema?.fields, 'sitemap 的 action 摘要应携带参数 schema').toHaveProperty('type');

    // ---- 在途 v1:向导(born v1)对新动作 undeclared,按出生定义走完 -----------
    const wizard = await getEntity('article-drafting:main');
    expect(wizard.actions.map((action) => action.name)).toEqual(['publish']);
    const inFlightPin = await exec({
      rel: 'article-drafting:main',
      action: 'pin',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(inFlightPin.status).toBe(400);
    expect((inFlightPin.json as { layer?: string }).layer).toBe('undeclared');
    const undeclaredEvents = eventsOf(await getEvents(), 'action-rejected').filter(
      (event) => event.action === 'pin',
    );
    expect(undeclaredEvents).toHaveLength(1);

    // ---- 第二次修订:post-status published 节点加 pin(激活后出生实例的载体)--
    const revise2 = await runAgent(
      agentDriver,
      { verb: 'revise', resource: 'post-status' },
      metaAgentOptions(),
    );
    expect(revise2.outcome).toBe('done');
    const pin2 = await runAgent(
      agentDriver,
      { verb: '加动作', resource: 'post-status', fields: pinOnPublished() },
      metaAgentOptions(2),
    );
    expect(pin2.successes.map((entry) => entry.action)).toEqual(['add-action']);
    const submit2 = await runAgent(
      agentDriver,
      { verb: 'submit', resource: 'post-status' },
      metaAgentOptions(),
    );
    expect(submit2.outcome).toBe('done');

    const activation2 = await getMetaEntity('meta/activation:a2');
    expect(activation2.properties).toMatchObject({
      id: 'a2',
      flow: 'post-status',
      status: 'pending-approval',
      version: 2,
    });
    // human 经同一 /_meta 合同批准(身份与 BIOS 面同源:actor=human/channel=bios)
    const approve2 = await execMeta({
      rel: 'meta/activation:a2',
      action: 'approve',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'bios',
    });
    expect(approve2.status).toBe(200);
    expect((await getMetaEntity('meta/flow:post-status')).properties).toMatchObject({
      status: 'active',
      version: 2,
    });

    // ---- ⑤ agent 零 prompt 用新动作(同一 driver 会话,无任何常量变化)--------
    // 新目标「发布」:agent 在两次激活后发布新文章 → post 实例 born v2。
    const publish = await runAgent(
      agentDriver,
      {
        verb: '发布',
        fields: {
          title: 's2 pinned article',
          category: 'tech',
          tags: 's2',
          body: 'S2:激活后出生的实例即可用新动作,零 prompt 改动。',
        },
      },
      {
        baseUrl: SCENARIO_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        startRel: 'articles',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
      },
    );
    expect(publish.outcome, `轨迹:${JSON.stringify(opKinds(publish.steps))}`).toBe('done');
    expect(publish.successes.map((entry) => entry.action)).toEqual(['publish']);

    // 新文章 born v2:动作面含 pin(S2 语义澄清:新动作落在激活后出生的实例上);
    // 对照:seed 的 v1 出生文章(post-welcome)无 pin(在途按出生定义)。
    const newPost = await getEntity('post:s2-pinned-article');
    expect(newPost.properties).toMatchObject({ node: 'published' });
    expect(newPost.actions.map((action) => action.name)).toEqual(['unpublish', 'archive', 'pin']);
    expect((await getEntity('post:post-welcome')).actions.map((action) => action.name)).toEqual([
      'unpublish',
      'archive',
    ]);

    // 新目标「置顶」:目标动词只表达意图;pin 由 driver 经合同动态发现并 exec。
    const pinRun = await runAgent(
      agentDriver,
      { verb: '置顶', resource: 's2-pinned-article' },
      {
        baseUrl: SCENARIO_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        startRel: 'articles',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
        maxSteps: 2,
      },
    );
    expect(pinRun.successes.map((entry) => entry.action)).toEqual(['pin']);

    // 文章实体出现 pin 相关状态(set-field pinned;投影摊平为裸值)与事件
    const pinned = await getEntity('post:s2-pinned-article');
    expect((pinned.properties.fields as Record<string, unknown>).pinned).toBe(true);
    const pinEvents = eventsOf(await getEvents(), 'action-executed').filter(
      (event) => event.action === 'pin',
    );
    expect(pinEvents).toHaveLength(1);
    expect(pinEvents[0]).toMatchObject({
      rel: 'post:s2-pinned-article',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
  });
});

test('meta approve 不委托:agent approve → 422 actor-is-human 拒且留痕,activation 仍 pending(human 通道不受影响)', async () => {
  await withFreshServer(async () => {
    // agent 经合同到达 pending(无改动修订:checks 对 v1 内容全过)
    const revise = await runAgent(
      agentDriver,
      { verb: 'revise', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(revise.outcome).toBe('done');
    const submit = await runAgent(
      agentDriver,
      { verb: 'submit', resource: 'article-drafting' },
      metaAgentOptions(),
    );
    expect(submit.outcome).toBe('done');
    expect((await getMetaEntity('meta/activation:a1')).properties).toMatchObject({
      status: 'pending-approval',
    });

    // agent approve → 422 guard(actor-is-human;铁律 5 审批不委托)
    const approve = await execMeta({
      rel: 'meta/activation:a1',
      action: 'approve',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(approve.status).toBe(422);
    const body = approve.json as { layer?: string; reason?: string };
    expect(body.layer).toBe('guard-failed');
    expect(body.reason).toContain('actor-is-human');

    // 留痕:action-rejected(actor=agent,原因入日志)
    const rejected = eventsOf(await getEvents(), 'action-rejected').filter(
      (event) => event.action === 'approve',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      rel: 'meta/activation:a1',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      reason: expect.stringContaining('actor-is-human'),
    });

    // 拒绝不改状态:activation 仍 pending、队列仍在、无 definition-activated
    expect((await getMetaEntity('meta/activation:a1')).properties).toMatchObject({
      status: 'pending-approval',
    });
    expect((await getMetaEntity('meta/activations')).properties).toMatchObject({ count: 1 });
    expect(eventsOf(await getEvents(), 'definition-activated')).toEqual([]);

    // human 通道不受影响:同一激活 human approve 仍 200(状态未被拒绝损坏)
    const human = await execMeta({
      rel: 'meta/activation:a1',
      action: 'approve',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'bios',
    });
    expect(human.status).toBe(200);
  });
});

test('重放一致:S2 全链事件 TRUNCATE 原序回灌 → 活跃定义 v2 含 pin、activation 终态与在线一致(I5)', async () => {
  /** 在线状态快照(结构断言的采集面;seq/ts 天然不同,不采集)。 */
  const captureState = async (): Promise<Record<string, unknown>> => {
    const sitemap = await getSitemap();
    const articleFlow = flowOf(sitemap, 'article-drafting');
    const postFlow = flowOf(sitemap, 'post-status');
    const articleMeta = await getMetaEntity('meta/flow:article-drafting');
    const postMeta = await getMetaEntity('meta/flow:post-status');
    const a1 = await getMetaEntity('meta/activation:a1');
    const a2 = await getMetaEntity('meta/activation:a2');
    const wizard = await getEntity('article-drafting:main');
    const post = await getEntity('post:replay-pinned-article');
    const events = await getEvents();
    return {
      sitemapVersion: sitemap.version,
      articleReadyActions: nodeActionsOf(articleFlow, 'ready').map((action) => action.name),
      postPublishedActions: nodeActionsOf(postFlow, 'published').map((action) => action.name),
      articleDefinition: {
        version: articleMeta.properties.version,
        status: articleMeta.properties.status,
      },
      postDefinition: { version: postMeta.properties.version, status: postMeta.properties.status },
      activations: [a1, a2].map((activation) => ({
        id: activation.properties.id,
        status: activation.properties.status,
        version: activation.properties.version,
        artifact: activation.properties.artifact,
        approvedBy: activation.properties['approved-by'],
      })),
      wizard: { node: wizard.properties.node, actions: wizard.actions.map((a) => a.name) },
      post: {
        node: post.properties.node,
        actions: post.actions.map((a) => a.name),
        fields: post.properties.fields,
      },
      eventTrail: events.map(
        (event) => `${event.kind}|${event.rel}|${event.action}|${event.actor}`,
      ),
    };
  };

  const rows = await (async () => {
    const server = await spawnScenarioServer();
    let log: Awaited<ReturnType<typeof listEvents>> = [];
    try {
      const agent = { actor: 'agent', principal: AGENT_PRINCIPAL, channel: 'e2e' } as const;
      const human = { actor: 'human', principal: HUMAN_PRINCIPAL, channel: 'bios' } as const;

      // —— S2 全链(直接 exec 序列;与主链路同一合同与裁决路径)——
      await agentWalkWizardToReady('replay wizard draft');
      expect(
        (await execMeta({ rel: 'meta/flow:article-drafting', action: 'revise', ...agent })).status,
      ).toBe(200);
      const badAdd = await execMeta({
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: pinOnReady('nonexistent-node'),
        ...agent,
      });
      expect(badAdd.status).toBe(422);
      const goodAdd = await execMeta({
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        params: pinOnReady('done'),
        ...agent,
      });
      expect(goodAdd.status).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/flow:article-drafting', action: 'submit', ...agent })).status,
      ).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/activation:a1', action: 'approve', ...human })).status,
      ).toBe(200);

      expect(
        (await execMeta({ rel: 'meta/flow:post-status', action: 'revise', ...agent })).status,
      ).toBe(200);
      expect(
        (
          await execMeta({
            rel: 'meta/flow:post-status',
            action: 'add-action',
            params: pinOnPublished(),
            ...agent,
          })
        ).status,
      ).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/flow:post-status', action: 'submit', ...agent })).status,
      ).toBe(200);
      expect(
        (await execMeta({ rel: 'meta/activation:a2', action: 'approve', ...human })).status,
      ).toBe(200);

      // 业务面:发布(born v2)→ 在途 undeclared → 新文章 exec pin
      expect(
        (
          await exec({
            rel: 'article-drafting:main',
            action: 'publish',
            params: { title: 'replay pinned article' },
            ...agent,
          })
        ).status,
      ).toBe(200);
      const inFlightPin = await exec({
        rel: 'article-drafting:main',
        action: 'pin',
        ...agent,
      });
      expect(inFlightPin.status).toBe(400);
      const pinExec = await exec({ rel: 'post:replay-pinned-article', action: 'pin', ...agent });
      expect(pinExec.status).toBe(200);

      const before = await captureState();
      // 结构健全性:活跃定义 v2 含 pin、activation 终态 approved(防"两边都空"的假一致)
      expect(before.articleReadyActions).toEqual(['publish', 'pin']);
      expect(before.postPublishedActions).toContain('pin');
      expect(
        (before.activations as { status: string; artifact: string }[]).every(
          (activation) => activation.status === 'approved' && activation.artifact !== undefined,
        ),
      ).toBe(true);
      log = await listEvents(getPool(DATABASE_URL));
      expect(log.length).toBeGreaterThan(20);
      expect(log.some((event) => event.kind === 'definition-activated')).toBe(true);
    } finally {
      await server.kill();
    }
    return log;
  })();

  // —— TRUNCATE + 原序回灌(bigserial 重新编号;fold 只依赖全序)——
  await truncateEvents();
  const db = getPool(DATABASE_URL);
  for (const row of rows) {
    await appendEvent(db, {
      domain: row.domain ?? 'core',
      kind: row.kind,
      actor: row.actor ?? undefined,
      principal: row.principal ?? undefined,
      channel: row.channel ?? undefined,
      rel: row.rel ?? undefined,
      action: row.action ?? undefined,
      params: row.params,
      reason: row.reason ?? undefined,
      detail: row.detail ?? undefined,
    });
  }

  // —— 二次 boot(不 TRUNCATE):seed 迁移识别定义已在场,全量 fold 重放 ——
  const server2 = await spawnScenarioServer({ truncateFirst: false });
  try {
    const replayed = await getEvents();
    expect(replayed.map((event) => event.kind)).toEqual(rows.map((row) => row.kind));

    const before = await captureState();
    expect(before.articleReadyActions).toEqual(['publish', 'pin']);
    expect(before.postPublishedActions).toContain('pin');
    expect((before.activations as { status: string }[]).map((a) => a.status)).toEqual([
      'approved',
      'approved',
    ]);
    // 派生文章与在途向导按事件重放一致(pinned 状态、出生动作面)
    expect(before.post).toMatchObject({
      node: 'published',
      actions: ['unpublish', 'archive', 'pin'],
    });
    expect((before.post as { fields: Record<string, unknown> }).fields.pinned).toBe(true);
    expect(before.wizard).toMatchObject({ node: 'basic-info', actions: ['next', 'abandon'] });
  } finally {
    await server2.kill();
  }
});

test('跨站规则:业务 sitemap 无 _meta 入口;/_meta well-known 可达;业务/meta 端点互拒非本面 rel', async ({
  page,
}) => {
  await withFreshServer(async () => {
    // 业务 sitemap:导航枚举不含任何 meta 面(进入定义层必须显式意图)
    const sitemap = await getSitemap();
    expect(sitemap.surfaces.map((surface) => surface.rel).sort()).toEqual([
      'articles',
      'capability-runs',
      'comments',
      'flow:article-drafting',
      'flow:comment-moderation',
      'flow:post-status',
      'flow:software-change',
      'inbox',
      'software-changes',
    ]);

    // 业务实体 links 不携带 /_meta href
    const articles = await getEntity('articles');
    expect(
      (articles.links ?? []).every((link) => !link.href.includes('_meta')),
      '业务实体 links 不得携带 _meta 入口',
    ).toBe(true);

    // _meta 站点 sitemap 可访问:meta rel 面 + 定义实体随 definitions 动态列出
    const metaSitemapResponse = await fetch(`${META_BASE}/.well-known/ui4a.json`);
    expect(metaSitemapResponse.status).toBe(200);
    const metaSitemap = (await metaSitemapResponse.json()) as {
      site: string;
      surfaces: { rel: string }[];
    };
    expect(metaSitemap.site).toBe('meta');
    expect(metaSitemap.surfaces.map((surface) => surface.rel)).toEqual(
      expect.arrayContaining([
        'meta/self',
        'meta/flows',
        'meta/activations',
        'meta/flow:article-drafting',
        'meta/flow:post-status',
        'meta/flow:comment-moderation',
      ]),
    );

    // T13/T18:capability 定义面进 meta sitemap；业务面可另有 Run 资源。
    expect(metaSitemap.surfaces.map((surface) => surface.rel)).toEqual(
      expect.arrayContaining([
        'meta/capabilities',
        'meta/capability:draft',
        'meta/capability:notify',
        'meta/capability:clarify',
        'meta/capability:coding.execute',
      ]),
    );
    // 业务 sitemap 不得泄漏 capability definition 的 meta rel。
    expect(
      sitemap.surfaces.every((surface) => !surface.rel.startsWith('meta/')),
      '业务 sitemap 不得出现 meta 入口',
    ).toBe(true);
    // meta/capabilities 集合投影:四个 seed 成员直达
    const capabilities = await getMetaEntity('meta/capabilities');
    expect(capabilities.properties).toMatchObject({ count: 4 });
    expect((capabilities.entities ?? []).map((sub) => sub.properties.name).sort()).toEqual([
      'clarify',
      'coding.execute',
      'draft',
      'notify',
    ]);

    // 业务端点对 meta rel 404(跨站不混,双向)
    expect(
      (await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent('meta/flows')}`)).status,
    ).toBe(404);
    expect(
      (
        await exec({
          rel: 'meta/flow:article-drafting',
          action: 'revise',
          actor: 'agent',
          principal: AGENT_PRINCIPAL,
          channel: 'e2e',
        })
      ).status,
    ).toBe(404);
    // _meta 端点对业务 rel 404
    expect(
      (
        await execMeta({
          rel: 'post:post-welcome',
          action: 'archive',
          actor: 'human',
          principal: HUMAN_PRINCIPAL,
          channel: 'bios',
        })
      ).status,
    ).toBe(404);

    // BIOS 页可达(React shell 200;空队列如实呈现)
    const response = await page.goto('/meta/activations');
    expect(response?.status()).toBe(200);
    await expect(page.getByText('队列为空(无待批准的定义激活)。')).toBeVisible();

    // BIOS capabilities 页(T13 Phase C):三个 seed 可见,链接进详情(属性投影可读)
    const capsResponse = await page.goto('/meta/capabilities');
    expect(capsResponse?.status()).toBe(200);
    for (const name of ['draft', 'notify', 'clarify']) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await page.getByRole('link', { name: 'draft', exact: true }).click();
    await expect(page).toHaveURL(/\/meta\/capability\/draft$/);
    await expect(page.getByText('extract', { exact: true })).toBeVisible();
  });
});
