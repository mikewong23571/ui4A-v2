import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';
import type { AgentDriver, AgentOperation, DecideSink, DriverContext, FetchLike } from '@ui4a/agent';

import type { DbExecutor } from '../../web/src/db/events';

import {
  applyStepToState,
  type DelegationLoopState,
} from './workflows';
import {
  DELEGATION_CHANNEL,
  recordDelegationFinish,
  recordDelegationStart,
  runAgentStep,
  type AgentStepResult,
} from './delegation';

// delegation 步进核心单测(T5 Phase A / Task 1,TDD 红→绿):
// worker 版 agent 循环 = runAgent 语义的步进化(每步一个 activity):
// - 决策+执行合一(runAgentStep:fetch 实体 → driver.decide → 执行 →
//   delegation-step 事件入日志;llm 决策含网络,统一放 activity 内);
// - 幂等恢复:activity 重试发现该步事件已落库 → 返回记录结果,不重执行不双写;
// - 循环状态推导(applyStepToState 纯函数):navigate 切 rel / executed 计数 /
//   lastRejection 单步消费——与 runAgent 逐条对齐;
// - 首尾事件:startDelegation / finishDelegation 幂等(kind+rel 查重);
// - T11(验收 6):delegation-step detail 恒携带 reasoning 字段——driver 经
//   DecideSink 产出推理自述时填真值(llm 路径,Phase C streamText 起),无自述
//   (rule/脚本 driver)落库 null;幂等恢复载荷同构扩展,旧形状事件(无
//   reasoning 字段)读出兼容。
// 真 Temporal + 真 worker 链路由 kill 续跑集成测试覆盖(delegation.kill.integration.test.ts)。
const BASE = 'http://contract.test';

const GOAL = { verb: '下线', targetRel: 'post:post-welcome' };

function actionFixture(name: string): SirenAction {
  return { name, title: name, method: 'POST', href: '/api/exec', fields: {} };
}

