import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';
import type { ExecRequest, SirenEntity } from '@ui4a/engine';
import type { LogEvent } from '@ui4a/engine';

import { businessFlows } from '../domain/flows';
import { SEED_REL } from '../domain/seed';
import { ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';

import { getEngine, resetEngineForTests } from './service';

// 引擎服务层测试(T2 Phase C / Task C2):
// - boot = 建表 + 幂等 seed(查重后才 append)+ fold(日志)→ 快照;
// - exec = judge → 拒绝:appendEvent(action-rejected) 不改状态;通过:applyEffects
//   → appendEvent(s) → 增量持有新快照;
// - 串行化:模块级 promise 队列保证 exec 单 atom,并发无交错(裁决器即并发控制);
// - getEntity/project 与 sitemap 缓存接线。
// 真库(docker PG);beforeEach TRUNCATE + reset 后重 seed,测试自清理。
const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);

async function boot() {
  return getEngine(pool);
}

async function logEvents(): Promise<LogEvent[]> {
  return readLog(pool);
}

async function seedEventCount(): Promise<number> {
  const events = await logEvents();
  return events.filter((event) => event.kind === 'seed' && event.rel === SEED_REL).length;
}

/** 走完 B1 三步向导到 ready(每步严格按字段 schema 填参)。 */
async function advanceWizardToReady(): Promise<void> {
  const engine = await boot();
  await engine.exec({
    rel: 'article-drafting:main',
    action: 'next',
    params: { title: 'New Article' },
    actor: 'agent',
    principal: 'user:mike',
    channel: 'http',
  });
  await engine.exec({
    rel: 'article-drafting:main',
    action: 'next',
    params: { category: 'tech', tags: 'ui4a' },
    actor: 'agent',
    principal: 'user:mike',
    channel: 'http',
  });
  await engine.exec({
    rel: 'article-drafting:main',
    action: 'next',
    params: { body: '正文内容' },
    actor: 'agent',
    principal: 'user:mike',
    channel: 'http',
  });
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('boot:建表 + 幂等 seed + fold', () => {
  it('空库启动:seed 一次,fold 出种子快照', async () => {
    const engine = await boot();

    expect(await seedEventCount()).toBe(1);
    const snapshot = engine.getSnapshot();
    expect(Object.keys(snapshot.instances)).toHaveLength(7);
    expect(snapshot.collections.articles).toEqual(['post:post-welcome', 'post:first-post']);
    expect(snapshot.collections.comments).toHaveLength(4);
  });

  it('二次 boot(重复 seed)数据不翻倍:seed 事件仍只 1 条', async () => {
    await boot();
    resetEngineForTests();
    const second = await boot();

    expect(await seedEventCount()).toBe(1);
    expect(Object.keys(second.getSnapshot().instances)).toHaveLength(7);
    expect(second.getSnapshot().collections.articles).toHaveLength(2);
  });

  it('TRUNCATE 后重启:重新 seed(1 条),快照恢复', async () => {
    await boot();
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    await boot();

    expect(await seedEventCount()).toBe(1);
  });

  it('boot 幂等:同 db 重复 getEngine 返回同一实例', async () => {
    const first = await boot();
    const second = await boot();
    expect(second).toBe(first);
  });
});

describe('exec:三层裁决 → 事件 → 增量快照', () => {
  it('通过:approve 落 action-executed,快照与投影更新', async () => {
    const engine = await boot();
    const before = (await logEvents()).length;

    const outcome = await engine.exec({
      rel: 'comment:c1',
      action: 'approve',
      params: {},
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    expect(outcome.entity.properties).toMatchObject({ rel: 'comment:c1', node: 'approved' });
    expect(outcome.appended).toEqual([]);

    const events = await logEvents();
    expect(events).toHaveLength(before + 1);
    // 注:to/appended 不落列(Phase B 日志口径:fold 由定义重推导),经快照断言。
    expect(events.at(-1)).toMatchObject({
      kind: 'action-executed',
      rel: 'comment:c1',
      action: 'approve',
      actor: 'agent',
      principal: 'user:mike',
    });
    expect(engine.getSnapshot().instances['comment:c1']?.node).toBe('approved');
  });

  it('声明层拒绝:未声明动作 → 事件留痕,状态不变', async () => {
    const engine = await boot();
    const outcome = await engine.exec({
      rel: 'comment:c1',
      action: 'explode',
      params: {},
      actor: 'agent',
    });

    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    const events = await logEvents();
    expect(events.at(-1)).toMatchObject({
      kind: 'action-rejected',
      rel: 'comment:c1',
      action: 'explode',
    });
    expect(engine.getSnapshot().instances['comment:c1']?.node).toBe('pending');
  });

  it('guard 层拒绝:重名 publish → is-pending 式状态拒绝且不改状态', async () => {
    await advanceWizardToReady();
    const engine = await boot();

    const outcome = await engine.exec({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: '欢迎来到 UI4A' },
      actor: 'agent',
    });

    expect(outcome).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      reason: expect.stringContaining('title-not-taken'),
    });
    expect(engine.getSnapshot().collections.articles).toHaveLength(2);
    expect(engine.getSnapshot().instances['article-drafting:main']?.node).toBe('ready');
  });

  it('schema 层拒绝:缺必填 title → ajv 错误入 detail', async () => {
    const engine = await boot();
    const outcome = await engine.exec({
      rel: 'article-drafting:main',
      action: 'next',
      params: {},
      actor: 'agent',
    });

    expect(outcome).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    expect(engine.getSnapshot().instances['article-drafting:main']?.node).toBe('basic-info');
  });

  it('拒绝事件的 detail 携带 layer(日志与 HTTP 响应同源的存储侧)', async () => {
    const engine = await boot();
    const outcome = await engine.exec({
      rel: 'nope',
      action: 'approve',
      params: {},
      actor: 'agent',
    });
    if (outcome.kind !== 'rejected') throw new Error('应被拒绝');

    const last = (await logEvents()).at(-1);
    expect(last).toMatchObject({ kind: 'action-rejected', reason: outcome.reason });
    expect(last?.detail).toMatchObject({ layer: 'undeclared' });
  });

  it('完整 B1:向导三步 + publish → append 新文章进 articles(2→3)', async () => {
    await advanceWizardToReady();
    const engine = await boot();

    const outcome = await engine.exec({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: 'New Article' },
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    });

    expect(outcome.kind).toBe('accepted');
    if (outcome.kind !== 'accepted') return;
    // 受影响实体 = 新追加的文章(不是向导实例)。
    expect(outcome.entity.properties).toMatchObject({ rel: 'post:new-article', node: 'published' });
    expect(outcome.appended).toEqual(['post:new-article']);

    const snapshot = engine.getSnapshot();
    expect(snapshot.collections.articles).toEqual([
      'post:post-welcome',
      'post:first-post',
      'post:new-article',
    ]);
    expect(snapshot.instances['article-drafting:main']?.node).toBe('done');

    // 事件对:action-executed + entity-appended(appended/collection 不落列,
    // Phase B 日志口径——fold 由 flow 定义重推导;此断言验证事件顺序与种类)。
    const tail = (await logEvents()).slice(-2);
    expect(tail.map((event) => event.kind)).toEqual(['action-executed', 'entity-appended']);
    expect(tail[0]).toMatchObject({
      rel: 'article-drafting:main',
      action: 'publish',
    });
    expect(tail[1]).toMatchObject({ rel: 'article-drafting:main', action: 'publish' });
  });
});

