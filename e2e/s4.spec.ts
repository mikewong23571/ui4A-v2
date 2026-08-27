/**
 * T6 Phase B / Task — S4 全链路 E2E(GOAL S4、t6 spec 验收 2/3/4/6)。
 *
 * S4 断言原文(GOAL):「六步向导在一次决策内完成,轨迹为一条批量裁决记录,
 * 每步裁决可见」。场景栈:withFreshServer(TRUNCATE + 自起 3110 dev server);
 * S4 不断言通知送达 → 不需要 worker(notify 链路 S1 已覆盖,Temporal 不可达
 * 时派发尽力而为地吞掉,不影响任何断言)。
 *
 * - S4-六步一次决策:goal「发布一篇文章」→ GET /.well-known/ui4a.json 读
 *   sitemap(读路径,不算 exec)→ planFor(goal, sitemap) 确定性推导 4 步
 *   (next×3 分步带 fields + publish)→ e2e 手工追加 2 个业务步(unpublish +
 *   republish 该新文章)凑足六步口径(t6 spec 架构决定 5:next×3 + publish +
 *   unpublish + republish = 6 步,场景在 e2e 定)。生成器 vs 手工拼步口径:
 *   planFor 保持纯语义(只从 sitemap 推导向导计划,不发明目标后缀),追加
 *   业务步由调用方(agent 侧)拼装——新文章 rel 在拼装时确定性可知(publish
 *   的 append effect name-from=title → slugify,slug-clean 标题恒等映射)。
 *   单次 POST /api/exec-plan → 200 plan=completed,results 6 步全 executed;
 *   日志恰一条 plan-executed(detail.steps=6,每步裁决可见)+ 伴随
 *   action-executed ×6(actor=agent)+ 单事务 seq 连续;一次决策断言:agent
 *   信道 exec 类 HTTP 调用计数 execPlan=1、exec=0(无逐步循环);文章
 *   落库 → 下线 → 复发布终态 published。
 * - S4-拒绝截断:planFor 产出 4 步计划但 goal.fields.category 为枚举外值
 *   (生成器不发明事实,坏值如实进计划)→ 第 1 步生效保留,第 2 步
 *   schema-invalid 带原因(ajv detail:/category enum),第 3/4 步未执行,
 *   200 plan=rejected 分步报告;留痕:plan-executed(kind=rejected)+ 已生效
 *   步 action-executed + 拒绝步 action-rejected(reason + detail.plan.step=2)。
 * - S4-挂起交互:planFor 4 步 + archive(该新文章,agent 高危)+ 哨兵步
 *   unpublish(本身合法;未执行只能因为计划停止——把"后续停止"变成可观
 *   测断言)→ 前 4 步生效 + 第 5 步挂起(confirmation:c1 实体)→ 202
 *   plan=suspended;human 经普通 /api/exec approve(审批不委托:plan 不做
 *   人类裁决)→ archive 生效(actor=human / channel=confirmation);计划不
 *   自动续跑(仍恰一条 plan-executed,哨兵步始终未执行)。
 *
 * PostgreSQL 5433 是既有 e2e 前置;confirmation id 确定性复用 c1,挂起场景
 * 前后清理跨轮残留 notify workflow(与 s1 同口径;Temporal 不可达时函数
 * 内部静默兜底,不做 skip-if)。
 */
import { planFor } from '@ui4a/agent';
import { expect, test } from '@playwright/test';

import { terminateStaleNotifyWorkflows } from '../apps/web/src/temporal/notify';
import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

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
  reason: string | null;
  detail: unknown;
}

interface EntityShape {
  properties: Record<string, unknown>;
  entities?: EntityShape[];
}

/** plan-executed 标记事件的 detail 载荷(一条批量裁决记录的分步摘要)。 */
interface PlanExecutedDetail {
  kind: 'plan-completed' | 'plan-rejected' | 'plan-suspended';
  steps: { step: number; rel: string; action: string; outcome: string }[];
}