const articlesEntity: SirenEntity = {
  class: ['collection', 'articles'],
  properties: { rel: 'articles', count: 1 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
  'guard-results': [],
  entities: [
    {
      class: ['flow-instance', 'post-status'],
      rel: ['item'],
      href: '/api/entity?rel=post:post-welcome',
      properties: { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
      actions: [],
      links: [],
      'guard-results': [],
    },
  ],
};

const postWelcomeEntity: SirenEntity = {
  class: ['flow-instance', 'post-status'],
  properties: { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
  actions: [actionFixture('unpublish'), actionFixture('archive')],
  links: [{ rel: ['self'], href: '/api/entity?rel=post:post-welcome' }],
  'guard-results': [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface TransportOptions {
  entities?: Record<string, SirenEntity>;
  execResponses?: Response[];
}

/** 契同路由 fetch(与 packages/agent 的 loop.test 同构):GET 查表;POST 依次出队;计数留痕。 */
function contractTransport(options: TransportOptions = {}) {
  const entities = options.entities ?? {};
  const execResponses = [...(options.execResponses ?? [])];
  const calls: { url: string; method: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (init?.method === 'POST') {
      const response = execResponses.shift();
      if (response !== undefined) return response;
      return jsonResponse({ error: '脚本耗尽:无更多 exec 响应' }, 500);
    }
    const rel = new URL(url).searchParams.get('rel') ?? '';
    const entity = entities[rel];
    if (entity !== undefined) return jsonResponse(entity);
    return jsonResponse({ error: `实体 "${rel}" 不存在` }, 404);
  };
  return { fetch, calls };
}

/** 按 op 脚本依次决策的 driver(耗尽后 fail)。 */
class ScriptedDriver implements AgentDriver {
  constructor(readonly script: AgentOperation[]) {}
  decide(): AgentOperation {
    return this.script.shift() ?? { kind: 'fail', reason: '脚本耗尽' };
  }
}

interface FakeDbOptions {
  /** 已落库的 delegation-step 事件(幂等恢复路径的存量)。 */
  stepEvents?: { step: number; result: AgentStepResult }[];
  /** 已存在的 (kind|rel) → seq(start/finish 幂等查重的存量)。 */
  existingByKindRel?: Record<string, number>;
}

/**
 * 最小假 db:按 SQL 前缀分流——
 * - `SELECT detail FROM events`(agentStep 的步事件恢复查询)→ stepEvents;
 * - `SELECT seq FROM events`(start/finish 幂等存在性检查)→ existingByKindRel;
 * - `INSERT INTO events`(appendEvent)→ 记录参数并返回递增 seq。
 */
function fakeDb(options: FakeDbOptions = {}) {
  const inserts: { sqlText: string; values: readonly unknown[] }[] = [];
  let nextSeq = 7;
  const db: DbExecutor = {
    async query<R extends QueryResultRow = QueryResultRow>(
      sqlText: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      if (sqlText.startsWith('SELECT detail FROM events')) {
        const rows = (options.stepEvents ?? []).map((recorded) => ({
          detail: { step: recorded.step, ...recorded.result },
        })) as unknown as R[];
        return { rows, rowCount: rows.length } as unknown as QueryResult<R>;
      }
      if (sqlText.startsWith('SELECT seq FROM events')) {
        const kind = String(values?.[0] ?? '');
        const rel = String(values?.[1] ?? '');
        const seq = options.existingByKindRel?.[`${kind}|${rel}`];
        return {
          rows: seq === undefined ? [] : [{ seq: String(seq) }],
          rowCount: seq === undefined ? 0 : 1,
        } as unknown as QueryResult<R>;
      }
      if (sqlText.startsWith('INSERT INTO events')) {
        inserts.push({ sqlText, values: values ?? [] });
        nextSeq += 1;
        return {
          rows: [{ seq: String(nextSeq), ts: new Date('2026-08-21T00:00:00Z') }],
        } as unknown as QueryResult<R>;
      }
      // 其余(ensureEventsTable 的 DDL)→ 空结果放行。
      return { rows: [], rowCount: 0 } as unknown as QueryResult<R>;
    },
  };
  return { db, inserts };
}

const BASE_STATE: DelegationLoopState = { currentRel: 'articles', trail: [], successes: [] };

describe('runAgentStep(rule driver,决策+执行合一)', () => {
  it('① 点名资源:navigate 直达,outcome=navigated,delegation-step 事件携带 op 与实体摘要', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:post-welcome': postWelcomeEntity },
    });
    const { db, inserts } = fakeDb();

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch },
      {
        delegationId: 'wf-1',
        step: 1,
        goal: GOAL,
        driverKind: 'rule',
        baseUrl: BASE,
        principal: 'user:mike',
        ...BASE_STATE,
      },
    );

    expect(result.op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });
    expect(result.outcome).toBe('navigated');
    expect(result.entitySummary).toMatchObject({
      rel: 'post:post-welcome',
      actions: ['unpublish', 'archive'],
    });
    // 事件写入:kind/rel/actor/principal/channel + detail {step, op, outcome, reasoning, entitySummary}。
    expect(inserts).toHaveLength(1);
    const values = inserts[0]!.values;
    expect(values[3]).toBe('delegation-step');
    expect(values[4]).toBe('delegation:wf-1');
    expect(values[0]).toBe('agent');
    expect(values[1]).toBe('user:mike');
    expect(values[2]).toBe(DELEGATION_CHANNEL);
    expect(JSON.parse(String(values[8]))).toEqual({
      step: 1,
      op: { kind: 'navigate', rel: 'post:post-welcome' },
      outcome: 'navigated',
      // T11:reasoning 恒落库;rule 路径无推理自述,恒 null。
      reasoning: null,
      entitySummary: {
        rel: 'post:post-welcome',
        class: ['flow-instance', 'post-status'],
        node: 'published',
        actions: ['unpublish', 'archive'],
      },
    });
  });

  it('② 点名动作:exec 成功 → outcome=executed;exec 请求发往合同端点', async () => {
    const transport = contractTransport({
      entities: { 'post:post-welcome': postWelcomeEntity },
      execResponses: [jsonResponse({ entity: postWelcomeEntity })],
    });
    const { db, inserts } = fakeDb();

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch },
      {
        delegationId: 'wf-1',
        step: 1,
        goal: GOAL,
        driverKind: 'rule',
        baseUrl: BASE,
        principal: 'user:mike',
        currentRel: 'post:post-welcome',
        trail: [],
        successes: [],
      },
    );

    expect(result.op).toEqual({ kind: 'exec', action: 'unpublish', params: {} });
    expect(result.outcome).toBe('executed');
    expect(result.entitySummary).toMatchObject({ rel: 'post:post-welcome' });
    expect(transport.calls.some((call) => call.method === 'POST' && call.url === `${BASE}/api/exec`)).toBe(
      true,
    );
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(String(inserts[0]!.values[8]))).toMatchObject({
      step: 1,
      op: { kind: 'exec', action: 'unpublish' },
      outcome: 'executed',
    });
  });

  it('exec 被拒 → outcome=rejected,rejection 携带 layer/reason(拒绝即数据)', async () => {
    const transport = contractTransport({
      entities: { 'post:post-welcome': postWelcomeEntity },
      execResponses: [
        jsonResponse({ layer: 'guard-failed', reason: 'is-published=false' }, 403),
      ],
    });
    const { db } = fakeDb();

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch },
      {
        delegationId: 'wf-1',
        step: 2,
        goal: GOAL,
        driverKind: 'rule',
        baseUrl: BASE,
        currentRel: 'post:post-welcome',
        trail: [],
        successes: [],
      },
    );

    expect(result.outcome).toBe('rejected');
    expect(result.rejection).toMatchObject({
      rel: 'post:post-welcome',
      action: 'unpublish',
      layer: 'guard-failed',
      reason: 'is-published=false',
    });
  });

  it('driver 决策 done → outcome=done;决策 fail(实体不可得)→ 不写步事件直接 fail 出口', async () => {
    // done:脚本 driver 注入(activity 的 driver 可注入,单测无需真 rule 决策)。
    const doneTransport = contractTransport({ entities: { articles: articlesEntity } });
    const doneDb = fakeDb();
    const doneResult = await runAgentStep(
      {
        db: doneDb.db,
        fetchImpl: doneTransport.fetch,
        driver: new ScriptedDriver([{ kind: 'done', summary: '目标完成' }]),
      },
      {
        delegationId: 'wf-2',
        step: 1,
        goal: { verb: '任意' },
        driverKind: 'rule',
        baseUrl: BASE,
        ...BASE_STATE,
      },
    );
    expect(doneResult).toEqual({ op: { kind: 'done', summary: '目标完成' }, outcome: 'done' });
    expect(doneDb.inserts).toHaveLength(1);
    expect(JSON.parse(String(doneDb.inserts[0]!.values[8]))).toMatchObject({
      step: 1,
      op: { kind: 'done', summary: '目标完成' },
      outcome: 'done',
    });

    // 实体不可得(runAgent 同口径:不产轨迹步,循环 failed 出口)。
    const missing = contractTransport({});
    const missingDb = fakeDb();
    const failResult = await runAgentStep(
      { db: missingDb.db, fetchImpl: missing.fetch },
      {
        delegationId: 'wf-2',
        step: 1,
        goal: { verb: '任意' },
        driverKind: 'rule',
        baseUrl: BASE,
        ...BASE_STATE,
      },
    );
    expect(failResult.outcome).toBe('failed');
    expect(failResult.op).toMatchObject({ kind: 'fail' });
    expect(missingDb.inserts).toHaveLength(0);
  });
});

