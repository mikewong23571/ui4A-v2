import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';
import type { ExecRequest, SirenEntity } from '@ui4a/engine';
import type { LogEvent } from '@ui4a/engine';

import { businessFlows } from '../domain/flows';
import { SEED_REL } from '../domain/seed';
import { appendEvent, ensureEventsTable, readLog } from '../db/events';
import type { DbExecutor } from '../db/events';
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
    // 7 业务实例 + 3 个 lifecycle 实例(T4 Phase B:definition-seeded 落
    // meta/flow:<name> 实例,见 service.definitions.test.ts)。
    expect(Object.keys(snapshot.instances)).toHaveLength(12);
    expect(snapshot.collections.articles).toEqual(['post:post-welcome', 'post:first-post']);
    expect(snapshot.collections.comments).toHaveLength(4);
  });

  it('二次 boot(重复 seed)数据不翻倍:seed 事件仍只 1 条', async () => {
    await boot();
    resetEngineForTests();
    const second = await boot();

    expect(await seedEventCount()).toBe(1);
    expect(Object.keys(second.getSnapshot().instances)).toHaveLength(12);
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
    expect(snapshot.instances['article-drafting:main']?.node).toBe('basic-info');

    // D24 合并语义:向导三步经 set-field/参数落在实例上的 category/tags/body
    // 随 publish 并入新文章(origin 各自留痕);title 为 publish 参数。
    expect(snapshot.instances['post:new-article']?.fields).toEqual({
      title: { value: 'New Article', origin: 'intent' },
      category: { value: 'tech', origin: 'intent' },
      tags: { value: 'ui4a', origin: 'intent' },
      body: { value: '正文内容', origin: 'intent' },
    });

    // 事件对:action-executed + entity-appended(appended/collection 不落列,
    // Phase B 日志口径——fold 由 flow 定义重推导;此断言验证事件顺序与种类)。
    const tail = (await logEvents()).slice(-2);
    expect(tail.map((event) => event.kind)).toEqual(['action-executed', 'entity-appended']);
    expect(tail[0]).toMatchObject({
      rel: 'article-drafting:main',
      action: 'publish',
    });
    expect(tail[1]).toMatchObject({ rel: 'article-drafting:main', action: 'publish' });

    // I5:含 append 合并语义的在线快照与日志重放同构(合并集由重放重推导,
    // entity-appended 载荷不携带字段,fold 不读它)。
    expect(contentVersion(fold(await logEvents(), { flows: businessFlows }))).toBe(
      contentVersion(snapshot),
    );
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

    const articles = (await engine.getEntity('articles')) as SirenEntity;
    expect(articles.properties).toMatchObject({ rel: 'articles', count: 2 });
    expect(articles.entities?.map((entity) => entity.properties.rel)).toEqual([
      'post:post-welcome',
      'post:first-post',
    ]);

    const post = (await engine.getEntity('post:post-welcome')) as SirenEntity;
    expect(post.actions.map((action) => action.name)).toEqual(['unpublish', 'archive']);

    expect(await engine.getEntity('nope')).toBeUndefined();
  });

  it('guard-results 逐项注入(按钮 disabled 与 agent 同一谓词)', async () => {
    const engine = await boot();
    const comment = (await engine.getEntity('comment:c1')) as SirenEntity;

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
      'software-change',
    ]);
    expect(engine.getSitemap()).toBe(sitemap);
  });
});

