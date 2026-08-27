/**
 * T3 Phase D / Task D2 — S1/I4 确认门全链路 E2E(arch-brief §9.1、§11 铁律 5)。
 *
 * 场景栈:withWorkerServer(TRUNCATE + 自起 3110 dev server + 真 Temporal worker,
 * UI4A_NOTIFY_DISPATCH=on)——web exec 挂起 → Temporal notifyWorkflow → worker
 * appendEvent(notification-delivered)→ web 读路径增量 fold。
 *
 * - S1(agent 视角):agent archive → 202 挂起形态、动作未生效、confirmation
 *   pending 可查、confirmation-requested 留痕(actor/principal/信道/Cedar 原因)、
 *   ≤15s inbox 送达(notification-delivered);
 * - S1(human 视角,同一日志第二次断言):human /api/exec approve → post archived、
 *   confirmation-approved + action-executed(actor=human,principal=提议者 principal,
 *   channel=confirmation——委托语义)、inbox pending 清空;
 * - I4:agent exec approve → 422 guard(actor-is-human)留痕,confirmation 仍 pending;
 * - reject:human reject 带 reason → 原动作永不生效,confirmation-rejected;
 * - UI 走查(浏览器):收件箱保留路由 → 确认页 RJSF(approve 按钮 + reject reason
 *   必填)→ 批准 → 合同实体确认文章 archived、收件箱清零。
 *
 * Temporal 依赖用例探活 skip-if:TEMPORAL_ADDRESS(缺省 localhost:7233)不可达
 * 时整个文件跳过(与 service.notify.integration.test.ts 同口径);PostgreSQL
 * 5433 是既有 e2e 前置,不重复探活。
 */
import { spawnSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { terminateStaleNotifyWorkflows } from '../apps/web/src/temporal/notify';
import {
  SCENARIO_BASE,
  TEMPORAL_ADDRESS,
  withFreshServer,
  withWorkerServer,
} from './kits/server-kit';

// 本文件全部用例指向场景 server(3110)+ 真 worker。
test.use({ baseURL: SCENARIO_BASE });

// ---- Temporal 探活(skip-if)---------------------------------------------------

// 同步 TCP 探活(nc -z,与 server-kit 的端口探测同工具):Playwright 的 CJS
// 转译不支持顶层 await,此处必须同步求值。
const [temporalHost = 'localhost', temporalPort = '7233'] = TEMPORAL_ADDRESS.split(':');
const temporalUp =
  spawnSync('nc', ['-z', temporalHost, temporalPort], { stdio: 'ignore' }).status === 0;
if (!temporalUp) {
  console.warn(`[ui4a-e2e] Temporal dev server 不可达(${TEMPORAL_ADDRESS}),S1/I4 用例跳过`);
}
test.skip(!temporalUp, `Temporal dev server 不可达(${TEMPORAL_ADDRESS})`);

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
  actions: { name: string; title: string; fields: Record<string, unknown> }[];
  entities?: EntityShape[];
}

const AGENT_PRINCIPAL = 'user:mike';
const HUMAN_PRINCIPAL = 'local-user';

