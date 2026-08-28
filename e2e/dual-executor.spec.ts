/**
 * T8 Phase A / Task 2 — 双执行者口径套件(GOAL 使命口径的收拢)。
 *
 * 「每个场景由两种执行者各跑一遍——人类走 renderer,agent 走合同(tools /
 * HTTP),同一套场景,同一份日志。」B1/B2/B3 每场景:agent 路径(合同,
 * runAgent / 直接 HTTP exec)完成后 human 路径(renderer,RJSF 表单走查,
 * 复用 human.spec 的表单断言核心)在同一栈同一日志执行 → 断言两类 actor 的
 * action-executed 并存且各自正确(actor=agent 与 actor=human 的 exec 各 ≥1,
 * principal/channel 口径分立);S1 双视角收拢:proposed-by agent +
 * approved-by human 的确认链(s1 断言核心,worker 栈)。
 *
 * 单独跑:CI=true pnpm e2e dual-executor。
 * PostgreSQL 5433 前置;S1 双视角需要 Temporal(7233)——不可达时该用例
 * skip(与 s1.spec 同口径),B1–B3 双执行者不受影响。
 */
import { spawnSync } from 'node:child_process';

import { runAgent } from '@ui4a/agent';
import { createRuleDriver } from '@ui4a/agent/testkit/rule-driver';
import type { TrailStep } from '@ui4a/agent';
import { expect, test } from '@playwright/test';

import { terminateStaleNotifyWorkflows } from '../apps/web/src/temporal/notify';

import {
  SCENARIO_BASE,
  TEMPORAL_ADDRESS,
  withFreshServer,
  withWorkerServer,
} from './kits/server-kit';

// 本文件全部用例指向场景 server(3110)。
test.use({ baseURL: SCENARIO_BASE });

// ---- 合同客户端形状 -----------------------------------------------------------

interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
}

interface EntityShape {
  properties: Record<string, unknown>;
  actions: { name: string }[];
  entities?: EntityShape[];
}

const AGENT_PRINCIPAL = 'user:mike';
const HUMAN_PRINCIPAL = 'local-user';

async function execHttp(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${SCENARIO_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

async function getEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events: LoggedEvent[] }).events;
}

function executedOf(events: LoggedEvent[], action: string): LoggedEvent[] {
  return events.filter((event) => event.kind === 'action-executed' && event.action === action);
}

function opKinds(steps: TrailStep[]): string[] {
  return steps.map((step) => step.op.kind);
}

/** 双执行者并存断言:同一动作两类 actor 各 ≥1,身份口径各自正确。 */
function assertDualActors(
  events: LoggedEvent[],
  action: string,
): { agent: LoggedEvent[]; human: LoggedEvent[] } {
  const executed = executedOf(events, action);
  const byAgent = executed.filter((event) => event.actor === 'agent');
  const byHuman = executed.filter((event) => event.actor === 'human');
  expect(
    byAgent.length,
    `${action} 应有 actor=agent 的执行(agent 合同路径)`,
  ).toBeGreaterThanOrEqual(1);
  expect(byHuman.length, `${action} 应有 actor=human 的执行(renderer 路径)`).toBeGreaterThanOrEqual(
    1,
  );
  expect(
    byAgent.every((event) => event.principal === AGENT_PRINCIPAL),
    'agent 足迹的 principal 应为 agent 身份',
  ).toBe(true);
  expect(
    byHuman.every((event) => event.principal === HUMAN_PRINCIPAL && event.channel === 'renderer'),
    'human 足迹的 principal=local-user 且 channel=renderer',
  ).toBe(true);
  return { agent: byAgent, human: byHuman };
}

// ---- Temporal 探活(S1 双视角 skip-if,与 s1.spec 同口径)-----------------------

const [temporalHost = 'localhost', temporalPort = '7233'] = TEMPORAL_ADDRESS.split(':');
const temporalUp =
  spawnSync('nc', ['-z', temporalHost, temporalPort], { stdio: 'ignore' }).status === 0;
if (!temporalUp) {
  console.warn(`[ui4a-e2e] Temporal dev server 不可达(${TEMPORAL_ADDRESS}),S1 双视角用例跳过`);
}

// ---- 场景(串行复用 3110)------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译)+ 浏览器走查,30s 不够。
  test.setTimeout(180_000);
});

