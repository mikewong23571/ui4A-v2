/**
 * T5 Phase C / Task 1 — S3 全链路 E2E(arch-brief §9.3、GOAL S3、spec 验收 2–7)。
 *
 * S3 断言原文(GOAL):「两个 agent 并发操作同一资源:一个成功、一个拿到带原因
 * 的拒绝(裁决器即并发控制);杀掉执行中的委托,新 agent 从实体续跑」+
 * N 路并行/舰队页(人类监控成本不随 N 超线性)。场景栈:withWorkerStack/
 * withWorkerServer(TRUNCATE + 自起 3110 dev server + 真 Temporal worker);
 * 委托入口 = /api/chat mode=delegated(HTTP 合同,与悬浮窗同一信道)。
 *
 * - S3-并发:两个委托并发发布**同一标题**文章(同一资源 = 发布向导/文章集)。
 *   载体说明(与 spec 验收 2 的措辞偏差,如实记录):并发 approve 同一评论
 *   c1 的"败者必被拒"在 e2e 层**天然不稳定**——败者若在胜者提交后才读取
 *   c1,看到的已是 approved 节点(approve 未声明),根本不会尝试,轨迹无被拒
 *   步骤(读-判-行的固有竞态;引擎层的确定性并发裁决已由
 *   service.test.ts「串行化:exec 单 atom」覆盖)。改用参数依赖型 guard
 *   title-not-taken:标题被占用是**世界状态**,败者无论何时读取 ready 节点
 *   都会尝试 publish 并拿到确定的结构化拒绝(guard-failed/title-not-taken;
 *   若恰逢向导被胜者重置则 400 undeclared,同为带原因拒绝)——一个成功、
 *   一个带原因的拒绝,裁决器即并发控制,断言语义与原文逐字成立。
 * - S3-续跑(e2e 级;与 apps/worker 的 kill 集成测试互补,这里走真 HTTP 全链):
 *   dispatch 多步委托(发布向导)→ 等 ≥1 个 delegation-step 落库(直查 PG,
 *   观察延迟最小化)→ SIGKILL worker 进程组 → 断言 Temporal 侧 workflow 仍
 *   RUNNING → 重启 worker → 轮询 statusUrl 至 completed → delegation-step
 *   序列 1..N 连续无缺口无重复 → 文章落库。
 * - S3-N 路并行 + 舰队页:3 个不同目标委托并发(发布两篇不同标题 + 审核全部
 *   待处理评论)→ 全部 completed、业务结果各自成立(文章 +2、pending=0)、
 *   委托互不串扰(delegation:<id> 各自轨迹只含本域 rel);浏览器走查
 *   /delegations:3 行齐、进行中抓到 data-status=running(或极快完成时首查
 *   即全绿)、完成后全部 completed;delegations 集合可经 /api/entity 查询。
 * - chat delegated 轮询(spec 验收 6):statusUrl 每次轮询响应含 messages
 *   (stepToMessage 与 inline 同一投影),终态消息数 = 轨迹步数。
 *
 * Temporal 依赖用例探活 skip-if(与 s1.spec.ts 同口径);PostgreSQL 5433 是
 * 既有 e2e 前置。worker 存活断言需要 @temporalio/client:pnpm 严格
 * node_modules 下 e2e/ 不在 apps/web 解析树内,经 apps/web 的 package.json
 * 锚点 createRequire 复用 web 侧同一依赖根(连接在用例内显式 close)。
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { getPool } from '../../apps/web/src/db/pool';
import {
  DATABASE_URL,
  SCENARIO_BASE,
  TEMPORAL_ADDRESS,
  withWorkerServer,
  withWorkerStack,
} from '../kits/server-kit';

test.skip(
  !process.env.RUN_LLM_E2E ||
    !process.env.LLM_API_KEY ||
    !process.env.LLM_BASE_URL ||
    !process.env.LLM_MODEL,
  'S3 delegated Assistant E2E 需要显式 RUN_LLM_E2E 与完整 provider profile',
);

// 本文件全部用例指向场景 server(3110)+ 真 worker。
test.use({ baseURL: SCENARIO_BASE });

// ---- Temporal 探活(skip-if,与 s1 同口径)------------------------------------

// Playwright 的 CJS 转译不支持顶层 await,探活须同步求值(nc -z)。
const [temporalHost = 'localhost', temporalPort = '7233'] = TEMPORAL_ADDRESS.split(':');
const temporalUp =
  spawnSync('nc', ['-z', temporalHost, temporalPort], { stdio: 'ignore' }).status === 0;
if (!temporalUp) {
  console.warn(`[ui4a-e2e] Temporal dev server 不可达(${TEMPORAL_ADDRESS}),S3 用例跳过`);
}
test.skip(!temporalUp, `Temporal dev server 不可达(${TEMPORAL_ADDRESS})`);

// ---- Temporal client(S3-续跑的 workflow 存活断言)---------------------------

const requireFromWeb = createRequire(path.join(__dirname, '..', 'apps', 'web', 'package.json'));

interface WorkflowDescriptionLike {
  status: { name: string };
}
interface TemporalConnectionLike {
  close(): Promise<void>;
}
interface TemporalClientLike {
  workflow: { getHandle(id: string): { describe(): Promise<WorkflowDescriptionLike> } };
}

const { Client, Connection } = requireFromWeb('@temporalio/client') as {
  Client: new (options: { connection: TemporalConnectionLike }) => TemporalClientLike;
  Connection: { connect(options: { address: string }): Promise<TemporalConnectionLike> };
};

/** 断言某委托在 Temporal 侧仍处给定状态(durable execution 不随 worker 消失)。 */
async function assertWorkflowStatus(delegationId: string, expected: string): Promise<void> {
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection });
    const description = await client.workflow.getHandle(delegationId).describe();
    expect(description.status.name, `Temporal 侧 workflow 状态应为 ${expected}`).toBe(expected);
  } finally {
    await connection.close().catch(() => undefined);
  }
}

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
  properties: Record<string, unknown>;
  entities?: EntityShape[];
}

