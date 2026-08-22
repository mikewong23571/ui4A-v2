import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { GET as getEntity } from '../entity/route';

import { POST } from './route';

// /api/exec 契约测试(spec FR4 / DoD):
// - POST {rel,action,params,actor,principal,channel} → 200 {entity:受影响实体};
// - 三层各拒绝 → 400/422 {layer,reason,detail?}(与日志 action-rejected 同源);
// - 请求形状非法 → 400 结构化错误。
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const BAD_URL = 'postgres://ui4a:ui4a@localhost:5999/ui4a';
const pool = getPool(REAL_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const originalLlmModel = process.env.LLM_MODEL;

function post(body: unknown, url = 'http://localhost:3100/api/exec'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** B1 前置:向导三步推进到 ready。 */
async function advanceWizard(): Promise<void> {
  const steps = [
    { params: { title: 'New Article' } },
    { params: { category: 'tech', tags: 'ui4a' } },
    { params: { body: '正文内容' } },
  ];
  for (const step of steps) {
    const res = await POST(
      post({
        rel: 'article-drafting:main',
        action: 'next',
        params: step.params,
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      }),
    );
    expect(res.status).toBe(200);
  }
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

afterEach(() => {
  if (originalLlmModel === undefined) delete process.env.LLM_MODEL;
  else process.env.LLM_MODEL = originalLlmModel;
});

describe('POST /api/exec', () => {
  it('正式模型工件缺少 LLM_MODEL → 503 且无 action/spawn/artifact 半成品事件', async () => {
    delete process.env.LLM_MODEL;

    const res = await POST(
      post({
        rel: 'post:first-post',
        action: 'generate-summary',
        params: { summary: '不应写入' },
        actor: 'agent',
        principal: 'user:mike',
      }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('LLM_MODEL'),
    });
    const partial = await pool.query<{ kind: string }>(
      "SELECT kind FROM events WHERE kind IN ('action-executed', 'spawn-requested', 'capability-artifact-created')",
    );
    expect(partial.rows).toEqual([]);
  });

  it('通过:approve → 200 {entity},新节点 approved', async () => {
    const res = await POST(
      post({
        rel: 'comment:c1',
        action: 'approve',
        params: {},
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entity: { properties: Record<string, unknown> } };
    expect(body.entity.properties).toMatchObject({ rel: 'comment:c1', node: 'approved' });
  });

  it('B1 全链:向导三步 + publish → 200 新文章实体 published,articles 2→3', async () => {
    await advanceWizard();

    const res = await POST(
      post({
        rel: 'article-drafting:main',
        action: 'publish',
        params: { title: 'New Article' },
        actor: 'agent',
        principal: 'user:mike',
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entity: { properties: Record<string, unknown> } };
    expect(body.entity.properties).toMatchObject({ rel: 'post:new-article', node: 'published' });

    // 集合投影联动:articles 2→3(经 /api/entity 验证留给合同级测试)。
    const appended = await pool.query('SELECT COUNT(*)::int AS n FROM events WHERE kind = $1', [
      'entity-appended',
    ]);
    expect(appended.rows[0]).toMatchObject({ n: 1 });
  });

  it('声明层拒绝:未声明动作 → 400 {layer,reason}', async () => {
    const res = await POST(
      post({ rel: 'comment:c1', action: 'explode', params: {}, actor: 'agent' }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { layer: string; reason: string };
    expect(body.layer).toBe('undeclared');
    expect(body.reason).toContain('explode');
  });

  it('guard 层拒绝:重名 publish → 422 {layer,reason,detail 含 guard 求值}', async () => {
    await advanceWizard();

    const res = await POST(
      post({
        rel: 'article-drafting:main',
        action: 'publish',
        params: { title: '欢迎来到 UI4A' },
        actor: 'agent',
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      layer: string;
      reason: string;
      detail: { name: string; pass: boolean }[];
    };
    expect(body.layer).toBe('guard-failed');
    expect(body.reason).toContain('title-not-taken');
    expect(body.detail).toEqual([
      expect.objectContaining({ name: 'title-not-taken', pass: false }),
    ]);
  });

  it('schema 层拒绝:缺必填 → 422 {layer,reason,detail 为 ajv 错误}', async () => {
    const res = await POST(post({ rel: 'article-drafting:main', action: 'next', params: {} }));

    expect(res.status).toBe(422);
    const body = (await res.json()) as { layer: string; reason: string; detail: unknown };
    expect(body.layer).toBe('schema-invalid');
    expect(Array.isArray(body.detail)).toBe(true);
  });

  it('请求形状非法 → 400:缺 rel/action、非对象 params、坏 JSON', async () => {
    const missingAction = await POST(post({ rel: 'comment:c1' }));
    expect(missingAction.status).toBe(400);

    const missingRel = await POST(post({ action: 'approve' }));
    expect(missingRel.status).toBe(400);

    const badParams = await POST(post({ rel: 'comment:c1', action: 'approve', params: 'nope' }));
    expect(badParams.status).toBe(400);

    const badJson = await POST(post('{not json'));
    expect(badJson.status).toBe(400);

    for (const res of [missingAction, missingRel, badParams, badJson]) {
      await expect(res.json()).resolves.toHaveProperty('error');
    }
  });

  it('actor 缺省 human;principal/channel 透传入日志', async () => {
    const res = await POST(post({ rel: 'comment:c2', action: 'reject', params: {} }));
    expect(res.status).toBe(200);

    const rows = await pool.query(
      'SELECT actor, principal, channel FROM events WHERE kind = $1 ORDER BY seq DESC LIMIT 1',
      ['action-executed'],
    );
    expect(rows.rows[0]).toMatchObject({ actor: 'human', principal: null, channel: 'http' });
  });

  it('db 不可达 → 503 JSON,不抛 500', async () => {
    process.env.DATABASE_URL = BAD_URL;
    try {
      const res = await POST(post({ rel: 'comment:c1', action: 'approve', params: {} }));
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

describe('POST /api/exec — 确认门(T3 Phase B)', () => {
  /** agent 挂起 archive 一次,返回 202 body(矩阵测试公共前置)。 */
  async function suspendArchive(): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await POST(
      post({
        rel: 'post:post-welcome',
        action: 'archive',
        params: {},
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('agent archive(high)→ 202 {status:"suspended", confirmation:{rel,...摘录}}', async () => {
    const { status, body } = await suspendArchive();

    expect(status).toBe(202);
    expect(body.status).toBe('suspended');
    expect(body.confirmation).toMatchObject({
      rel: 'confirmation:c1',
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      channel: 'http',
      policyReason: expect.stringContaining('Cedar'),
    });

    // 动作未生效:文章仍 published;confirmation-requested 事件落库(detail 带 Cedar 策略 id)。
    const post = await pool.query(
      "SELECT COUNT(*)::int AS n FROM events WHERE kind = 'action-executed' AND rel = 'post:post-welcome' AND action = 'archive'",
    );
    expect(post.rows[0]).toMatchObject({ n: 0 });
    const requested = await pool.query(
      "SELECT actor, detail FROM events WHERE kind = 'confirmation-requested' ORDER BY seq DESC LIMIT 1",
    );
    expect(requested.rows[0]).toMatchObject({ actor: 'agent' });
    expect(requested.rows[0].detail).toMatchObject({
      policy: expect.stringMatching(/^cedar:/),
    });
  });

  it('human approve(经 /api/exec)→ 200,文章 archived,事件链委托语义', async () => {
    await suspendArchive();

    const res = await POST(
      post({ rel: 'confirmation:c1', action: 'approve', params: {}, actor: 'human' }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entity: { properties: Record<string, unknown> } };
    expect(body.entity.properties).toMatchObject({
      rel: 'post:post-welcome',
      node: 'archived',
    });

    const tail = await pool.query(
      "SELECT kind, actor, principal, channel FROM events WHERE kind IN ('confirmation-approved', 'action-executed') ORDER BY seq DESC LIMIT 2",
    );
    expect(tail.rows.reverse()).toEqual([
      expect.objectContaining({
        kind: 'confirmation-approved',
        actor: 'human',
        channel: 'confirmation',
      }),
      expect.objectContaining({
        kind: 'action-executed',
        actor: 'human',
        principal: 'user:mike',
        channel: 'confirmation',
      }),
    ]);
  });

  it('agent approve → 422 guard(actor-is-human),确认仍 pending(I4)', async () => {
    await suspendArchive();

    const res = await POST(
      post({
        rel: 'confirmation:c1',
        action: 'approve',
        params: {},
        actor: 'agent',
        principal: 'user:mike',
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      layer: string;
      reason: string;
      detail: { name: string; pass: boolean }[];
    };
    expect(body.layer).toBe('guard-failed');
    expect(body.reason).toContain('actor-is-human');
    expect(body.detail).toEqual([expect.objectContaining({ name: 'actor-is-human', pass: false })]);

    // 留痕且状态不变(经 /api/entity 验证确认实体仍 pending)。
    const rejected = await pool.query(
      "SELECT actor FROM events WHERE kind = 'action-rejected' AND rel = 'confirmation:c1' ORDER BY seq DESC LIMIT 1",
    );
    expect(rejected.rows[0]).toMatchObject({ actor: 'agent' });
    const entityRes = await getEntity(
      new Request('http://localhost:3100/api/entity?rel=confirmation:c1'),
    );
    const entityBody = (await entityRes.json()) as { properties: Record<string, unknown> };
    expect(entityBody.properties).toMatchObject({ status: 'pending' });
  });

  it('human reject → 200,原动作永不生效;再 approve → 400 undeclared', async () => {
    await suspendArchive();

    const reject = await POST(
      post({
        rel: 'confirmation:c1',
        action: 'reject',
        params: { reason: '还要留着' },
        actor: 'human',
      }),
    );
    expect(reject.status).toBe(200);
    const rejectBody = (await reject.json()) as { entity: { properties: Record<string, unknown> } };
    expect(rejectBody.entity.properties).toMatchObject({ status: 'rejected' });

    const executed = await pool.query(
      "SELECT COUNT(*)::int AS n FROM events WHERE kind = 'action-executed' AND action = 'archive'",
    );
    expect(executed.rows[0]).toMatchObject({ n: 0 });

    const approve = await POST(
      post({ rel: 'confirmation:c1', action: 'approve', params: {}, actor: 'human' }),
    );
    expect(approve.status).toBe(400);
    const approveBody = (await approve.json()) as { layer: string };
    expect(approveBody.layer).toBe('undeclared');
  });

  it('B2 回归:human archive 直通 200,不挂起', async () => {
    const res = await POST(
      post({ rel: 'post:post-welcome', action: 'archive', params: {}, actor: 'human' }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entity: { properties: Record<string, unknown> } };
    expect(body.entity.properties).toMatchObject({
      rel: 'post:post-welcome',
      node: 'archived',
    });
    const suspended = await pool.query(
      "SELECT COUNT(*)::int AS n FROM events WHERE kind = 'confirmation-requested'",
    );
    expect(suspended.rows[0]).toMatchObject({ n: 0 });
  });
});