test('B1 双执行者:agent 合同发布 + human 表单发布,同一日志两类 actor 并存', async ({ page }) => {
  await withFreshServer(async () => {
    // ---- agent 路径(合同:runAgent 三步向导)------------------------------
    const agentRun = await runAgent(
      createRuleDriver(),
      {
        verb: '发布',
        fields: {
          title: '双执行者的第三篇',
          category: 'tech',
          tags: 'dual-agent',
          body: 'agent 经 HTTP 合同发布。',
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
    expect(agentRun.outcome, `轨迹:${JSON.stringify(opKinds(agentRun.steps))}`).toBe('done');
    expect((await getEntity('articles')).properties.count).toBe(3);

    // ---- human 路径(renderer:保留实体路由直达三步向导)-------------------
    await page.goto('/entity?rel=flow%3Aarticle-drafting');
    await expect(page.locator('h1')).toHaveText('基本信息');
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('textbox', { name: /文章标题/ }).fill('人类的第四篇');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('分类');
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('combobox', { name: /分类/ }).selectOption('essay');
    await page.getByRole('textbox', { name: /标签/ }).fill('dual-human');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('正文');
    await page.getByRole('button', { name: '完成编辑' }).click();
    await page.getByRole('textbox', { name: /正文/ }).fill('人类经 renderer 表单发布。');
    await page.getByRole('button', { name: '完成编辑', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('就绪');
    await page.getByRole('button', { name: '发布 ⌄' }).click();
    await page.getByRole('textbox', { name: /文章标题/ }).fill('人类的第四篇');
    await page.getByRole('button', { name: '发布', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('基本信息');

    // ---- 同一日志:publish 由两类执行者各执行一次,各自正确 ----------------
    // 文章集合实体状态是业务合同；不依赖首页文章计数快照。
    expect((await getEntity('articles')).properties.count).toBe(4);
    const { agent, human } = assertDualActors(await getEvents(), 'publish');
    expect(agent).toHaveLength(1);
    expect(human).toHaveLength(1);
    expect(agent[0]!.rel).toBe('article-drafting:main');
    expect(human[0]!.rel).toBe('article-drafting:main');
  });
});

test('B2 双执行者:agent 合同下线 post-welcome + human 表单下线 first-post,各自精确', async ({
  page,
}) => {
  await withFreshServer(async () => {
    // ---- agent 路径(合同:子实体链接直达)--------------------------------
    const agentRun = await runAgent(
      createRuleDriver(),
      { verb: '下线', resource: 'post-welcome' },
      {
        baseUrl: SCENARIO_BASE,
        fetchImpl: (url, init) => fetch(url, init),
        startRel: 'articles',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
      },
    );
    expect(agentRun.outcome, `轨迹:${JSON.stringify(opKinds(agentRun.steps))}`).toBe('done');
    expect(agentRun.steps[0]!.op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });

    // ---- human 路径(renderer:保留实体路由直达下线按钮)-------------------
    await page.goto('/entity?rel=post%3Afirst-post');
    await expect(page.locator('h1')).toHaveText('已发布');
    await page.getByRole('button', { name: '下线', exact: true }).click();
    await expect(page.locator('h1')).toHaveText('已下线');

    // ---- 同一日志:unpublish 两类执行者,各下线各的,互不影响 -------------
    expect((await getEntity('post:post-welcome')).properties.node).toBe('offline');
    expect((await getEntity('post:first-post')).properties.node).toBe('offline');
    const events = await getEvents();
    const { agent, human } = assertDualActors(events, 'unpublish');
    expect(agent).toHaveLength(1);
    expect(human).toHaveLength(1);
    expect(agent[0]!.rel).toBe('post:post-welcome');
    expect(human[0]!.rel).toBe('post:first-post');
  });
});

test('B3 双执行者:agent 合同 approve c1 + human 表单 approve c2/c3,同一日志清零 pending', async ({
  page,
}) => {
  await withFreshServer(async () => {
    // ---- agent 路径(合同:直接 exec approve)-----------------------------
    const agentApprove = await execHttp({
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(agentApprove.status).toBe(200);

    // ---- human 路径(renderer:队列逐条通过,human.spec 走查核心)----------
    for (let round = 0; round < 2; round += 1) {
      await page.goto('/entity?rel=comments');
      const pending = page.locator('section[aria-label="成员"] a', { hasText: 'pending' });
      await expect(pending).toHaveCount(2 - round);
      await pending.first().click();
      await page.getByRole('button', { name: '通过' }).click();
      await expect(page.getByText('节点 approved')).toBeVisible();
    }
    await page.goto('/entity?rel=comments');
    await expect(page.locator('section[aria-label="成员"] a', { hasText: 'pending' })).toHaveCount(
      0,
    );

    // ---- 同一日志:approve 两类执行者(1+2),c4 零处理痕迹 ---------------
    const comments = await getEntity('comments');
    expect((comments.entities ?? []).map((sub) => sub.properties.node)).toEqual([
      'approved',
      'approved',
      'approved',
      'approved',
    ]);
    const events = await getEvents();
    const { agent, human } = assertDualActors(events, 'approve');
    expect(agent.map((event) => event.rel)).toEqual(['comment:c1']);
    expect(human.map((event) => event.rel).sort()).toEqual(['comment:c2', 'comment:c3']);
    const c4Touches = events.filter(
      (event) =>
        event.rel === 'comment:c4' && (event.action === 'approve' || event.action === 'reject'),
    );
    expect(c4Touches, 'c4(已 approved)不得被重复处理').toEqual([]);
  });
});

test('S1 双视角收拢:proposed-by agent → approved-by human 同链,生效动作 actor=human/channel=confirmation', async () => {
  test.skip(!temporalUp, `Temporal dev server 不可达(${TEMPORAL_ADDRESS})`);
  await terminateStaleNotifyWorkflows(['c1']);
  try {
    await withWorkerServer(async () => {
      // agent 提议:HTTP 合同 archive → 202 挂起(动作未生效)。
      const suspend = await execHttp({
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
      });
      expect(suspend.status).toBe(202);
      expect((await getEntity('post:post-welcome')).properties.node).toBe('published');

      // human 裁决:renderer 合同身份 approve(审批不委托——铁律 5)。
      const approve = await execHttp({
        rel: 'confirmation:c1',
        action: 'approve',
        actor: 'human',
        principal: HUMAN_PRINCIPAL,
        channel: 'renderer',
      });
      expect(approve.status).toBe(200);
      expect((await getEntity('post:post-welcome')).properties.node).toBe('archived');

      const events = await getEvents();
      // 确认链:requested(actor=agent)→ approved(actor=human),detail 携带
      // proposed-by(agent)/decided-by(human)——同一实体的两种执行者视角。
      const requested = events.filter((event) => event.kind === 'confirmation-requested');
      expect(requested).toHaveLength(1);
      expect(requested[0]).toMatchObject({
        rel: 'confirmation:c1',
        action: 'archive',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
      });
      const approved = events.filter((event) => event.kind === 'confirmation-approved');
      expect(approved).toHaveLength(1);
      expect(approved[0]).toMatchObject({
        rel: 'confirmation:c1',
        actor: 'human',
        principal: HUMAN_PRINCIPAL,
        channel: 'confirmation',
      });
      expect(approved[0]!.detail).toMatchObject({
        id: 'c1',
        proposedBy: { actor: 'agent', principal: AGENT_PRINCIPAL },
        decidedBy: { actor: 'human', principal: HUMAN_PRINCIPAL },
      });

      // 生效动作的足迹:actor=human(裁决者)、principal=提议者的 principal
      //(委托语义)、channel=confirmation——同一份日志的第二次视角。
      const archive = executedOf(events, 'archive');
      expect(archive).toHaveLength(1);
      expect(archive[0]).toMatchObject({
        rel: 'post:post-welcome',
        actor: 'human',
        principal: AGENT_PRINCIPAL,
        channel: 'confirmation',
      });

      // 收件箱清空;确认实体转 approved(审计视图,无动作)。
      expect((await getEntity('inbox')).properties).toMatchObject({ count: 0 });
      const confirmation = await getEntity('confirmation:c1');
      expect(confirmation.properties).toMatchObject({ status: 'approved' });
      expect(confirmation.actions).toEqual([]);
    });
  } finally {
    await terminateStaleNotifyWorkflows(['c1']);
  }
});
