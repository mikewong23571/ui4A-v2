import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';

import { fold, type LogEvent } from './fold';
import { RENDER_SPECS_REL, renderSpecRel, type RenderSpecFrozenDetail } from './render-spec';
import { project } from './siren';

// 凝固机制(T7 spec 架构决定 4):render-spec-frozen 事件 → 快照 renderSpecs
// 表(concern → 已凝固 spec);"同一关注点永远同一布局(保空间记忆锚点)"。
// fold 口径与 confirmation/delegation 同:载荷即真相 + 日志完整性响亮校验
// (rel 一致、concern 一致、重复冻结同 spec 幂等/异 spec 抛错)。
// 投影口径:render-spec:<concern> 单实体 + render-specs 集合实体(最小:
// concern 集合;画布经合同可查已凝固 spec,Phase C 接线)。

const deps = { flows: {}, guards: seedGuardRegistry };

const chartSpec = {
  concern: 'articles-by-category',
  component: 'chart',
  bind: { series: { collection: 'articles', dimension: 'articles.category' } },
};

function frozenEvent(
  seq: number,
  spec: { concern: string; component: string; bind: unknown },
  overrides?: Partial<LogEvent>,
): LogEvent {
  const detail: RenderSpecFrozenDetail = {
    concern: spec.concern,
    spec,
    requestedBy: { actor: 'agent', principal: 'user:mike' },
  };
  return {
    seq,
    kind: 'render-spec-frozen',
    rel: renderSpecRel(spec.concern),
    actor: 'agent',
    principal: 'user:mike',
    detail,
    ...overrides,
  };
}

describe('fold:render-spec-frozen 事件 → renderSpecs 表', () => {
  it('物化 concern → 已凝固 spec(载荷即真相)', () => {
    const snapshot = fold([frozenEvent(1, chartSpec)], { flows: {} });
    expect(snapshot.renderSpecs).toEqual({
      'articles-by-category': {
        concern: 'articles-by-category',
        component: 'chart',
        bind: chartSpec.bind,
        requestedBy: { actor: 'agent', principal: 'user:mike' },
      },
    });
  });

  it('同 concern 重复冻结同 spec → 幂等(首冻为准;双写者竞态安全)', () => {
    const snapshot = fold([frozenEvent(1, chartSpec), frozenEvent(2, chartSpec)], { flows: {} });
    expect(Object.keys(snapshot.renderSpecs ?? {})).toEqual(['articles-by-category']);
  });

  it('同 concern 异 spec 重复冻结 → 响亮抛错(凝固语义:同 concern 永远同一布局)', () => {
    const mutated = {
      ...chartSpec,
      bind: { series: { collection: 'comments', dimension: 'comments.status' } },
    };
    expect(() => fold([frozenEvent(1, chartSpec), frozenEvent(2, mutated)], { flows: {} })).toThrow(
      /articles-by-category/,
    );
  });

  it('detail 缺 concern / spec 缺字段 → 日志完整性抛错', () => {
    expect(() =>
      fold(
        [{ seq: 1, kind: 'render-spec-frozen', rel: renderSpecRel('x'), detail: {} }],
        { flows: {} },
      ),
    ).toThrow(/日志完整性/);
    expect(() =>
      fold(
        [
          {
            seq: 1,
            kind: 'render-spec-frozen',
            rel: renderSpecRel('x'),
            detail: { concern: 'x', spec: { component: 'chart' }, requestedBy: { actor: 'agent' } },
          },
        ],
        { flows: {} },
      ),
    ).toThrow(/concern/);
  });

  it('rel 与 concern 不一致 / spec.concern 与 detail.concern 不一致 → 抛错', () => {
    expect(() =>
      fold([frozenEvent(1, chartSpec, { rel: 'render-spec:other' })], { flows: {} }),
    ).toThrow(/不一致/);
    // detail.concern='x' 而 spec.concern='other':手工构造载荷(助手从 spec 取 concern)。
    expect(() =>
      fold(
        [
          {
            seq: 1,
            kind: 'render-spec-frozen',
            rel: renderSpecRel('x'),
            detail: {
              concern: 'x',
              spec: { ...chartSpec, concern: 'other' },
              requestedBy: { actor: 'agent' },
            },
          },
        ],
        { flows: {} },
      ),
    ).toThrow(/不一致/);
  });

  it('业务 exec 与冻结事件共存:renderSpecs 表随效果应用随行(不丢表)', () => {
    const frozen = fold([frozenEvent(1, chartSpec)], { flows: {} });
    // 直接验证 applyEffects 产物随行:用 fold 的 initial 增量路径模拟在线快照演进。
    const after = fold([], { flows: {} }, frozen);
    expect(after.renderSpecs).toEqual(frozen.renderSpecs);
  });
});

describe('投影:render-spec 实体(Siren)', () => {
  const snapshot = fold([frozenEvent(1, chartSpec)], { flows: {} });

  it('render-spec:<concern> 单实体:properties 含 concern/component/bind/requested-by', () => {
    const entity = project(snapshot, renderSpecRel('articles-by-category'), deps);
    expect(entity).toMatchObject({
      class: ['render-spec', 'frozen'],
      properties: {
        concern: 'articles-by-category',
        component: 'chart',
        bind: chartSpec.bind,
        'requested-by': { actor: 'agent', principal: 'user:mike' },
      },
    });
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=render-spec:articles-by-category' },
    ]);
  });

  it('render-specs 集合实体:count + 子实体直达(空集合同样合法)', () => {
    const entity = project(snapshot, RENDER_SPECS_REL, deps);
    expect(entity?.properties).toEqual({ rel: 'render-specs', count: 1 });
    expect(entity?.entities?.[0]).toMatchObject({
      rel: ['item'],
      href: '/api/entity?rel=render-spec:articles-by-category',
      properties: { concern: 'articles-by-category' },
    });

    const empty = project(fold([], { flows: {} }), RENDER_SPECS_REL, deps);
    expect(empty?.properties).toEqual({ rel: 'render-specs', count: 0 });
  });

  it('未冻结 concern → undefined(HTTP 层 404 口径)', () => {
    expect(project(snapshot, renderSpecRel('nope'), deps)).toBeUndefined();
  });
});