interface DelegationTrailStep {
  step: number;
  rel: string;
  op: { kind: string; rel?: string; action?: string; params?: Record<string, unknown> };
  outcome: string;
  rejection?: { layer?: string; reason?: string } & Record<string, unknown>;
}

interface DelegationDetail {
  id: string;
  goal: { verb: string };
  status: 'running' | 'completed' | 'failed' | 'max-steps';
  steps: number;
  successes: number;
  driverKind: string;
  startRel: string;
  principal?: string;
  summary?: string;
  reason?: string;
  trail: DelegationTrailStep[];
  messages: { role: string; text: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** /api/chat mode=delegated 派发(悬浮窗同一 AI-first 合同入口)。 */
async function dispatchDelegation(
  goal: Record<string, unknown>,
  sessionId: string,
): Promise<{ delegationId: string; statusUrl: string }> {
  const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal, mode: 'delegated', driver: 'auto', sessionId }),
  });
  expect(response.status, 'delegated 派发应 200(Temporal 可达)').toBe(200);
  const body = (await response.json()) as { mode: string; delegationId: string; statusUrl: string };
  expect(body.mode).toBe('delegated');
  expect(body.statusUrl).toBe(`/api/delegations/${body.delegationId}`);
  return { delegationId: body.delegationId, statusUrl: body.statusUrl };
}

/** 委托详情;404 = 派发后首事件尚未落库的短暂窗口(轮询继续)。 */
async function fetchDetail(delegationId: string): Promise<DelegationDetail | null> {
  const response = await fetch(`${SCENARIO_BASE}/api/delegations/${delegationId}`);
  if (response.status === 404) return null;
  expect(response.status).toBe(200);
  return (await response.json()) as DelegationDetail;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'max-steps']);

/** 轮询 statusUrl 至终态;onPoll 收集每次 200 响应(轮询消息投影断言用)。 */
async function pollTerminal(
  delegationId: string,
  timeoutMs = 120_000,
  onPoll?: (detail: DelegationDetail) => void,
): Promise<DelegationDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await fetchDetail(delegationId);
    if (detail !== null) {
      onPoll?.(detail);
      if (TERMINAL_STATUSES.has(detail.status)) return detail;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `委托 ${delegationId} 未在 ${timeoutMs}ms 内到终态(当前 ${detail?.status ?? '未落库'})`,
      );
    }
    await sleep(200);
  }
}

function trailHasExecuted(detail: DelegationDetail, action: string): boolean {
  return detail.trail.some(
    (step) => step.op.kind === 'exec' && step.op.action === action && step.outcome === 'executed',
  );
}

/**
 * 委托事件族完整性(spec 验收 2/3 的共同断言):delegation-started 首、终态尾且
 * 恰一条、中间全部为 delegation-step、step 号 1..N 连续无缺口无重复、
 * actor=agent/channel=delegation 口径一致。
 */
