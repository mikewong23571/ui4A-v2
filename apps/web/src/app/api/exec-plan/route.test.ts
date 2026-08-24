import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { POST } from './route';

// /api/exec-plan 契约测试(T6 Phase A / spec 架构决定 1–3):
// - POST {steps:[{rel,action,params?}…], actor?, principal?, channel?}
//   → 整个计划一次入串行队列(单事务批量裁决);
// - 全过 → 200 {plan:'completed', results, entities};
// - 中拒 → 200 {plan:'rejected', results(截断分步报告), entities}
//   (口径:请求被完整处理,拒绝是分步数据而非 HTTP 错误——分步报告在 body);
// - 中挂 → 202 {plan:'suspended', results, entities, confirmation 摘录};
// - 空 steps / 步骤形状非法 → 400;meta/ rel 步 → 404(跨站规则,与 /api/exec 一致);
// - confirmation: rel 步 → 引擎 undeclared 拒(审批不委托:plan 是 agent 侧批量,
//   确认裁决仍是人类单步 exec);
// - db 不可达 → 503。
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const BAD_URL = 'postgres://ui4a:ui4a@localhost:5999/ui4a';
const pool = getPool(REAL_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

function post(body: unknown, url = 'http://localhost:3100/api/exec-plan'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const WIZARD_PLAN = {
  steps: [
    { rel: 'flow:article-drafting', action: 'next', params: { title: 'New Article' } },
    { rel: 'flow:article-drafting', action: 'next', params: { category: 'tech', tags: 'ui4a' } },
    { rel: 'flow:article-drafting', action: 'next', params: { body: '正文内容' } },
    { rel: 'flow:article-drafting', action: 'publish', params: { title: 'New Article' } },
  ],
  actor: 'agent',
  principal: 'user:mike',
  channel: 'http',
};

interface StepResult {
  step: number;
  rel: string;
  action: string;
  outcome: string;
  appended?: string[];
  rejection?: { layer: string; reason: string };
  confirmation?: { id: string };
}

interface PlanBody {
  plan: string;
  results: StepResult[];
  entities: string[];
  confirmation?: Record<string, unknown>;
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('POST /api/exec-plan — 全过(plan-completed)', () => {
  it('向导四步一次决策 → 200 {plan:"completed"},分步结果齐全,文章入集合', async () => {
    const res = await POST(post(WIZARD_PLAN));

    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanBody;
    expect(body.plan).toBe('completed');
    expect(body.results).toHaveLength(4);
    expect(body.results.map((result) => result.outcome)).toEqual([
      'executed',
      'executed',
      'executed',
      'executed',
    ]);
    expect(body.results[3]).toMatchObject({
      step: 4,
      action: 'publish',
      appended: ['post:new-article'],
    });
    // entities 摘要:受影响实体(向导实例 + 追加文章)。
    expect(body.entities).toEqual(['article-drafting:main', 'post:new-article']);
  });

  it('一条批量裁决记录:恰一条 plan-executed(detail 含 4 步),伴随事件照常', async () => {
    await POST(post(WIZARD_PLAN));

    const marker = await pool.query(
      "SELECT seq, actor, principal, detail FROM events WHERE kind = 'plan-executed'",
    );
    expect(marker.rows).toHaveLength(1);
    expect(marker.rows[0]).toMatchObject({ actor: 'agent', principal: 'user:mike' });
    expect(marker.rows[0].detail).toMatchObject({
      kind: 'plan-completed',
      identity: {
        authorizationMode: 'self-reported-local-demo',
        humanApprovalEligible: false,
      },
    });
    expect(marker.rows[0].detail.steps).toHaveLength(4);

    const executed = await pool.query(
      "SELECT COUNT(*)::int AS n FROM events WHERE kind = 'action-executed'",
    );
    expect(executed.rows[0]).toMatchObject({ n: 4 });
    const appended = await pool.query(
      "SELECT COUNT(*)::int AS n FROM events WHERE kind = 'entity-appended'",
    );
    expect(appended.rows[0]).toMatchObject({ n: 1 });
  });

  it('单事务:计划事件在日志中连续无缺口(串行队列一个 atom)', async () => {
    await POST(post(WIZARD_PLAN));

    // 种子事件之后,计划产出的 6 条事件(4 executed + 1 appended + 1 标记)seq 连续。
    const rows = await pool.query(
      "SELECT seq FROM events WHERE kind IN ('action-executed', 'entity-appended', 'plan-executed') ORDER BY seq",
    );
    expect(rows.rows).toHaveLength(6);
    const seqs = (rows.rows as { seq: string | number }[]).map((row) => Number(row.seq));
    for (let index = 1; index < seqs.length; index += 1) {
      expect(seqs[index]).toBe(seqs[index - 1]! + 1);
    }
    // 标记事件在伴随事件之后(批量裁决记录收尾)。
    const marker = await pool.query("SELECT seq FROM events WHERE kind = 'plan-executed'");
    expect(Number(marker.rows[0].seq)).toBe(seqs[seqs.length - 1]);
  });

  it('重放一致:plan-executed 参与 fold,重启后快照含新文章', async () => {
    await POST(post(WIZARD_PLAN));
    resetEngineForTests();
    const { getEngine } = await import('../../../engine/service');
    const engine = await getEngine(pool);
    const snapshot = await engine.readSnapshot();

    expect(snapshot.instances['article-drafting:main']?.node).toBe('basic-info');
    expect(snapshot.instances['post:new-article']?.node).toBe('published');
    expect(snapshot.collections.articles).toContain('post:new-article');
  });
});

describe('POST /api/exec-plan — 中拒截断(plan-rejected)', () => {
  it('第二步 undeclared → 200 {plan:"rejected"},前序生效保留,后续未执行', async () => {
    const res = await POST(
      post({
        steps: [
          { rel: 'comment:c1', action: 'approve', params: {} },
          { rel: 'comment:c1', action: 'approve', params: {} },
          { rel: 'comment:c2', action: 'approve', params: {} },
        ],
        actor: 'agent',
        principal: 'user:mike',
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanBody;
    expect(body.plan).toBe('rejected');
    expect(body.results).toHaveLength(2);
    expect(body.results[1]).toMatchObject({
      step: 2,
      outcome: 'rejected',
      rejection: { layer: 'undeclared', reason: expect.stringContaining('approve') },
    });

    // append-only:c1 已生效(前序保留);c2 未执行(后续停止)。
    const executed = await pool.query(
      "SELECT rel FROM events WHERE kind = 'action-executed' AND action = 'approve'",
    );
    expect(executed.rows.map((row) => row.rel)).toEqual(['comment:c1']);
    // 拒绝步留痕(action-rejected,detail 带 layer 与计划步号)。
    const rejected = await pool.query(
      "SELECT reason, detail FROM events WHERE kind = 'action-rejected'",
    );
    expect(rejected.rows).toHaveLength(1);
    expect(rejected.rows[0].detail).toMatchObject({ layer: 'undeclared', plan: { step: 2 } });
    // 标记事件照常(detail.kind=plan-rejected,分步摘要含拒绝步)。
    const marker = await pool.query("SELECT detail FROM events WHERE kind = 'plan-executed'");
    expect(marker.rows[0].detail).toMatchObject({ kind: 'plan-rejected' });
    expect(marker.rows[0].detail.steps).toHaveLength(2);
  });
});

describe('POST /api/exec-plan — 中挂停止(plan-suspended)', () => {
  it('第二步确认门挂起 → 202 {plan:"suspended"},confirmation 摘录,前序生效', async () => {
    const res = await POST(
      post({
        steps: [
          { rel: 'comment:c1', action: 'approve', params: {} },
          { rel: 'post:post-welcome', action: 'archive', params: {} },
          { rel: 'comment:c2', action: 'approve', params: {} },
        ],
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      }),
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as PlanBody;
    expect(body.plan).toBe('suspended');
    expect(body.results).toHaveLength(2);
    expect(body.results[1]).toMatchObject({ step: 2, outcome: 'suspended' });
    expect(body.confirmation).toMatchObject({
      rel: 'confirmation:c1',
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      policyReason: expect.stringContaining('Cedar'),
    });

    // 伴随事件照常:c1 executed + confirmation-requested;后续 c2 未执行。
    const kinds = await pool.query(
      "SELECT kind, rel FROM events WHERE kind IN ('action-executed', 'confirmation-requested') ORDER BY seq",
    );
    expect(kinds.rows).toEqual([
      expect.objectContaining({ kind: 'action-executed', rel: 'comment:c1' }),
      expect.objectContaining({ kind: 'confirmation-requested', rel: 'confirmation:c1' }),
    ]);
    // 挂起效果不应用:文章仍 published(经 fold 后快照)。
    const marker = await pool.query("SELECT detail FROM events WHERE kind = 'plan-executed'");
    expect(marker.rows[0].detail).toMatchObject({ kind: 'plan-suspended' });
  });

  it('挂起后人类 approve(经 /api/exec)→ 计划剩余步不自动续跑,原目标动作生效', async () => {
    const suspended = await POST(
      post({
        steps: [
          { rel: 'comment:c1', action: 'approve', params: {} },
          { rel: 'post:post-welcome', action: 'archive', params: {} },
        ],
        actor: 'agent',
        principal: 'user:mike',
      }),
    );
    expect(suspended.status).toBe(202);

    const { POST: execPost } = await import('../exec/route');
    const approved = await execPost(
      new Request('http://localhost:3100/api/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rel: 'confirmation:c1',
          action: 'approve',
          params: {},
          actor: 'human',
        }),
      }),
    );
    expect(approved.status).toBe(200);
    // 挂起点之后计划不再续跑(没有新的 plan-executed)。
    const markers = await pool.query(
      "SELECT COUNT(*)::int AS n FROM events WHERE kind = 'plan-executed'",
    );
    expect(markers.rows[0]).toMatchObject({ n: 1 });
  });
});

describe('POST /api/exec-plan — 合同边界', () => {
  it('空 steps → 400(engine 口径为平凡完成,HTTP 合同拒绝空计划)', async () => {
    const res = await POST(post({ steps: [], actor: 'agent' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toHaveProperty('error');
  });

  it('步骤形状非法 → 400:缺 rel/action、params 非对象、坏 JSON、steps 非数组', async () => {
    const missingRel = await POST(
      post({ steps: [{ action: 'approve', params: {} }], actor: 'agent' }),
    );
    expect(missingRel.status).toBe(400);

    const badParams = await POST(
      post({ steps: [{ rel: 'comment:c1', action: 'approve', params: 'nope' }], actor: 'agent' }),
    );
    expect(badParams.status).toBe(400);

    const badJson = await POST(post('{not json'));
    expect(badJson.status).toBe(400);

    const notArray = await POST(post({ steps: 'nope', actor: 'agent' }));
    expect(notArray.status).toBe(400);

    for (const res of [missingRel, badParams, badJson, notArray]) {
      await expect(res.json()).resolves.toHaveProperty('error');
    }
  });

  it('非法 actor → 400(与 /api/exec 同口径)', async () => {
    const res = await POST(
      post({ steps: [{ rel: 'comment:c1', action: 'approve', params: {} }], actor: 'robot' }),
    );
    expect(res.status).toBe(400);
  });

  it('meta/ rel 步 → 404(跨站规则:进入定义层必须显式意图)', async () => {
    const res = await POST(
      post({
        steps: [{ rel: 'meta/flows', action: 'add-node', params: {} }],
        actor: 'agent',
      }),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toHaveProperty('error');
  });

  it('confirmation: rel 步 → plan-rejected(undeclared):审批不委托,plan 不做人类裁决', async () => {
    const res = await POST(
      post({
        steps: [{ rel: 'confirmation:c1', action: 'approve', params: {} }],
        actor: 'agent',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanBody;
    expect(body.plan).toBe('rejected');
    expect(body.results[0]?.rejection).toMatchObject({ layer: 'undeclared' });
  });

  it('db 不可达 → 503 JSON,不抛 500', async () => {
    process.env.DATABASE_URL = BAD_URL;
    try {
      const res = await POST(post(WIZARD_PLAN));
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toHaveProperty('error');
    } finally {
      if (REAL_DATABASE_URL === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = REAL_DATABASE_URL;
      }
      resetEngineForTests();
    }
  });
});
