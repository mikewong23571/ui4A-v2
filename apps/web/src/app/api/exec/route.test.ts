import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { POST } from './route';

// /api/exec 契约测试(spec FR4 / DoD):
// - POST {rel,action,params,actor,principal,channel} → 200 {entity:受影响实体};
// - 三层各拒绝 → 400/422 {layer,reason,detail?}(与日志 action-rejected 同源);
// - 请求形状非法 → 400 结构化错误。
const REAL_DATABASE_URL = process.env.DATABASE_URL;
const BAD_URL = 'postgres://ui4a:ui4a@localhost:5999/ui4a';
const pool = getPool(REAL_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

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

describe('POST /api/exec', () => {
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