describe('串行化:exec 单 atom(裁决器即并发控制)', () => {
  it('同一评论并发 approve ×2:恰一成功一拒绝,终态 approved', async () => {
    const engine = await boot();
    const request: ExecRequest = {
      rel: 'comment:c1',
      action: 'approve',
      params: {},
      actor: 'agent',
      channel: 'http',
    };

    const outcomes = await Promise.all([engine.exec(request), engine.exec(request)]);
    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds).toEqual(['accepted', 'rejected']);
    expect(engine.getSnapshot().instances['comment:c1']?.node).toBe('approved');

    // 日志:1 执行 + 1 拒绝,无交错损坏。
    const events = (await logEvents()).filter(
      (event) => event.kind === 'action-executed' || event.kind === 'action-rejected',
    );
    expect(events.filter((event) => event.kind === 'action-executed')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'action-rejected')).toHaveLength(1);
  });

  it('不同实例并发 exec 全部成功,增量快照与 fold(日志) hash 一致', async () => {
    const engine = await boot();
    const outcomes = await Promise.all([
      engine.exec({
        rel: 'comment:c1',
        action: 'approve',
        params: {},
        actor: 'agent',
        channel: 'http',
      }),
      engine.exec({
        rel: 'comment:c2',
        action: 'reject',
        params: {},
        actor: 'agent',
        channel: 'http',
      }),
      engine.exec({
        rel: 'comment:c3',
        action: 'approve',
        params: {},
        actor: 'agent',
        channel: 'http',
      }),
      engine.exec({
        rel: 'post:post-welcome',
        action: 'unpublish',
        params: {},
        actor: 'human',
        channel: 'http',
      }),
    ]);

    expect(outcomes.every((outcome) => outcome.kind === 'accepted')).toBe(true);
    const snapshot = engine.getSnapshot();
    expect(snapshot.instances['comment:c1']?.node).toBe('approved');
    expect(snapshot.instances['comment:c2']?.node).toBe('rejected');
    expect(snapshot.instances['comment:c3']?.node).toBe('approved');
    expect(snapshot.instances['post:post-welcome']?.node).toBe('offline');

    // 增量路径与重放路径同构(I5 语义在服务层成立)。
    const replayed = fold(await logEvents(), { flows: businessFlows });
    expect(contentVersion(replayed)).toBe(contentVersion(snapshot));
  });

  it('并发混战:4 路对 3 条 pending 评论,队列清零且恰 1 路被拒', async () => {
    const engine = await boot();
    const outcomes = await Promise.all([
      engine.exec({ rel: 'comment:c1', action: 'approve', params: {}, actor: 'agent' }),
      engine.exec({ rel: 'comment:c2', action: 'approve', params: {}, actor: 'agent' }),
      engine.exec({ rel: 'comment:c3', action: 'approve', params: {}, actor: 'agent' }),
      engine.exec({ rel: 'comment:c3', action: 'reject', params: {}, actor: 'agent' }),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === 'accepted')).toHaveLength(3);
    expect(outcomes.filter((outcome) => outcome.kind === 'rejected')).toHaveLength(1);

    const snapshot = engine.getSnapshot();
    const pending = Object.values(snapshot.instances).filter((i) => i.node === 'pending');
    expect(pending).toHaveLength(0);
    // c3 恰好迁移一次(approve 或 reject,不双写)。
    expect(['approved', 'rejected']).toContain(snapshot.instances['comment:c3']?.node);
  });
});

