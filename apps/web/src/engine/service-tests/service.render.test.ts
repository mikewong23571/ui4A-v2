import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold, readRenderSpecsOf } from '@ui4a/engine';

import { businessFlows } from '../../domain/flows';
import { ensureEventsTable, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { fieldRef, type RenderSpec } from '../../render/spec';

import { getEngine, resetEngineForTests } from '../service';

// 凝固机制服务层集成测试(T7 Phase A Task 3,真 PG):
// freezeSpec 经串行队列:零字面校验 + 词名校验 → appendEvent
// (render-spec-frozen,detail={concern,spec,requestedBy})→ 增量快照;
// 同 concern 二次请求返回已凝固(首冻为准,不产生第二条事件——
// "同一关注点永远同一布局");查询 API 与 /api/entity 投影同源;
// 重放确定性(I5 口径):全量 fold 与在线快照 renderSpecs 一致。

const CONNECTION_STRING = process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a';
const pool = getPool(CONNECTION_STRING);

/** 校验入口吃不可信输入:非法形状经一次显式断言进入(测试注入用)。 */
const asSpec = (value: unknown): RenderSpec => value as RenderSpec;

const chartSpec = asSpec({
  concern: 'articles-by-category',
  component: 'chart',
  bind: { series: { collection: 'articles', dimension: 'articles.category' } },
});

const statSpec = asSpec({
  concern: 'home-welcome-title',
  component: 'stat',
  bind: { value: { field: fieldRef('post:post-welcome', 'title') } },
});

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('freezeSpec:凝固(首冻为准)', () => {
  it('首次冻结:事件留痕 + 快照表 + 返回 spec(frozen=true)', async () => {
    const engine = await getEngine(pool);
    const result = await engine.freezeSpec(chartSpec.concern, chartSpec, {
      actor: 'agent',
      principal: 'user:mike',
    });
    expect(result.frozen).toBe(true);
    expect(result.spec).toEqual(chartSpec);

    const log = await readLog(pool);
    const events = log.filter((event) => event.kind === 'render-spec-frozen');
    expect(events).toHaveLength(1);
    expect(events[0]?.rel).toBe('render-spec:articles-by-category');
    expect(events[0]?.actor).toBe('agent');
    expect(events[0]?.detail).toMatchObject({
      concern: 'articles-by-category',
      spec: chartSpec,
      requestedBy: { actor: 'agent', principal: 'user:mike' },
    });

    expect(engine.getSnapshot().renderSpecs?.['articles-by-category']?.component).toBe('chart');
  });

  it('同 concern 二次请求 → 返回已凝固同 spec,不追加事件(frozen=false)', async () => {
    const engine = await getEngine(pool);
    await engine.freezeSpec(chartSpec.concern, chartSpec, { actor: 'agent' });

    const mutated = {
      ...chartSpec,
      bind: { series: { collection: 'comments', dimension: 'comments.status' } },
    };
    const second = await engine.freezeSpec(chartSpec.concern, mutated, { actor: 'agent' });
    expect(second.frozen).toBe(false);
    expect(second.spec).toEqual(chartSpec); // 首冻为准,不接受改版

    const events = (await readLog(pool)).filter((event) => event.kind === 'render-spec-frozen');
    expect(events).toHaveLength(1);
  });

  it('多 concern 各自独立凝固', async () => {
    const engine = await getEngine(pool);
    await engine.freezeSpec(chartSpec.concern, chartSpec, { actor: 'agent' });
    await engine.freezeSpec(statSpec.concern, statSpec, { actor: 'human' });

    const frozen = readRenderSpecsOf(engine.getSnapshot());
    expect(frozen.map((entry) => entry.concern).sort()).toEqual([
      'articles-by-category',
      'home-welcome-title',
    ]);
  });
});

describe('freezeSpec:入口校验(不合法不入日志)', () => {
  it('裸字面 spec → 抛错(零字面剃刀),无事件', async () => {
    const engine = await getEngine(pool);
    await expect(
      engine.freezeSpec('bad', asSpec({ concern: 'bad', component: 'stat', bind: { value: 42 } }), {
        actor: 'agent',
      }),
    ).rejects.toThrow(/字面|校验/);
    expect((await readLog(pool)).filter((e) => e.kind === 'render-spec-frozen')).toHaveLength(0);
  });

  it('未知词名 → 抛错(词汇表即目录),无事件', async () => {
    const engine = await getEngine(pool);
    await expect(
      engine.freezeSpec('bad', asSpec({ concern: 'bad', component: 'nope', bind: {} }), {
        actor: 'agent',
      }),
    ).rejects.toThrow(/词条|component/);
    expect((await readLog(pool)).filter((e) => e.kind === 'render-spec-frozen')).toHaveLength(0);
  });

  it('concern 参数与 spec.concern 不一致 → 抛错(凝固键一致)', async () => {
    const engine = await getEngine(pool);
    await expect(engine.freezeSpec('other-key', chartSpec, { actor: 'agent' })).rejects.toThrow(
      /concern/,
    );
  });
});

describe('凝固 spec 查询与投影(合同可见)', () => {
  it('getFrozenSpec/listFrozenSpecs:冻结后可查,未冻结 undefined', async () => {
    const engine = await getEngine(pool);
    expect(engine.getFrozenSpec('articles-by-category')).toBeUndefined();
    await engine.freezeSpec(chartSpec.concern, chartSpec, { actor: 'agent' });
    expect(engine.getFrozenSpec('articles-by-category')).toEqual(chartSpec);
    expect(engine.listFrozenSpecs().map((entry) => entry.concern)).toEqual([
      'articles-by-category',
    ]);
  });

  it('getEntity:render-spec:<concern> 与 render-specs 集合可查', async () => {
    const engine = await getEngine(pool);
    await engine.freezeSpec(chartSpec.concern, chartSpec, { actor: 'agent' });

    const single = await engine.getEntity('render-spec:articles-by-category');
    expect(single?.properties).toMatchObject({
      concern: 'articles-by-category',
      component: 'chart',
    });

    const collectionEntity = await engine.getEntity('render-specs');
    expect(collectionEntity?.properties).toEqual({ rel: 'render-specs', count: 1 });
  });
});

describe('重放确定性(I5 口径):凝固表与全量 fold 同构', () => {
  it('在线快照 renderSpecs 与 fold(全日志) 逐项一致(内容 hash)', async () => {
    const engine = await getEngine(pool);
    await engine.freezeSpec(chartSpec.concern, chartSpec, { actor: 'agent' });
    await engine.freezeSpec(statSpec.concern, statSpec, { actor: 'human' });

    const log = await readLog(pool);
    const replayed = fold(log, { flows: businessFlows });
    const online = await engine.readSnapshot();
    expect(contentVersion(readRenderSpecsOf(online))).toBe(
      contentVersion(readRenderSpecsOf(replayed)),
    );
  });
});
