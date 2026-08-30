import { beforeEach, describe, expect, it } from 'vitest';

import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable, listEvents } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../../engine/service';
import { POST as businessExecPost } from '../../exec/route';

import { POST } from './route';

// /_meta/api/exec 契约测试(T4 Phase B Task 2,TDD 红→绿;spec 验收 2 合同级):
// - 编辑动词/approve/reject 过同一引擎(executeMeta)、同一日志、同一串行队列;
// - 非法定义(add-action 的 to 指向不存在节点)→ 422 guard 层拒绝,且
//   action-rejected 入 /api/events 留痕(拒绝即数据 I6,带原因);
// - 跨站规则:非 meta rel → 404;业务站 /api/exec 对 meta rel → 404。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

function post(body: unknown, query = ''): Request {
  return new Request(`http://localhost:3100/_meta/api/exec${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
});

describe('POST /_meta/api/exec', () => {
  it('revise(active → draft):200,返回定义实体(status=draft,actions=编辑动词)', async () => {
    const res = await POST(
      post({
        rel: 'meta/flow:post-status',
        action: 'revise',
        actor: 'agent',
        principal: 'user:mike',
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entity: { properties: { status: string }; actions: { name: string }[] };
    };
    expect(body.entity.properties.status).toBe('draft');
    expect(body.entity.actions.map((action) => action.name)).toEqual([
      'add-node',
      'add-action',
      'submit',
    ]);
  });

  it('非法定义:add-action(to 指向不存在节点)→ 422 且 /api/events 留痕带原因(DoD 3)', async () => {
    await POST(post({ rel: 'meta/flow:article-drafting', action: 'revise', actor: 'agent' }));
    const res = await POST(
      post({
        rel: 'meta/flow:article-drafting',
        action: 'add-action',
        actor: 'agent',
        params: {
          node: 'ready',
          action: { name: 'pin', title: '置顶', to: 'nonexistent-node' },
        },
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { layer: string; reason: string };
    expect(body.layer).toBe('guard-failed');
    expect(body.reason).toContain('to-exists=false');

    // 留痕:同源 action-rejected 事件(rel=meta/flow:…,reason 与 HTTP 响应一致)。
    const stored = await listEvents(pool);
    const last = stored.at(-1);
    expect(last).toMatchObject({
      kind: 'action-rejected',
      rel: 'meta/flow:article-drafting',
      action: 'add-action',
      actor: 'agent',
      reason: body.reason,
    });
    expect(last?.detail).toMatchObject({ layer: 'guard-failed' });
  });

  it('请求形状非法 → 400(缺 action / rel 非字符串 / 坏 actor / 坏 principal)', async () => {
    expect((await POST(post({ rel: 'meta/flow:post-status' }))).status).toBe(400);
    expect((await POST(post({ rel: 1, action: 'revise' }))).status).toBe(400);
    expect(
      (await POST(post({ rel: 'meta/flow:post-status', action: 'revise', actor: 'robot' }))).status,
    ).toBe(400);
    expect(
      (await POST(post({ rel: 'meta/flow:post-status', action: 'revise', principal: 42 }))).status,
    ).toBe(400);
  });

  it('跨站规则:非 meta rel → 404;业务 /api/exec 对 meta rel → 404', async () => {
    const metaSite = await POST(post({ rel: 'post:post-welcome', action: 'unpublish' }));
    expect(metaSite.status).toBe(404);

    const business = await businessExecPost(
      new Request('http://localhost:3100/api/exec', {
        method: 'POST',
        body: JSON.stringify({ rel: 'meta/flow:post-status', action: 'revise', actor: 'agent' }),
      }),
    );
    expect(business.status).toBe(404);
    const body = (await business.json()) as { error: string };
    expect(body.error).toContain('_meta');
  });

  it('browser-style request gets server-owned human identity and a forged ?scope= is dropped (D51)', async () => {
    // 越界声明(root-admin)在身份解析层被静默丢弃,请求与未带 scope 完全同型,
    // 动作照常经三段裁决受理。
    const accepted = await POST(
      new Request('http://localhost:3100/_meta/api/exec?scope=root-admin', {
        method: 'POST',
        body: JSON.stringify({ rel: 'meta/flow:post-status', action: 'revise' }),
      }),
    );
    expect(accepted.status).toBe(200);
    const event = (await listEvents(pool)).at(-1);
    expect(event).toMatchObject({
      actor: 'human',
      principal: 'local-user',
      channel: 'bios',
      detail: {
        identity: {
          authorizationMode: 'self-reported-local-demo',
          humanApprovalEligible: true,
        },
      },
    });

    // D51:?scope= 不再是鉴权输入——越界声明静默丢弃,动作照常过三段裁决。
  });

  it('rejects a forged Draft scope while using navigation preference only as trusted context', async () => {
    const response = await POST(
      post(
        {
          rel: 'meta/drafts',
          action: 'create',
          actor: 'agent',
          principal: 'local-user',
          params: {
            kind: 'flow-definition',
            target: 'post-status',
            policyScope: 'development',
            commandId: 'route-server-owned-scope',
            payload: { name: 'post-status' },
          },
        },
        '?scope=publishing',
      ),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ layer: 'schema-invalid' });
  });
});