describe('投影与 sitemap 接线', () => {
  it('getEntity:集合/实例/未知', async () => {
    const engine = await boot();

    const articles = engine.getEntity('articles') as SirenEntity;
    expect(articles.properties).toMatchObject({ rel: 'articles', count: 2 });
    expect(articles.entities?.map((entity) => entity.properties.rel)).toEqual([
      'post:post-welcome',
      'post:first-post',
    ]);

    const post = engine.getEntity('post:post-welcome') as SirenEntity;
    expect(post.actions.map((action) => action.name)).toEqual(['unpublish', 'archive']);

    expect(engine.getEntity('nope')).toBeUndefined();
  });

  it('guard-results 逐项注入(按钮 disabled 与 agent 同一谓词)', async () => {
    const engine = await boot();
    const comment = engine.getEntity('comment:c1') as SirenEntity;

    const results = comment['guard-results'] ?? [];
    expect(results.map((entry) => entry.action)).toEqual(['approve', 'reject']);
    for (const entry of results) {
      expect(entry.blocked).toBe(false);
      expect(entry.guards).toEqual([{ name: 'is-pending', pass: true }]);
    }
  });

  it('sitemap 缓存:同对象引用,版本与表面齐备', async () => {
    const engine = await boot();
    const sitemap = engine.getSitemap();

    expect(sitemap.version).toMatch(/^[0-9a-f]{12}$/);
    expect(sitemap.surfaces.map((surface) => surface.rel)).toEqual(
      expect.arrayContaining(['flow:article-drafting', 'articles', 'comments']),
    );
    expect(sitemap.flows.map((flow) => flow.name)).toEqual([
      'article-drafting',
      'post-status',
      'comment-moderation',
    ]);
    expect(engine.getSitemap()).toBe(sitemap);
  });
});
