/**
 * meta 平面服务编排(T4 Phase B Task 2,TDD 红→绿):
 * service.exec 对 meta/ rel 路由到 executeMeta(同一引擎/日志/串行队列);
 * 定义激活链(revise → add-action → submit → approve)后 sitemap 版本自动变化
 * (活跃定义集内容 hash——S2 的根基,DoD 4);agent approve 被拒且留痕(I4 延伸)。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';

import { businessFlows } from '../domain/flows';
import { ensureEventsTable, listEvents, readLog } from '../db/events';
import { getPool } from '../db/pool';

import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

/** 经 service.exec 走 meta 动作(与 /_meta/api/exec 同一入口)。 */
async function metaExec(
  request: Parameters<Awaited<ReturnType<typeof getEngine>>['exec']>[0],
) {
  const engine = await getEngine(pool);
  return engine.exec(request);
}

describe('meta exec 编排(service.exec 的 meta/ 前缀路由)', () => {
  it('agent approve → 422 actor-is-human 拒且留痕(I4 延伸;审批不委托)', async () => {
    // 先到 pending-approval(revise → add-action → submit)。
    await metaExec({ rel: 'meta/flow:post-status', action: 'revise', actor: 'agent' });
    await metaExec({
      rel: 'meta/flow:post-status',
      action: 'add-action',
      actor: 'agent',
      params: {
        node: 'published',
        action: { name: 'feature', title: '加精', to: 'archived' },
      },
    });
    await metaExec({ rel: 'meta/flow:post-status', action: 'submit', actor: 'agent' });

    const outcome = await metaExec({
      rel: 'meta/flow:post-status',
      action: 'approve',
      actor: 'agent',
      principal: 'user:mike',
    });
    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    if (outcome.kind !== 'rejected') return;
    expect(outcome.reason).toContain('actor-is-human=false');

    const stored = await listEvents(pool);
    expect(stored.at(-1)).toMatchObject({
      kind: 'action-rejected',
      rel: 'meta/flow:post-status',
      action: 'approve',
      reason: outcome.reason,
    });
  });

  it('激活链后 sitemap version 变化且新动作可见(DoD 4:激活即重生成,零人工)', async () => {
    const engine = await getEngine(pool);
    const before = engine.getSitemap();
    const beforeVersion = before.version;
    expect(
      before.flows
        .find((flow) => flow.name === 'post-status')
        ?.nodes.find((node) => node.name === 'published')
        ?.actions.map((action) => action.name),
    ).toEqual(['unpublish', 'archive']);

    for (const [action, params] of [
      ['revise', undefined],
      ['add-action', { node: 'published', action: { name: 'feature', title: '加精', to: 'archived' } }],
      ['submit', undefined],
      ['approve', undefined],
    ] as const) {
      const outcome = await metaExec({
        rel: 'meta/flow:post-status',
        action,
        actor: action === 'approve' ? 'human' : 'agent',
        ...(params !== undefined ? { params } : {}),
      });
      if (outcome.kind !== 'accepted') throw new Error(`${action} 应通过`);
    }

    // 激活后:活跃定义 v2;sitemap 版本变化,feature 进入动作面。
    const snapshot = engine.getSnapshot();
    expect(snapshot.definitions?.['post-status']).toMatchObject({ version: 2, status: 'active' });
    const after = engine.getSitemap();
    expect(after.version).not.toBe(beforeVersion);
    expect(after.version).toMatch(/^[0-9a-f]{12}$/);
    expect(
      after.flows
        .find((flow) => flow.name === 'post-status')
        ?.nodes.find((node) => node.name === 'published')
        ?.actions.map((action) => action.name),
    ).toEqual(['unpublish', 'archive', 'feature']);

    // 业务平面立即可用新动作(同引擎同快照):v1 在途实例按出生定义走完
    // (feature 对其 undeclared,见 service.bornversion.test);出生于 v2 的
    // 新实例(B1 publish 派生)则即刻可用 feature——S2 的根基。
    for (const [action, params] of [
      ['next', { title: 'New Article' }],
      ['next', { category: 'tech', tags: 'ui4a' }],
      ['next', { body: '正文内容' }],
      ['publish', { title: 'New Article' }],
    ] as const) {
      const step = await engine.exec({
        rel: 'article-drafting:main',
        action,
        params,
        actor: 'agent',
        channel: 'http',
      });
      if (step.kind !== 'accepted') throw new Error(`${action} 应通过`);
    }
    expect(engine.getSnapshot().instances['post:new-article']?.bornVersion).toBe(2);
    const outcome = await engine.exec({
      rel: 'post:new-article',
      action: 'feature',
      params: {},
      actor: 'agent',
      channel: 'http',
    });
    expect(outcome.kind).toBe('accepted');
    expect(engine.getSnapshot().instances['post:new-article']?.node).toBe('archived');
  });

  it('在线激活链与 fold 重放一致(I5:定义事件参与 fold)', async () => {
    const engine = await getEngine(pool);

    for (const [action, params] of [
      ['revise', undefined],
      ['add-action', { node: 'published', action: { name: 'feature', title: '加精', to: 'archived' } }],
      ['submit', undefined],
      ['approve', undefined],
    ] as const) {
      await metaExec({
        rel: 'meta/flow:post-status',
        action,
        actor: action === 'approve' ? 'human' : 'agent',
        ...(params !== undefined ? { params } : {}),
      });
    }

    const replayed = fold(await readLog(pool), { flows: businessFlows });
    expect(contentVersion(replayed)).toBe(contentVersion(engine.getSnapshot()));
    expect(replayed.definitions?.['post-status']?.version).toBe(2);
  });
});