describe('多写者水位:自身 append 不得跨过未折叠的外部事件(T5 Phase C 实测链路 bug)', () => {
  it('exec 落库窗口内 worker 提交的 delegation-step 被增量折叠,不被 lastSeq 跳过', async () => {
    // S3 并行实测:exec 的 refresh 与自身 INSERT 之间,worker 直接入库的外部事件
    // seq 低于自身新事件——旧实现 append 后把 lastSeq 推到自身 seq,外部事件被
    // `seq > lastSeq` 永久跳过(委托缺步 → 后续折叠层日志完整性炸、读路径 500)。
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    // 前置:委托已物化(boot 前直接入库,模拟 worker 已派发)。
    await appendEvent(pool, {
      kind: 'delegation-started',
      rel: 'delegation:delegation-race',
      actor: 'agent',
      detail: {
        delegationId: 'delegation-race',
        goal: { verb: '发布一篇文章' },
        driverKind: 'rule',
        startRel: 'articles',
      },
    });

    // 竞态注入:engine 第一次自身 INSERT 落库前,worker 先提交 delegation-step 1
    //(seq 将低于自身事件——正是并行委托踩中的窗口;注入一次即还原现场)。
    let armed = false;
    let injected = false;
    const racingDb: DbExecutor = {
      query: <R extends import('pg').QueryResultRow>(
        sqlText: string,
        values?: readonly unknown[],
      ): Promise<import('pg').QueryResult<R>> =>
        (async () => {
          if (armed && !injected && sqlText.includes('INSERT INTO events')) {
            injected = true;
            await appendEvent(pool, {
              kind: 'delegation-step',
              rel: 'delegation:delegation-race',
              actor: 'agent',
              channel: 'delegation',
              detail: {
                step: 1,
                op: { kind: 'navigate', rel: 'flow:article-drafting' },
                outcome: 'navigated',
              },
            });
          }
          return pool.query<R>(sqlText, values === undefined ? undefined : [...values]);
        })(),
    };

    const engine = await getEngine(racingDb);
    armed = true;
    const outcome = await engine.exec({
      rel: 'article-drafting:main',
      action: 'next',
      params: { title: 'Race' },
      actor: 'agent',
    });
    armed = false;
    expect(outcome.kind).toBe('accepted');

    // 修复前:step 1 被 lastSeq 跳过 → 投影 steps=0(随后 step 2 会让折叠层抛
    // 「步号不连续」);修复后:窗口内外部事件先折入再推进水位。
    const delegations = await engine.getEntity('delegations');
    const row = delegations?.entities?.find((sub) => sub.properties.id === 'delegation-race');
    expect(row?.properties.steps, '窗口内外部事件必须被折叠,不得跳过').toBe(1);

    // I5 口径:内存快照与全量重放一致(跳步会让两者漂移)。
    const replayed = fold(await readLog(pool), { flows: businessFlows });
    expect(replayed.delegations?.['delegation:delegation-race']?.steps).toBe(1);
  });

  it('freezeSpec 落库窗口内 worker 提交的外部事件同样不被跳过(终审 H-1 回归)', async () => {
    // T7 freezeSpec 曾用裸 appendEvent + lastSeq=Math.max——同样的水位窗口:
    // S5(凝固)与 S3(并行委托)并跑时,窗口内 delegation-step 会被永久跳过,
    // 后续步事件折叠即抛「步号不连续」、读路径 500。修复后走 appendWithSeq。
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE events');
    resetEngineForTests();
    await appendEvent(pool, {
      kind: 'delegation-started',
      rel: 'delegation:delegation-freeze-race',
      actor: 'agent',
      detail: {
        delegationId: 'delegation-freeze-race',
        goal: { verb: '发布一篇文章' },
        driverKind: 'rule',
        startRel: 'articles',
      },
    });

    let armed = false;
    let injected = false;
    const racingDb: DbExecutor = {
      query: <R extends import('pg').QueryResultRow>(
        sqlText: string,
        values?: readonly unknown[],
      ): Promise<import('pg').QueryResult<R>> =>
        (async () => {
          if (armed && !injected && sqlText.includes('INSERT INTO events')) {
            injected = true;
            await appendEvent(pool, {
              kind: 'delegation-step',
              rel: 'delegation:delegation-freeze-race',
              actor: 'agent',
              channel: 'delegation',
              detail: {
                step: 1,
                op: { kind: 'navigate', rel: 'flow:article-drafting' },
                outcome: 'navigated',
              },
            });
          }
          return pool.query<R>(sqlText, values === undefined ? undefined : [...values]);
        })(),
    };

    const engine = await getEngine(racingDb);
    armed = true;
    const frozen = await engine.freezeSpec('articles-by-category', {
      concern: 'articles-by-category',
      component: 'chart',
      bind: { collection: 'articles', dimension: 'articles.fields.category' },
    });
    armed = false;
    expect(frozen.frozen).toBe(true);

    // 修复前:step 1 被凝固事件的水位推进跳过 → 投影 steps=0;修复后:先收进
    // foreignGaps 再补折(凝固的在线物化之后 applyForeignGaps)。
    const delegations = await engine.getEntity('delegations');
    const row = delegations?.entities?.find(
      (sub) => sub.properties.id === 'delegation-freeze-race',
    );
    expect(row?.properties.steps, '凝固窗口内外部事件必须被折叠,不得跳过').toBe(1);

    const replayed = fold(await readLog(pool), { flows: businessFlows });
    expect(replayed.delegations?.['delegation:delegation-freeze-race']?.steps).toBe(1);
  });
});
