/**
 * 定义 seed 迁移(T4 Phase B Task 1,TDD 红→绿;spec 架构决定 5)。
 *
 * boot 口径:日志无 definition-seeded → 三个业务 flow 以 machine-as-JSON 全文
 * 入日志(seeded 即 active,v1);引擎的业务 exec/judge/project/sitemap 从此吃
 * fold 快照的活跃定义(代码常量仅 seed 源 + sitemap 顺序锚)。
 * 旧库迁移:业务 seed 在前、定义追加尾部;在途实例由 fold 回溯盖出生版本。
 * 真库(docker PG);beforeEach TRUNCATE + reset 后重 seed,测试自清理。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { FlowDefinition, LogEvent, SirenEntity } from '@ui4a/engine';

import { businessFlows, businessFlowList } from '../domain/flows';
import { SEED_REL, seedDetail } from '../domain/seed';
import { appendEvent, ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';

import { getEngine, resetEngineForTests } from './service';

const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);

async function boot() {
  return getEngine(pool);
}

async function definitionSeeds(): Promise<LogEvent[]> {
  return (await readLog(pool)).filter((event) => event.kind === 'definition-seeded');
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('boot:定义 seed 迁移(空库)', () => {
  it('三 flow definition-seeded 入日志:rel=meta/flow:<name>,detail 全文 + active v1', async () => {
    await boot();
    const seeds = await definitionSeeds();
    expect(seeds.map((event) => event.rel)).toEqual([
      'meta/flow:article-drafting',
      'meta/flow:post-status',
      'meta/flow:comment-moderation',
    ]);
    for (const [index, flow] of businessFlowList.entries()) {
      expect(seeds[index]?.detail).toEqual({
        name: flow.name,
        version: 1,
        status: 'active',
        definition: flow,
      });
    }
  });

  it('fold 快照:definitions 三条目 active v1 + lifecycle 实例(node=active)', async () => {
    const engine = await boot();
    const snapshot = engine.getSnapshot();
    for (const flow of businessFlowList) {
      expect(snapshot.definitions?.[flow.name]).toMatchObject({
        name: flow.name,
        version: 1,
        status: 'active',
      });
      expect(snapshot.instances[`meta/flow:${flow.name}`]).toMatchObject({
        rel: `meta/flow:${flow.name}`,
        flow: 'definition-lifecycle',
        node: 'active',
      });
    }
  });

  it('boot 幂等:重复 boot 不再追加 definition-seeded(仍 3 条)', async () => {
    await boot();
    resetEngineForTests();
    await boot();
    expect(await definitionSeeds()).toHaveLength(3);
  });
});

describe('旧库迁移(业务 seed 在前,定义追加尾部)', () => {
  it('definition-seeded 追加在既有日志之后;在途实例回溯盖 bornVersion=1', async () => {
    await appendEvent(pool, { kind: 'seed', rel: SEED_REL, detail: seedDetail });
    await boot();

    const log = await readLog(pool);
    expect(log[0]?.kind).toBe('seed');
    expect(log.filter((event) => event.kind === 'definition-seeded')).toHaveLength(3);

    const snapshot = (await boot()).getSnapshot();
    expect(snapshot.instances['post:post-welcome']?.bornVersion).toBe(1);
    expect(snapshot.instances['article-drafting:main']?.bornVersion).toBe(1);
    expect(snapshot.instances['comment:c1']?.bornVersion).toBe(1);
  });
});

describe('引擎从日志读活跃定义(代码常量仅 seed 源)', () => {
  /** 修改版 post-status:published 节点加 feature 动作(仅存在于日志,不在常量)。 */
  const featurePostStatus: FlowDefinition = JSON.parse(
    JSON.stringify(businessFlows['post-status']!),
  );
  {
    const published = featurePostStatus.nodes.find((node) => node.name === 'published')!;
    published.actions.push({ name: 'feature', title: '加精', to: 'archived' });
  }

  async function bootWithLoggedDefinition(): Promise<void> {
    await appendEvent(pool, {
      kind: 'definition-seeded',
      rel: 'meta/flow:post-status',
      detail: { name: 'post-status', version: 1, status: 'active', definition: featurePostStatus },
    });
    await appendEvent(pool, { kind: 'seed', rel: SEED_REL, detail: seedDetail });
    await boot();
  }

  it('exec 吃日志定义:feature 动作可执行(常量里没有它)', async () => {
    await bootWithLoggedDefinition();
    const engine = await boot();

    const outcome = await engine.exec({
      rel: 'post:post-welcome',
      action: 'feature',
      params: {},
      actor: 'human',
      channel: 'http',
    });
    expect(outcome.kind).toBe('accepted');
    expect(engine.getSnapshot().instances['post:post-welcome']?.node).toBe('archived');
  });

  it('project 吃日志定义:实体 actions 含 feature;sitemap 同样含 feature', async () => {
    await bootWithLoggedDefinition();
    const engine = await boot();

    const post = (await engine.getEntity('post:post-welcome')) as SirenEntity;
    expect(post.actions.map((action) => action.name)).toContain('feature');

    const sitemap = engine.getSitemap();
    const published = sitemap.flows
      .find((flow) => flow.name === 'post-status')
      ?.nodes.find((node) => node.name === 'published');
    expect(published?.actions.map((action) => action.name)).toContain('feature');
  });
});

describe('B1 行为不变(定义来自日志后零回归)', () => {
  it('三步向导 + publish:append 文章进 articles(2→3)', async () => {
    const engine = await boot();
    for (const [action, params] of [
      ['next', { title: 'New Article' }],
      ['next', { category: 'tech', tags: 'ui4a' }],
      ['next', { body: '正文内容' }],
      ['publish', { title: 'New Article' }],
    ] as const) {
      const outcome = await engine.exec({
        rel: 'article-drafting:main',
        action,
        params,
        actor: 'agent',
        principal: 'user:mike',
        channel: 'http',
      });
      expect(outcome.kind).toBe('accepted');
    }
    const snapshot = engine.getSnapshot();
    expect(snapshot.collections.articles).toEqual([
      'post:post-welcome',
      'post:first-post',
      'post:new-article',
    ]);
  });

  it('sitemap:缓存同引用;surfaces/flows 不含 _meta 面(跨站规则)', async () => {
    const engine = await boot();
    const sitemap = engine.getSitemap();
    expect(engine.getSitemap()).toBe(sitemap);
    for (const surface of sitemap.surfaces) {
      expect(surface.rel.startsWith('meta/')).toBe(false);
      expect(surface.rel.startsWith('_meta')).toBe(false);
    }
  });
});