/** S1 的提议步骤:agent 经 HTTP 合同 archive post-welcome(期望 202 挂起)。 */
async function agentArchive(): Promise<void> {
  const response = await fetch(`${SCENARIO_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rel: 'post:post-welcome',
      action: 'archive',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    }),
  });
  expect(response.status, 'agent archive 应挂起为 202').toBe(202);
  const body = (await response.json()) as { status?: string; confirmation?: { rel?: string } };
  expect(body.status).toBe('suspended');
  expect(body.confirmation?.rel).toBe('confirmation:c1');
}

async function exec(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
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

function eventsOf(events: LoggedEvent[], kind: string): LoggedEvent[] {
  return events.filter((event) => event.kind === kind);
}

/** 轮询 inbox:确认出现且已送达(worker 的 notification-delivered 已被 web 增量 fold)。 */
async function waitForInboxDelivered(confirmationId: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const inbox = await getEntity('inbox');
    const found = (inbox.entities ?? []).some(
      (sub) => sub.properties.id === confirmationId && sub.properties.notified === true,
    );
    if (found) return;
    if (Date.now() > deadline) {
      throw new Error(`inbox 未在 ${timeoutMs}ms 内出现已送达确认 ${confirmationId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** 每场景前清掉跨轮次残留的 notify workflow(确认 id 确定性复用 c1/c2/c3)。 */
async function cleanStaleWorkflows(): Promise<void> {
  await terminateStaleNotifyWorkflows(['c1', 'c2', 'c3']);
}

// ---- 场景(串行复用 3110)------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译)+ worker,30s 不够。
  test.setTimeout(180_000);
});

test('S1(agent 视角):archive 挂起 202,动作未生效,notify ≤15s 送达 inbox', async () => {
  await cleanStaleWorkflows();
  await withWorkerServer(async () => {
    const response = await fetch(`${SCENARIO_BASE}/api/exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        principal: AGENT_PRINCIPAL,
        channel: 'e2e',
      }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      status: string;
      confirmation: {
        rel: string;
        id: string;
        targetRel: string;
        targetAction: string;
        proposedBy: { actor: string; principal?: string };
        policyReason: string;
      };
    };
    // 202 挂起形态:非拒绝,确认摘录完整(等待 confirmation:<id> 上的人类裁决)。
    expect(body.status).toBe('suspended');
    expect(body.confirmation).toMatchObject({
      rel: 'confirmation:c1',
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      proposedBy: { actor: 'agent', principal: AGENT_PRINCIPAL },
    });
    expect(body.confirmation.policyReason).toContain('确认');

    // 动作未生效:文章仍 published。
    expect((await getEntity('post:post-welcome')).properties.node).toBe('published');

    // 确认实体 pending 可查:approve/reject 已声明,reject 的 reason 必填。
    const confirmation = await getEntity('confirmation:c1');
    expect(confirmation.properties).toMatchObject({
      status: 'pending',
      'target-action': 'archive',
      'proposed-by': { actor: 'agent', principal: AGENT_PRINCIPAL },
    });
    expect(confirmation.actions.map((action) => action.name)).toEqual(['approve', 'reject']);
    const reject = confirmation.actions.find((action) => action.name === 'reject')!;
    expect(reject.fields.required).toEqual(['reason']);

    // 日志:confirmation-requested 含 actor/principal/信道与 Cedar 策略留痕。
    const requested = eventsOf(await getEvents(), 'confirmation-requested');
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      rel: 'confirmation:c1',
      action: 'archive',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    const detail = requested[0].detail as { policy?: string; request?: Record<string, unknown> };
    expect(detail.policy).toMatch(/^cedar:deny:/);
    expect(detail.request).toMatchObject({
      rel: 'post:post-welcome',
      action: 'archive',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });

    // notify 链路:≤15s inbox 出现该确认(notification-delivered 已写库并被增量 fold)。
    await waitForInboxDelivered('c1');
    const inbox = await getEntity('inbox');
    expect(inbox.properties).toMatchObject({ count: 1, delivered: 1 });
    expect(inbox.entities?.[0]?.properties).toMatchObject({
      id: 'c1',
      'target-action': 'archive',
      notified: true,
    });
    const delivered = eventsOf(await getEvents(), 'notification-delivered');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      rel: 'confirmation:c1',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'notify',
    });

    // 送达 ≠ 生效:文章依旧 published。
    expect((await getEntity('post:post-welcome')).properties.node).toBe('published');
  });
});

test('S1(human 视角):approve → post archived,同一日志双执行者口径', async () => {
  await cleanStaleWorkflows();
  await withWorkerServer(async () => {
    await agentArchive();

    // human 经 /api/exec(renderer 合同身份)approve。
    const { status, json } = await exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'renderer',
    });
    expect(status).toBe(200);
    expect((json as { entity: EntityShape }).entity.properties).toMatchObject({
      rel: 'post:post-welcome',
      node: 'archived',
    });

    // 动作生效:文章 archived。
    expect((await getEntity('post:post-welcome')).properties.node).toBe('archived');

    // 事件链:confirmation-approved(链:proposed-by agent → approved-by human)。
    const events = await getEvents();
    const approved = eventsOf(events, 'confirmation-approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({
      rel: 'confirmation:c1',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'confirmation',
    });
    expect(approved[0].detail).toMatchObject({
      id: 'c1',
      proposedBy: { actor: 'agent', principal: AGENT_PRINCIPAL },
      decidedBy: { actor: 'human', principal: HUMAN_PRINCIPAL },
    });

    // action-executed:actor=human(审批者)、principal=提议者的 principal(委托语义)、
    // channel=confirmation(生效动作的信道是确认门)——同一份日志的第二次视角。
    const archiveExecuted = events.filter(
      (event) => event.kind === 'action-executed' && event.action === 'archive',
    );
    expect(archiveExecuted).toHaveLength(1);
    expect(archiveExecuted[0]).toMatchObject({
      rel: 'post:post-welcome',
      actor: 'human',
      principal: AGENT_PRINCIPAL,
      channel: 'confirmation',
    });

    // inbox pending 视图清空;确认实体转 approved(审计视图,无动作)。
    expect((await getEntity('inbox')).properties).toMatchObject({ count: 0, delivered: 0 });
    const confirmation = await getEntity('confirmation:c1');
    expect(confirmation.properties).toMatchObject({ status: 'approved' });
    expect(confirmation.actions).toEqual([]);
  });
});

test('I4 审批不委托:agent exec approve → 422 guard 拒绝留痕,confirmation 仍 pending', async () => {
  await cleanStaleWorkflows();
  await withWorkerServer(async () => {
    await agentArchive();

    const { status, json } = await exec({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(status).toBe(422);
    const body = json as { layer?: string; reason?: string };
    expect(body.layer).toBe('guard-failed');
    expect(body.reason).toContain('actor-is-human');

    // 留痕:action-rejected(actor=agent,拒绝即数据,I6)。
    const rejected = eventsOf(await getEvents(), 'action-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'agent',
      reason: expect.stringContaining('actor-is-human'),
    });

    // 确认不受影响:仍 pending、inbox 仍在。
    const confirmation = await getEntity('confirmation:c1');
    expect(confirmation.properties.status).toBe('pending');
    expect((await getEntity('inbox')).properties).toMatchObject({ count: 1 });
    expect((await getEntity('post:post-welcome')).properties.node).toBe('published');
  });
});

test('reject 路径:human reject 带 reason → 原动作永不生效,事件 confirmation-rejected', async () => {
  await cleanStaleWorkflows();
  await withWorkerServer(async () => {
    await agentArchive();

    const { status } = await exec({
      rel: 'confirmation:c1',
      action: 'reject',
      params: { reason: '现在不归档,等季度末' },
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'renderer',
    });
    expect(status).toBe(200);

    // 原动作永不生效:文章仍 published,日志无 archive 执行痕迹。
    expect((await getEntity('post:post-welcome')).properties.node).toBe('published');
    const events = await getEvents();
    expect(
      events.filter((event) => event.kind === 'action-executed' && event.action === 'archive'),
    ).toEqual([]);

    // 事件:confirmation-rejected(reason 入日志)。
    const rejected = eventsOf(events, 'confirmation-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      rel: 'confirmation:c1',
      action: 'reject',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      reason: '现在不归档,等季度末',
    });
    expect(rejected[0].detail).toMatchObject({
      id: 'c1',
      proposedBy: { actor: 'agent', principal: AGENT_PRINCIPAL },
      decidedBy: { actor: 'human', principal: HUMAN_PRINCIPAL },
      reason: '现在不归档,等季度末',
    });

    // 确认转 rejected(实体保留供审计);inbox pending 清空。
    const confirmation = await getEntity('confirmation:c1');
    expect(confirmation.properties).toMatchObject({ status: 'rejected' });
    expect((await getEntity('inbox')).properties).toMatchObject({ count: 0 });
  });
});

test('UI 走查:收件箱保留路由 → 确认页 RJSF 批准 → 文章实体 archived', async ({ page }) => {
  await cleanStaleWorkflows();
  await withWorkerServer(async () => {
    // agent 经 HTTP 提议(挂起),等通知送达收件箱。
    await agentArchive();
    await waitForInboxDelivered('c1');

    // 收件箱实体投影为 1，且保留的实体路由可直接导航。
    expect((await getEntity('inbox')).properties).toMatchObject({ count: 1 });
    await page.goto('/entity?rel=inbox');

    // pending 列表:目标动作/提议者摘要可见,逐条链接到确认实体页。
    const member = page.locator('section[aria-label="成员"] a', {
      hasText: 'target-action=archive',
    });
    await expect(member).toContainText('proposed-by.actor=agent');
    await member.click();

    // 确认页:批准按钮可用(renderer 恒为 human);驳回的 reason 必填(RJSF)。
    const approve = page.getByRole('button', { name: '批准' });
    await expect(approve).toBeEnabled();
    // D50:驳回表单默认收起,先打开再断言 reason 必填
    await page.getByRole('button', { name: '填写驳回参数' }).click();
    await expect(page.getByRole('textbox', { name: /reason|原因/i })).toHaveAttribute(
      'required',
      '',
    );
    await approve.click();

    // exec 成功 → 实体重投影:确认转 approved,动作区(批准/驳回)消失。
    await expect(page.getByRole('button', { name: '批准' })).toHaveCount(0);
    await expect(
      page.locator('section[aria-label="属性"] tbody tr', { hasText: 'approved' }).first(),
    ).toBeVisible();

    // 业务合同结果：确认已批准、目标文章 archived、收件箱清零。
    expect((await getEntity('confirmation:c1')).properties).toMatchObject({ status: 'approved' });
    expect((await getEntity('post:post-welcome')).properties).toMatchObject({ node: 'archived' });
    expect((await getEntity('inbox')).properties).toMatchObject({ count: 0 });
  });
});

test('B 回归(human archive 直通):human exec archive → 200 立即生效,不挂起', async () => {
  // spec 验收 6 的显式口径:human 的 high 风险动作不进确认门(Cedar permit
  // principal.actor=="human")。无需 worker(无挂起即无 notify)。
  await withFreshServer(async () => {
    const { status, json } = await exec({
      rel: 'post:post-welcome',
      action: 'archive',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'renderer',
    });
    expect(status).toBe(200);
    expect((json as { entity: EntityShape }).entity.properties).toMatchObject({
      rel: 'post:post-welcome',
      node: 'archived',
    });

    // 未挂起:零确认事件、收件箱为空;直接执行留痕(actor=human)。
    const events = await getEvents();
    expect(eventsOf(events, 'confirmation-requested')).toEqual([]);
    expect((await getEntity('inbox')).properties).toMatchObject({ count: 0 });
    const executedArchive = events.filter(
      (event) => event.kind === 'action-executed' && event.action === 'archive',
    );
    expect(executedArchive).toHaveLength(1);
    expect(executedArchive[0]).toMatchObject({
      rel: 'post:post-welcome',
      actor: 'human',
      principal: HUMAN_PRINCIPAL,
      channel: 'renderer',
    });
  });
});