/** exec-plan 响应体(三态公共形状;suspended 另携 confirmation 摘录)。 */
interface PlanResponse {
  plan: 'completed' | 'rejected' | 'suspended';
  results: {
    step: number;
    rel: string;
    action: string;
    outcome: 'executed' | 'suspended' | 'rejected';
    to?: string;
    appended?: string[];
    confirmation?: { id: string; targetRel: string; targetAction: string };
    rejection?: { layer: string; reason: string; detail?: unknown };
  }[];
  entities: string[];
  confirmation?: { rel: string; id: string; targetRel: string; targetAction: string };
}

/** exec-plan 的步形状(与 /api/exec-plan 合同一致;身份字段计划级携带)。 */
interface PlanStepBody {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
}

async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events: LoggedEvent[] }).events;
}

async function getEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

/** plan-executed 的 detail(类型断言理由:JSON 载荷按合同形状收窄以便逐字段断言)。 */
function planDetail(event: LoggedEvent): PlanExecutedDetail {
  expect(event.kind).toBe('plan-executed');
  return event.detail as PlanExecutedDetail;
}

/**
 * agent 信道:e2e 内 agent 侧 exec 类 HTTP 调用**全部**经此对象(一次决策
 * 断言的计数点)。GET 读取(sitemap/events/entity)与人类调用(humanExec)
 * 不经此、不计入——口径与 spec 验收 2 一致:"e2e 计 agent 的 exec 类 HTTP
 * 调用次数 = 1"。
 */
class AgentChannel {
  private readonly principal: string;

  /** exec 类调用计数:/api/exec-plan(批量一次决策)与 /api/exec(逐步循环)。 */
  readonly calls = { execPlan: 0, exec: 0 };

  constructor(principal: string) {
    this.principal = principal;
  }