describe('runAgentStep(幂等恢复)', () => {
  it('该步事件已落库 → 直接返回记录的结果:零 HTTP 调用、不双写', async () => {
    const recorded: AgentStepResult = {
      op: { kind: 'navigate', rel: 'post:post-welcome' },
      outcome: 'navigated',
    };
    const transport = contractTransport(); // 无路由:任何调用都 404,但不应被调用
    const { db, inserts } = fakeDb({ stepEvents: [{ step: 3, result: recorded }] });

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch },
      {
        delegationId: 'wf-3',
        step: 3,
        goal: GOAL,
        driverKind: 'rule',
        baseUrl: BASE,
        ...BASE_STATE,
      },
    );

    expect(result).toEqual(recorded);
    expect(transport.calls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('存量事件属其他步号 → 不命中恢复,正常执行本步', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const { db, inserts } = fakeDb({
      stepEvents: [{ step: 9, result: { op: { kind: 'done', summary: '旧' }, outcome: 'done' } }],
    });

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch },
      {
        delegationId: 'wf-3',
        step: 1,
        goal: { verb: '任意' },
        driverKind: 'rule',
        baseUrl: BASE,
        ...BASE_STATE,
        // driver 缺省 rule:articles 上无目标相关动作 → fail(freeRoam 无路)。
      },
    );

    expect(result.outcome).toBe('failed');
    expect(inserts).toHaveLength(1);
  });
});