function assertDelegationLogIntact(events: LoggedEvent[], delegationId: string): void {
  const own = events.filter((event) => event.rel === `delegation:${delegationId}`);
  expect(own, '委托事件族应非空').not.toHaveLength(0);
  expect(own[0]!.kind, '首事件应为 delegation-started').toBe('delegation-started');
  const terminal = own.filter((event) =>
    ['delegation-completed', 'delegation-failed', 'delegation-max-steps'].includes(event.kind),
  );
  expect(terminal, '终态事件恰一条且在尾部').toHaveLength(1);
  expect(own[own.length - 1]!.kind).toBe(terminal[0]!.kind);
  const middle = own.slice(1, -1);
  expect(middle.every((event) => event.kind === 'delegation-step')).toBe(true);
  const stepNumbers = middle.map((event) => (event.detail as { step?: unknown }).step);
  expect(stepNumbers, 'delegation-step 序列应连续无缺口无重复').toEqual(
    Array.from({ length: stepNumbers.length }, (_, index) => index + 1),
  );
  expect(own.every((event) => event.actor === 'agent' && event.channel === 'delegation')).toBe(
    true,
  );
}

// ---- PG 直查(S3-续跑的杀点观察:把检测延迟压到最低)--------------------------

const pool = getPool(DATABASE_URL);

async function stepEventCount(delegationId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM events WHERE kind = 'delegation-step' AND rel = $1",
    [`delegation:${delegationId}`],
  );
  return Number(result.rows[0]!.n);
}