  /**
   * 单次批量决策:一次调用 = 一次决策(spec 验收 2 的被测行为本体)。
   * 返回原始 status 供场景断言三态(completed 200 / rejected 200 / suspended 202)。
   */
  async execPlan(steps: readonly PlanStepBody[]): Promise<{ status: number; body: PlanResponse }> {
    this.calls.execPlan += 1;
    const response = await fetch(`${SCENARIO_BASE}/api/exec-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps, actor: 'agent', principal: this.principal, channel: 'http' }),
    });
    expect(response.status, 'exec-plan 应 2xx(拒绝/挂起是步级数据,不是 HTTP 错误)').toBeLessThan(
      300,
    );
    return { status: response.status, body: (await response.json()) as PlanResponse };
  }
}

/** 人类裁决入口:普通单步 /api/exec(审批不委托——plan 不做人类裁决)。 */
async function humanExec(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SCENARIO_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, actor: 'human' }),
  });
}

/** agent 第一跳:读 sitemap(读路径;类型断言理由:planFor 的 sitemap 参数形状)。 */
async function fetchSitemap(): Promise<Parameters<typeof planFor>[1]> {
  const response = await fetch(`${SCENARIO_BASE}/.well-known/ui4a.json`);
  expect(response.status).toBe(200);
  return (await response.json()) as Parameters<typeof planFor>[1];
}

/** 发布类 goal(sitemap 词级命中 article-drafting;fields 分步入向导各步)。 */
function publishGoal(title: string, category: string): Parameters<typeof planFor>[0] {
  return {
    verb: '发布一篇文章',
    fields: { title, category, tags: 's4', body: `S4 批量裁决正文(${title}):一次决策六步计划。` },
  };
}

/** planFor 的提案步 + 手工业务步 → exec-plan 请求体(params 规范化为 {})。 */
function toBodySteps(
  steps: readonly { rel: string; action: string; params?: unknown }[],
): PlanStepBody[] {
  return steps.map((step) => ({
    rel: step.rel,
    action: step.action,
    params: (step.params ?? {}) as Record<string, unknown>,
  }));
}

/** 单事务断言:伴随事件 + 拒绝留痕 + 标记的 seq 连续无缺口,标记收尾。 */
function assertSingleAtom(events: LoggedEvent[]): void {
  const own = events.filter((event) =>
    ['action-executed', 'entity-appended', 'action-rejected', 'plan-executed'].includes(event.kind),
  );
  expect(own.length, '计划事件族应非空').toBeGreaterThan(0);
  for (let index = 1; index < own.length; index += 1) {
    expect(own[index]!.seq, '计划事件 seq 应连续(串行队列一个 atom,无外部交错)').toBe(
      own[index - 1]!.seq + 1,
    );
  }
  expect(own[own.length - 1]!.kind, 'plan-executed 标记应收尾(批量裁决记录在伴随事件之后)').toBe(
    'plan-executed',
  );
}

// ---- 场景(串行复用 3110)------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
  // 每场景自起 next dev(冷编译),30s 远不够。
  test.setTimeout(240_000);
});

test('S4-六步一次决策:单次 exec-plan(next×3 + publish + unpublish + republish)→ 全生效,一条批量裁决记录,每步裁决可见', async () => {
  await withFreshServer(async () => {
    const agent = new AgentChannel('user:s4-plan');
    const title = 's4-batch-adjudication';
    const postRel = `post:${title}`; // name-from=title → slugify(slug-clean 标题恒等)

    // agent 侧计划推导:读 sitemap(GET)+ planFor 纯函数(零 exec 调用)。
    const sitemap = await fetchSitemap();
    const proposal = planFor(publishGoal(title, 'tech'), sitemap);
    if (proposal === undefined) {
      throw new Error('planFor 未推出向导计划(发布目标应命中 article-drafting)');
    }
    expect(proposal.flow).toBe('article-drafting');
    expect(proposal.steps.map((step) => step.action)).toEqual(['next', 'next', 'next', 'publish']);

    // 六步口径:planFor 4 步(生成器保持纯语义)+ e2e 手工拼 2 步(下线 + 复发布)。
    const steps = toBodySteps(proposal.steps).concat([
      { rel: postRel, action: 'unpublish', params: {} },
      { rel: postRel, action: 'republish', params: {} },
    ]);
    expect(steps).toHaveLength(6);

    // 一次决策:整段六步计划,唯一一次 exec 类 HTTP 调用。
    const { status: planStatus, body } = await agent.execPlan(steps);
    expect(planStatus).toBe(200);

    // 响应 plan=completed;六步分步结果齐全,每步裁决可见(步号/rel/action/追加)。
    expect(body.plan).toBe('completed');
    expect(body.results).toHaveLength(6);
    expect(body.results.map((result) => result.outcome)).toEqual([
      'executed',
      'executed',
      'executed',
      'executed',
      'executed',
      'executed',
    ]);
    expect(body.results.map((result) => [result.step, result.rel, result.action])).toEqual([
      [1, 'article-drafting:main', 'next'],
      [2, 'article-drafting:main', 'next'],
      [3, 'article-drafting:main', 'next'],
      [4, 'article-drafting:main', 'publish'],
      [5, postRel, 'unpublish'],
      [6, postRel, 'republish'],
    ]);
    expect(body.results[3]).toMatchObject({ appended: [postRel] });
    expect(body.entities).toEqual(['article-drafting:main', postRel]);

    // 一次决策断言:exec 类调用恰一次(exec-plan),零逐步 /api/exec。
    expect(agent.calls).toEqual({ execPlan: 1, exec: 0 });

    // 日志:恰一条 plan-executed(批量裁决记录),detail 含 6 步且全 executed。
    const events = await getEvents();
    const markers = events.filter((event) => event.kind === 'plan-executed');
    expect(markers, 'plan-executed 应恰一条(一条批量裁决记录)').toHaveLength(1);
    expect(markers[0]).toMatchObject({
      rel: 'plan',
      actor: 'agent',
      principal: 'user:s4-plan',
      channel: 'http',
    });
    expect(planDetail(markers[0]!)).toEqual({
      // T22 起事件 detail 携带 identity 审计块(credential provenance;local 口径为
      // self-reported-local-demo,agent 无 human approval 资格)。
      identity: {
        authorizationMode: 'self-reported-local-demo',
        humanApprovalEligible: false,
        scopes: ['default', 'publishing', 'community', 'development', 'editorial', 'governance'],
      },
      kind: 'plan-completed',
      steps: [
        { step: 1, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
        { step: 2, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
        { step: 3, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
        { step: 4, rel: 'article-drafting:main', action: 'publish', outcome: 'executed' },
        { step: 5, rel: postRel, action: 'unpublish', outcome: 'executed' },
        { step: 6, rel: postRel, action: 'republish', outcome: 'executed' },
      ],
    });

    // 每步裁决可见的伴随事件:action-executed ×6(actor=agent,逐层裁决通过)。
    const executed = events.filter((event) => event.kind === 'action-executed');
    expect(executed.map((event) => event.action)).toEqual([
      'next',
      'next',
      'next',
      'publish',
      'unpublish',
      'republish',
    ]);
    expect(
      executed.every((event) => event.actor === 'agent' && event.principal === 'user:s4-plan'),
    ).toBe(true);
    // 追加伴随事件恰一条(落库行携带 rel/action;新文章 rel 以响应分步结果
    // 与下方集合状态断言——append 的实例级细节在 action-executed 重放里)。
    const appended = events.filter((event) => event.kind === 'entity-appended');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ rel: 'article-drafting:main', action: 'publish' });
    // 单事务:计划事件族 seq 连续无缺口,标记收尾。
    assertSingleAtom(events);

    // 业务终态:文章落库 → 下线 → 复发布,终态 published;向导循环回 basic-info。
    expect((await getEntity(postRel)).properties).toMatchObject({ node: 'published' });
    expect((await getEntity('articles')).properties.count).toBe(3);
    expect((await getEntity('article-drafting:main')).properties).toMatchObject({
      node: 'basic-info',
    });
  });
});

test('S4-拒绝截断:计划第 2 步 schema-invalid(枚举外 category)→ 前 1 步生效保留,3/4 未执行,plan=rejected 分步报告', async () => {
  await withFreshServer(async () => {
    const agent = new AgentChannel('user:s4-reject');
    const title = 's4-truncated-at-schema';

    // 生成器不发明事实:goal 的枚举外 category 原样进入计划,由引擎 schema 层拒绝。
    const sitemap = await fetchSitemap();
    const proposal = planFor(publishGoal(title, 'not-a-category'), sitemap);
    if (proposal === undefined) {
      throw new Error('planFor 未推出向导计划(发布目标应命中 article-drafting)');
    }
    expect(proposal.steps).toHaveLength(4);
    expect(proposal.steps[1]!.params).toMatchObject({ category: 'not-a-category' });

    // 一次决策提交整段计划;拒绝是步级数据 → 200 + 分步报告(HTTP 不是错误)。
    const { body } = await agent.execPlan(toBodySteps(proposal.steps));
    expect(agent.calls).toEqual({ execPlan: 1, exec: 0 });

    expect(body.plan).toBe('rejected');
    expect(body.results, '分步报告截至拒点(第 2 步),3/4 不出现').toHaveLength(2);
    expect(body.results[0]).toMatchObject({ step: 1, outcome: 'executed', to: 'classification' });
    expect(body.results[1]).toMatchObject({
      step: 2,
      outcome: 'rejected',
      rejection: { layer: 'schema-invalid', reason: '参数不符合动作字段 schema' },
    });
    // 拒绝原因可见到字段级:ajv detail 指认 /category 枚举违规。
    const ajvErrors = (body.results[1]!.rejection?.detail ?? []) as {
      instancePath?: string;
      keyword?: string;
    }[];
    expect(
      ajvErrors.some((error) => error.instancePath === '/category' && error.keyword === 'enum'),
      `schema 拒绝应指认 /category 枚举外(detail=${JSON.stringify(ajvErrors)})`,
    ).toBe(true);

    // 留痕三件套:plan-executed(kind=rejected,分步摘要含拒绝步)…
    const events = await getEvents();
    const markers = events.filter((event) => event.kind === 'plan-executed');
    expect(markers).toHaveLength(1);
    expect(planDetail(markers[0]!)).toEqual({
      // T22 identity 审计块(口径同上文 plan-completed 断言)。
      identity: {
        authorizationMode: 'self-reported-local-demo',
        humanApprovalEligible: false,
        scopes: ['default', 'publishing', 'community', 'development', 'editorial', 'governance'],
      },
      kind: 'plan-rejected',
      steps: [
        { step: 1, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
        { step: 2, rel: 'article-drafting:main', action: 'next', outcome: 'rejected' },
      ],
    });
    // …已生效步伴随事件恰一条(append-only:前序保留)…
    const executed = events.filter((event) => event.kind === 'action-executed');
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ action: 'next', actor: 'agent' });
    // …拒绝步 action-rejected 带原因与计划步号(可作下一步决策上下文,I6)。
    const rejected = events.filter((event) => event.kind === 'action-rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      action: 'next',
      actor: 'agent',
      reason: '参数不符合动作字段 schema',
      detail: { layer: 'schema-invalid', plan: { step: 2 } },
    });
    // 第 3/4 步未执行:无第二次 next、无 publish、无追加。
    expect(events.filter((event) => event.action === 'publish')).toHaveLength(0);
    expect(events.filter((event) => event.kind === 'entity-appended')).toHaveLength(0);
    assertSingleAtom(events);

    // 世界状态如实:向导停在 classification,标题已存(第 1 步生效);文章未落库。
    const wizard = await getEntity('article-drafting:main');
    expect(wizard.properties).toMatchObject({ node: 'classification' });
    expect(wizard.properties).toMatchObject({ fields: { title } });
    expect((await getEntity('articles')).properties.count).toBe(2);
    const missing = await fetch(`${SCENARIO_BASE}/api/entity?rel=post:${title}`);
    expect(missing.status, '被截断的文章不应存在').toBe(404);
  });
});

test('S4-挂起交互:agent 计划第 5 步 archive(高危)→ 202 suspended + confirmation 实体;human approve 后 archive 生效,计划不续跑', async () => {
  await withFreshServer(async () => {
    // confirmation id 确定性复用 c1:前后清理跨轮残留 notify workflow(尽力而为)。
    await terminateStaleNotifyWorkflows(['c1']);
    try {
      const agent = new AgentChannel('user:s4-suspend');
      const title = 's4-archived-after-approval';
      const postRel = `post:${title}`;

      // 计划:planFor 4 步 + archive(agent 高危,确认门)+ 哨兵步 unpublish
      // (哨兵本身合法——它未执行只能因为计划在挂起点停止)。
      const sitemap = await fetchSitemap();
      const proposal = planFor(publishGoal(title, 'essay'), sitemap);
      if (proposal === undefined) {
        throw new Error('planFor 未推出向导计划(发布目标应命中 article-drafting)');
      }
      const steps = toBodySteps(proposal.steps).concat([
        { rel: postRel, action: 'archive', params: {} },
        { rel: postRel, action: 'unpublish', params: {} },
      ]);

      // 一次决策:202 Accepted(受理但挂起,不是拒绝);前 4 步生效 + 第 5 步挂起。
      const { status: suspendedStatus, body } = await agent.execPlan(steps);
      expect(suspendedStatus, '挂起是受理非完成 → 202').toBe(202);
      expect(agent.calls).toEqual({ execPlan: 1, exec: 0 });

      expect(body.plan).toBe('suspended');
      expect(body.results, '分步结果截至挂起点(4 生效 + 1 挂起),哨兵步不出现').toHaveLength(5);
      expect(body.results.slice(0, 4).map((result) => result.outcome)).toEqual([
        'executed',
        'executed',
        'executed',
        'executed',
      ]);
      expect(body.results[4]).toMatchObject({
        step: 5,
        rel: postRel,
        action: 'archive',
        outcome: 'suspended',
        confirmation: { id: 'c1', targetRel: postRel, targetAction: 'archive' },
      });
      expect(body.confirmation).toMatchObject({ rel: 'confirmation:c1', id: 'c1' });
      // 发布步照常追加(挂起点之前的效果保留)。
      expect(body.results[3]).toMatchObject({ appended: [postRel] });

      // 挂起即未生效:文章仍 published;confirmation 实体 pending 物化。
      expect((await getEntity(postRel)).properties).toMatchObject({ node: 'published' });
      expect((await getEntity('confirmation:c1')).properties).toMatchObject({
        status: 'pending',
        'target-rel': postRel,
        'target-action': 'archive',
        'proposed-by': { actor: 'agent', principal: 'user:s4-suspend' },
      });

      // 日志:恰一条 plan-executed(kind=suspended);前 4 步伴随事件 +
      // confirmation-requested;哨兵步未执行(无 unpublish)。
      const events = await getEvents();
      const markers = events.filter((event) => event.kind === 'plan-executed');
      expect(markers).toHaveLength(1);
      expect(planDetail(markers[0]!)).toEqual({
        // T22 identity 审计块(口径同上文 plan-completed 断言)。
        identity: {
          authorizationMode: 'self-reported-local-demo',
          humanApprovalEligible: false,
          scopes: ['default', 'publishing', 'community', 'development', 'editorial', 'governance'],
        },
        kind: 'plan-suspended',
        steps: [
          { step: 1, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
          { step: 2, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
          { step: 3, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
          { step: 4, rel: 'article-drafting:main', action: 'publish', outcome: 'executed' },
          { step: 5, rel: postRel, action: 'archive', outcome: 'suspended' },
        ],
      });
      const executed = events.filter((event) => event.kind === 'action-executed');
      expect(executed.map((event) => event.action)).toEqual(['next', 'next', 'next', 'publish']);
      expect(events.filter((event) => event.kind === 'confirmation-requested')).toHaveLength(1);
      expect(
        events.filter((event) => event.action === 'unpublish'),
        '哨兵步不应执行(挂起后计划停止)',
      ).toHaveLength(0);

      // human approve:普通 /api/exec 单步(审批不委托);archive 生效。
      const approved = await humanExec({ rel: 'confirmation:c1', action: 'approve', params: {} });
      expect(approved.status).toBe(200);
      expect((await getEntity(postRel)).properties).toMatchObject({ node: 'archived' });
      expect((await getEntity('confirmation:c1')).properties).toMatchObject({ status: 'approved' });

      // 计划不自动续跑:仍恰一条 plan-executed;哨兵步始终未执行;生效的
      // archive 归人类裁决(actor=human,channel=confirmation),日志可审计。
      const after = await getEvents();
      expect(after.filter((event) => event.kind === 'plan-executed')).toHaveLength(1);
      expect(after.filter((event) => event.action === 'unpublish')).toHaveLength(0);
      const archive = after.filter(
        (event) => event.kind === 'action-executed' && event.action === 'archive',
      );
      expect(archive).toHaveLength(1);
      expect(archive[0]).toMatchObject({ rel: postRel, actor: 'human', channel: 'confirmation' });
      expect(
        after.filter((event) => event.kind === 'confirmation-approved'),
        '人类裁决留痕(confirmation-approved)',
      ).toHaveLength(1);
    } finally {
      await terminateStaleNotifyWorkflows(['c1']);
    }
  });
});