describe('delegation-step reasoning 留痕(T11 / 验收 6)', () => {
  it('detail 恒携带 reasoning 字段:driver 未产自述(rule/脚本)→ 落库 null', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const { db, inserts } = fakeDb();

    const result = await runAgentStep(
      {
        db,
        fetchImpl: transport.fetch,
        driver: new ScriptedDriver([{ kind: 'done', summary: '目标完成' }]),
      },
      {
        delegationId: 'wf-r1',
        step: 1,
        goal: { verb: '任意' },
        driverKind: 'rule',
        baseUrl: BASE,
        ...BASE_STATE,
      },
    );

    expect(result.outcome).toBe('done');
    expect(inserts).toHaveLength(1);
    const detail = JSON.parse(String(inserts[0]!.values[8])) as Record<string, unknown>;
    expect('reasoning' in detail).toBe(true);
    expect(detail.reasoning).toBeNull();
  });

  it('driver 经 sink 产出 reasoning(llm 决策形态)→ 步结果与落库 detail 均携真值(T11 Phase C)', async () => {
    // llm driver 的 DecideSink 回调形态:decide 时一次性回调聚合整段自述(D22)。
    class ReasoningDriver implements AgentDriver {
      decide(context: DriverContext, sink?: DecideSink): AgentOperation {
        void context;
        sink?.onReasoning?.('文章草稿已就绪,执行 publish 即达成目标');
        return { kind: 'done', summary: '目标完成' };
      }
    }
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const { db, inserts } = fakeDb();

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch, driver: new ReasoningDriver() },
      {
        delegationId: 'wf-r4',
        step: 1,
        goal: { verb: '任意' },
        driverKind: 'llm',
        baseUrl: BASE,
        ...BASE_STATE,
      },
    );

    // 步结果携带真值(workflows.ts AgentStepResult.reasoning 通道);
    // 落库 detail 同值(幂等恢复载荷与 detail 同构——崩溃续跑读回不丢失)。
    expect(result.reasoning).toBe('文章草稿已就绪,执行 publish 即达成目标');
    expect(inserts).toHaveLength(1);
    const detail = JSON.parse(String(inserts[0]!.values[8])) as Record<string, unknown>;
    expect(detail.reasoning).toBe('文章草稿已就绪,执行 publish 即达成目标');
  });

  it('幂等恢复载荷同构:存量事件 detail 含 reasoning(真值)→ 恢复结果原样携带;零 HTTP、不双写', async () => {
    // 真值 fixture:证明恢复通道同构(Phase C streamText 产出真 reasoning 后,
    // 崩溃续跑读回的步结果与落库 detail 一致,reasoning 不丢失)。
    const recorded: AgentStepResult = {
      op: { kind: 'exec', action: 'publish' },
      outcome: 'executed',
      reasoning: '文章草稿已就绪,执行 publish 即达成目标',
    };
    const transport = contractTransport(); // 无路由:任何调用都 404,但不应被调用
    const { db, inserts } = fakeDb({ stepEvents: [{ step: 2, result: recorded }] });

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch },
      {
        delegationId: 'wf-r2',
        step: 2,
        goal: GOAL,
        driverKind: 'rule',
        baseUrl: BASE,
        currentRel: 'post:post-welcome',
        trail: [],
        successes: [],
      },
    );

    expect(result).toEqual(recorded);
    expect(transport.calls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('旧形状兼容:存量事件 detail 无 reasoning 字段 → 恢复结果同旧形状(不炸、不重执行、不双写)', async () => {
    // T11 之前落库的旧事件:detail 只有 {step, op, outcome, ...},无 reasoning 键。
    const recorded: AgentStepResult = {
      op: { kind: 'navigate', rel: 'post:post-welcome' },
      outcome: 'navigated',
      entitySummary: {
        rel: 'post:post-welcome',
        class: ['flow-instance', 'post-status'],
        node: 'published',
        actions: ['unpublish', 'archive'],
      },
    };
    const transport = contractTransport(); // 无路由:任何调用都 404,但不应被调用
    const { db, inserts } = fakeDb({ stepEvents: [{ step: 4, result: recorded }] });

    const result = await runAgentStep(
      { db, fetchImpl: transport.fetch },
      {
        delegationId: 'wf-r3',
        step: 4,
        goal: GOAL,
        driverKind: 'rule',
        baseUrl: BASE,
        ...BASE_STATE,
      },
    );

    expect(result).toEqual(recorded);
    expect(transport.calls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe('applyStepToState(循环状态推导,runAgent 语义对齐)', () => {
  it('unrecorded(实体不可得 fail 出口):状态原样返回——不产轨迹步,步计数与步事件保持一致', () => {
    const before = applyStepToState(BASE_STATE, 1, {
      op: { kind: 'navigate', rel: 'post:post-welcome' },
      outcome: 'navigated',
    });
    const after = applyStepToState(before, 2, {
      op: { kind: 'fail', reason: '实体 "post:post-welcome" 不可得' },
      outcome: 'failed',
      unrecorded: true,
    });
    expect(after).toEqual(before);
    expect(after.trail).toHaveLength(1);
  });

  it('navigated:currentRel 切换至目标 rel,轨迹记目标 rel', () => {
    const state = applyStepToState(BASE_STATE, 1, {
      op: { kind: 'navigate', rel: 'post:post-welcome' },
      outcome: 'navigated',
    });
    expect(state.currentRel).toBe('post:post-welcome');
    expect(state.trail).toHaveLength(1);
    expect(state.trail[0]).toMatchObject({ step: 1, rel: 'post:post-welcome', outcome: 'navigated' });
    expect(state.successes).toEqual([]);
    expect(state.lastRejection).toBeUndefined();
  });

  it('executed:successes 追加;rejected:lastRejection 回流(单步消费)', () => {
    const navigated = applyStepToState(BASE_STATE, 1, {
      op: { kind: 'navigate', rel: 'post:post-welcome' },
      outcome: 'navigated',
    });
    const executed = applyStepToState(navigated, 2, {
      op: { kind: 'exec', action: 'unpublish' },
      outcome: 'executed',
    });
    expect(executed.successes).toEqual([
      { rel: 'post:post-welcome', action: 'unpublish', params: undefined },
    ]);

    const rejected = applyStepToState(executed, 3, {
      op: { kind: 'exec', action: 'archive' },
      outcome: 'rejected',
      rejection: { rel: 'post:post-welcome', action: 'archive', layer: 'guard-failed', reason: 'x' },
    });
    expect(rejected.lastRejection).toMatchObject({ layer: 'guard-failed' });
    expect(rejected.successes).toHaveLength(1);

    // 下一步(无拒绝)清空 lastRejection——拒绝只影响紧接着的下一步。
    const next = applyStepToState(rejected, 4, {
      op: { kind: 'done', summary: 'ok' },
      outcome: 'done',
    });
    expect(next.lastRejection).toBeUndefined();
    expect(next.trail).toHaveLength(4);
  });
});

describe('委托首尾事件(幂等)', () => {
  it('recordDelegationStart 写 delegation-started:detail 携带 goal/driverKind/startRel', async () => {
    const { db, inserts } = fakeDb();

    const result = await recordDelegationStart(db, {
      delegationId: 'wf-4',
      goal: GOAL,
      driverKind: 'rule',
      startRel: 'articles',
      principal: 'user:mike',
    });

    expect(result.deduplicated).toBe(false);
    expect(inserts).toHaveLength(1);
    const values = inserts[0]!.values;
    expect(values[3]).toBe('delegation-started');
    expect(values[4]).toBe('delegation:wf-4');
    expect(JSON.parse(String(values[8]))).toEqual({
      delegationId: 'wf-4',
      goal: GOAL,
      driverKind: 'rule',
      startRel: 'articles',
      principal: 'user:mike',
    });
  });

  it('同 (kind, rel) 已存在 → deduplicated=true 不双写', async () => {
    const { db, inserts } = fakeDb({
      existingByKindRel: { 'delegation-started|delegation:wf-4': 6 },
    });
    const result = await recordDelegationStart(db, {
      delegationId: 'wf-4',
      goal: GOAL,
      driverKind: 'rule',
      startRel: 'articles',
    });
    expect(result).toEqual({ seq: 6, deduplicated: true });
    expect(inserts).toHaveLength(0);
  });

  it.each([
    ['completed', { summary: '目标完成: publish 已成功' }],
    ['failed', { reason: '无路可走' }],
    ['max-steps', { reason: '达到步数上限 24 未收到 done/fail' }],
  ] as const)('recordDelegationFinish(%s) 写对应终态事件(kind + steps/successes 载荷)', async (outcome, extra) => {
    const { db, inserts } = fakeDb();
    await recordDelegationFinish(db, {
      delegationId: 'wf-5',
      outcome,
      steps: 4,
      successes: 1,
      ...extra,
    });
    const values = inserts[0]!.values;
    expect(values[3]).toBe(`delegation-${outcome}`);
    expect(values[4]).toBe('delegation:wf-5');
    expect(JSON.parse(String(values[8]))).toEqual({ steps: 4, successes: 1, ...extra });
    if (outcome === 'failed') {
      // failed 的 reason 同时入日志 reason 列(审计可读;fold 以 detail 为准)。
      expect(values[7]).toBe('无路可走');
    }
  });
});
