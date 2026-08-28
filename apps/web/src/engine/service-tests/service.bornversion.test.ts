/**
 * 在途实例出生版本戳(T4 Phase B Task 3,TDD 红→绿;spec 验收 4 / DoD 5):
 * 激活新版本后活跃定义更新,但在途实例继续按出生定义走完(judge/project 按
 * bornVersion 解析);新实例出生于新版本。混合版本终态重放一致(I5)。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';
import type { SirenEntity } from '@ui4a/engine';

import { businessFlows } from '../../domain/flows';
import { ensureEventsTable, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

/** 完整激活链(revise → add-action → submit → approve);approve 由 human。 */
async function activate(
  rel: string,
  addAction: { node: string; action: { name: string; title: string; to: string } },
): Promise<void> {
  const engine = await getEngine(pool);
  for (const [action, params] of [
    ['revise', undefined],
    ['add-action', addAction],
    ['submit', undefined],
    ['approve', undefined],
  ] as const) {
    const outcome = await engine.exec({
      rel,
      action,
      actor: action === 'approve' ? 'human' : 'agent',
      principal: 'user:mike',
      ...(params !== undefined ? { params } : {}),
    });
    if (outcome.kind !== 'accepted') throw new Error(`${rel} ${action} 应通过`);
  }
}

describe('在途实例按出生定义走完(激活不迁移在途)', () => {
  it('向导进行到一半 → 激活新版本 → 该实例 next 仍按旧定义(新动作对其不可见/不可执行)', async () => {
    const engine = await getEngine(pool);
    // 走一步:basic-info → classification(此时出生于 v1)。
    await engine.exec({
      rel: 'article-drafting:main',
      action: 'next',
      params: { title: 'In Flight' },
      actor: 'agent',
      channel: 'http',
    });
    expect(engine.getSnapshot().instances['article-drafting:main']?.bornVersion).toBe(1);

    // 激活 v2:classification 增补 skip-category(→ content)。
    await activate('meta/flow:article-drafting', {
      node: 'classification',
      action: { name: 'skip-category', title: '跳过分类', to: 'content' },
    });
    expect(engine.getSnapshot().definitions?.['article-drafting']).toMatchObject({
      version: 2,
      status: 'active',
    });

    // 在途实例:投影动作面 = 出生定义 v1(无 skip-category;当前 classification 节点)。
    const wizard = (await engine.getEntity('article-drafting:main')) as SirenEntity;
    expect(wizard.actions.map((action) => action.name)).toEqual(['next']);

    // 新动作对其不可执行(undeclared;若错用活跃 v2 会被接受——判别器)。
    const skip = await engine.exec({
      rel: 'article-drafting:main',
      action: 'skip-category',
      params: {},
      actor: 'agent',
      channel: 'http',
    });
    expect(skip).toMatchObject({ kind: 'rejected', layer: 'undeclared' });

    // 旧定义继续走完:next → content。
    const next = await engine.exec({
      rel: 'article-drafting:main',
      action: 'next',
      params: { category: 'tech', tags: 'ui4a' },
      actor: 'agent',
      channel: 'http',
    });
    expect(next.kind).toBe('accepted');
    expect(engine.getSnapshot().instances['article-drafting:main']?.node).toBe('content');
  });

  it('新实例按新定义:激活 post-status v2 后,publish 派生的文章出生于 v2', async () => {
    const engine = await getEngine(pool);
    // 激活 post-status v2:published 增补 feature(→ archived)。
    await activate('meta/flow:post-status', {
      node: 'published',
      action: { name: 'feature', title: '加精', to: 'archived' },
    });

    // 旧文章(出生于 v1):feature 不可见/不可执行,unpublish 照常。
    const oldPost = (await engine.getEntity('post:post-welcome')) as SirenEntity;
    expect(oldPost.actions.map((action) => action.name)).toEqual(['unpublish', 'archive']);
    const oldFeature = await engine.exec({
      rel: 'post:post-welcome',
      action: 'feature',
      params: {},
      actor: 'agent',
      channel: 'http',
    });
    expect(oldFeature).toMatchObject({ kind: 'rejected', layer: 'undeclared' });

    // B1 向导走到 ready 后 publish(出生于 v2 的 action 面:publish 声明未变)。
    for (const [action, params] of [
      ['next', { title: 'New Article' }],
      ['next', { category: 'tech', tags: 'ui4a' }],
      ['next', { body: '正文' }],
    ] as const) {
      await engine.exec({
        rel: 'article-drafting:main',
        action,
        params,
        actor: 'agent',
        channel: 'http',
      });
    }
    const publish = await engine.exec({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: 'New Article' },
      actor: 'agent',
      channel: 'http',
    });
    expect(publish.kind).toBe('accepted');

    const snapshot = engine.getSnapshot();
    expect(snapshot.instances['post:new-article']?.bornVersion).toBe(2); // 出生于激活后的 v2
    const newFeature = await engine.exec({
      rel: 'post:new-article',
      action: 'feature',
      params: {},
      actor: 'agent',
      channel: 'http',
    });
    expect(newFeature.kind).toBe('accepted');
    expect(engine.getSnapshot().instances['post:new-article']?.node).toBe('archived');

    // 混合版本终态重放一致(I5:定义事件+出生戳+按出生解析全链参与 fold)。
    const replayed = fold(await readLog(pool), { flows: businessFlows });
    expect(contentVersion(replayed)).toBe(contentVersion(engine.getSnapshot()));
    expect(replayed.instances['post:new-article']?.bornVersion).toBe(2);
    expect(replayed.instances['post:post-welcome']?.bornVersion).toBe(1);
  });
});