/** 等该委托至少落下 minSteps 个步事件(证明确实"执行中"再杀)。 */
async function waitForStepCount(
  delegationId: string,
  minSteps: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const count = await stepEventCount(delegationId);
    if (count >= minSteps) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${timeoutMs}ms 内未见 ≥${minSteps} 个 delegation-step 事件(当前 ${count};worker 未跑?)`,
      );
    }
    await sleep(25);
  }
}

// ---- 舰队页走查 ---------------------------------------------------------------

/** 进行中抓拍:轮询窗口内任一行 data-status=running(委托秒级步进,窗口给足)。 */
async function sawRunningRow(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await page.locator('tr[data-status="running"]').count()) > 0) return true;
    await sleep(500);
  }
  return false;
}

// ---- 场景(串行复用 3110)------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译)+ worker + 真 Temporal 步进,30s 远不够。
  test.setTimeout(240_000);
});

test('S3-并发(裁决器即并发控制):两委托并发发布同一标题 → 恰一成功,另一带原因被拒留痕,资源终态不损坏', async () => {
  await withWorkerServer(async () => {
    const goal = (body: string) => ({
      verb: '发布一篇文章',
      fields: { title: 's3-race-same-title', category: 'tech', tags: 's3', body },
    });
    const [first, second] = await Promise.all([
      dispatchDelegation(goal('并发裁决正文甲'), 's3-racer-a'),
      dispatchDelegation(goal('并发裁决正文乙'), 's3-racer-b'),
    ]);

    const polls: DelegationDetail[] = [];
    const [detailA, detailB] = await Promise.all([
      pollTerminal(first.delegationId, 150_000, (detail) => polls.push(detail)),
      pollTerminal(second.delegationId, 150_000),
    ]);

    // 恰一个委托的 publish 成功(裁决器串行 atom);败者零 publish 成功。
    const winners = [detailA, detailB].filter((detail) => trailHasExecuted(detail, 'publish'));
    expect(winners, '恰一个委托执行 publish 成功').toHaveLength(1);
    const winner = winners[0]!;
    const loser = winner === detailA ? detailB : detailA;

    expect(winner.status).toBe('completed');
    expect(loser.status).toBe('failed');

    // 败者轨迹含被拒步骤且原因字符串可见(title-taken guard / 中途 undeclared)。
    const rejectedStep = loser.trail.find(
      (step) =>
        step.op.kind === 'exec' && step.op.action === 'publish' && step.outcome === 'rejected',
    );
    expect(
      rejectedStep,
      `败者轨迹应含被拒的 publish 步骤(轨迹:${JSON.stringify(loser.trail.map((s) => [s.step, s.op.kind, s.outcome]))})`,
    ).toBeDefined();
    expect(rejectedStep!.rejection?.layer).toMatch(/guard-failed|undeclared/);
    expect(
      `${rejectedStep!.rejection?.reason ?? ''}`,
      '拒绝原因应含 title-not-taken(guard)或未声明(undeclared)',
    ).toMatch(/title-not-taken|未声明/);

    // 消息投影与 inline 等价(stepToMessage):被拒原因进入对话消息。
    const loserText = loser.messages.map((message) => message.text).join('\n');
    expect(loserText).toContain('被拒 publish');
    expect(loserText).toMatch(/title-not-taken|未声明/);

    // 两委托 delegation-step 事件族各自完整(步号连续、首尾闭合)。
    const events = await getEvents();
    assertDelegationLogIntact(events, first.delegationId);
    assertDelegationLogIntact(events, second.delegationId);

    // 引擎侧留痕:publish 恰一次执行;拒绝 ≥1 次且每次都带原因(败者可能
    // 先吃到 undeclared[向导恰被胜者重置到 basic-info]、再吃到 title-not-taken
    // ——两次都是裁决器串行 atom 的结构化拒绝)。
    const executed = events.filter(
      (event) => event.kind === 'action-executed' && event.action === 'publish',
    );
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ rel: 'article-drafting:main', actor: 'agent' });
    const rejected = events.filter(
      (event) => event.kind === 'action-rejected' && event.action === 'publish',
    );
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const event of rejected) {
      expect(`${event.reason ?? ''}`).toMatch(/title-not-taken|未声明/);
    }

    // 资源终态不因并发损坏:同名文章恰一篇且 published;其余 seed 文章未受影响。
    expect((await getEntity('post:s3-race-same-title')).properties).toMatchObject({
      node: 'published',
    });
    const articles = await getEntity('articles');
    expect(articles.properties.count).toBe(3);
    expect(
      (articles.entities ?? []).filter((sub) => sub.properties.rel === 'post:s3-race-same-title'),
      '同名文章恰一篇(append 不可重复)',
    ).toHaveLength(1);
    expect((await getEntity('post:post-welcome')).properties.node).toBe('published');

    // chat delegated 轮询(spec 验收 6):每次 200 的轮询响应都含 messages;
    // 终态投影与轨迹等长(逐步一条,与 inline 同一 stepToMessage)。
    expect(polls.length).toBeGreaterThanOrEqual(1);
    for (const poll of polls) {
      expect(Array.isArray(poll.messages)).toBe(true);
    }
    expect(winner.messages.length).toBe(winner.trail.length);
    expect(winner.messages.map((message) => message.text).join('\n')).toContain('执行 publish');
  });
});

test('S3-续跑(e2e 全链):执行中 SIGKILL worker → Temporal 仍 RUNNING → 重启续跑 completed,步序列无缺口,文章落库', async () => {
  await withWorkerStack(async (stack) => {
    // 多步委托(B1 发布向导:进入向导 + 3×next + publish + done,共约 6 步)。
    const { delegationId } = await dispatchDelegation(
      {
        verb: '发布一篇文章',
        fields: {
          title: 's3-kill-resume',
          category: 'tech',
          tags: 's3',
          body: 'kill 续跑 e2e 正文:SIGKILL 后由 Temporal durable execution 续跑。',
        },
      },
      's3-killer',
    );

    // 等委托真正跑起来(≥1 个 delegation-step 落库)再杀。
    await waitForStepCount(delegationId, 1, 30_000);

    // SIGKILL 整组(模拟进程崩溃,无优雅退出)。
    await stack.killWorkerHard();

    // Temporal 侧:workflow 仍 RUNNING(委托实体不随执行者消失)。
    await assertWorkflowStatus(delegationId, 'RUNNING');

    // 重启 worker:同一 workflow 从最后完成的 activity 续跑(平台特性)。
    await stack.respawnWorker();

    const detail = await pollTerminal(delegationId, 150_000);
    expect(detail.status).toBe('completed');
    expect(trailHasExecuted(detail, 'publish')).toBe(true);
    expect(detail.trail.length).toBeGreaterThanOrEqual(4);

    // 事件序列:started 首、completed 尾,delegation-step 无缺口无重复。
    const events = await getEvents();
    assertDelegationLogIntact(events, delegationId);

    // 目标业务结果成立:文章真实落库(崩溃前的进度未丢,续跑完成目标)。
    expect((await getEntity('post:s3-kill-resume')).properties).toMatchObject({
      node: 'published',
    });
    expect((await getEntity('articles')).properties.count).toBe(3);
    // 向导循环语义:发布后回到 basic-info(可起草下一篇)。
    expect((await getEntity('article-drafting:main')).properties.node).toBe('basic-info');
  });
});

test('S3-N 路并行 + 舰队页:发布×2(不同标题)+ 审核全部并发 → 全部 completed 互不串扰;/delegations 行数与状态可见', async ({
  page,
}) => {
  await withWorkerServer(async () => {
    const [publishOne, publishTwo, moderate] = await Promise.all([
      dispatchDelegation(
        {
          verb: '发布一篇文章',
          fields: {
            title: 's3-parallel-one',
            category: 'tech',
            tags: 's3',
            body: 'N 路并行第一篇:与另一发布、审核委托并发。',
          },
        },
        's3-par-1',
      ),
      dispatchDelegation(
        {
          verb: '发布一篇文章',
          fields: {
            title: 's3-parallel-two',
            category: 'essay',
            tags: 's3',
            body: 'N 路并行第二篇:同一向导循环起草,标题互不冲突。',
          },
        },
        's3-par-2',
      ),
      dispatchDelegation({ verb: '审核所有待处理评论' }, 's3-par-3'),
    ]);
    const ids = [publishOne.delegationId, publishTwo.delegationId, moderate.delegationId];

    // ---- 舰队页走查(并行进行中):3 行齐、逐委托可见、进行中抓拍 ----------
    await page.goto('/delegations');
    const rows = page.locator('table tbody tr');
    await expect(rows, '舰队页应列出全部 3 个委托(行数=委托数)').toHaveCount(3, {
      timeout: 20_000,
    });
    for (const id of ids) {
      await expect(page.locator(`tr[data-delegation="${id}"]`)).toBeVisible();
    }
    const sawRunning = await sawRunningRow(page, 15_000);
    if (!sawRunning) {
      // 极快完成的兜底口径:首查即全部终态(否则视为舰队页未如实呈现)。
      const statuses = await page
        .locator('table tbody tr [data-status]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-status')));
      expect(statuses.every((status) => status !== null && status !== 'running')).toBe(true);
    }

    // ---- 全部到终态:3 个委托全部 completed ---------------------------------
    const [detailOne, detailTwo, detailModerate] = await Promise.all(
      ids.map((id) => pollTerminal(id, 150_000)),
    );
    expect(detailOne.status).toBe('completed');
    expect(detailTwo.status).toBe('completed');
    expect(detailModerate.status).toBe('completed');

    // ---- 业务结果各自成立:文章 +2(不同标题各一篇)、评论 pending 清零 ------
    expect(trailHasExecuted(detailOne, 'publish')).toBe(true);
    expect(trailHasExecuted(detailTwo, 'publish')).toBe(true);
    expect((await getEntity('post:s3-parallel-one')).properties).toMatchObject({
      node: 'published',
    });
    expect((await getEntity('post:s3-parallel-two')).properties).toMatchObject({
      node: 'published',
    });
    expect((await getEntity('articles')).properties.count).toBe(4);
    const comments = await getEntity('comments');
    expect((comments.entities ?? []).map((sub) => sub.properties.node)).toEqual([
      'approved',
      'approved',
      'approved',
      'approved',
    ]);

    // ---- 互不串扰:各委托轨迹只含本域 rel(向导 vs 评论队列)----------------
    const wizardRels = new Set(['flow:article-drafting', 'article-drafting:main', 'articles']);
    for (const detail of [detailOne, detailTwo]) {
      for (const step of detail.trail) {
        expect(
          wizardRels.has(step.rel),
          `发布委托轨迹不应涉足评论域(步 ${step.step} rel=${step.rel})`,
        ).toBe(true);
      }
    }
    for (const step of detailModerate.trail) {
      expect(
        step.rel === 'comments' || /^comment:c\d+$/.test(step.rel),
        `审核委托轨迹不应涉足文章域(步 ${step.step} rel=${step.rel})`,
      ).toBe(true);
    }
    // 审核委托的对话投影(等价投影的 N 路形态):点名导航 + 逐条 approve。
    const moderateText = detailModerate.messages.map((message) => message.text).join('\n');
    expect(moderateText).toContain('导航到 comment:c1');
    expect(moderateText.match(/执行 approve/g)).toHaveLength(3);

    // ---- 委托事件族各自完整;引擎留痕与业务结果一致 -------------------------
    const events = await getEvents();
    for (const id of ids) {
      assertDelegationLogIntact(events, id);
    }
    const approves = events.filter(
      (event) => event.kind === 'action-executed' && event.action === 'approve',
    );
    expect(approves.map((event) => event.rel).sort()).toEqual([
      'comment:c1',
      'comment:c2',
      'comment:c3',
    ]);

    // ---- 舰队页终态走查:全绿;列表 API 与 /api/entity 双口径一致 -----------
    await page.reload();
    await expect(rows).toHaveCount(3);
    for (const id of ids) {
      await expect(page.locator(`tr[data-delegation="${id}"] [data-status]`)).toHaveAttribute(
        'data-status',
        'completed',
      );
    }
    const listResponse = await fetch(`${SCENARIO_BASE}/api/delegations`);
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { delegations: { id: string }[] };
    expect(list.delegations.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect((await getEntity('delegations')).properties).toMatchObject({ count: 3 });
  });
});
