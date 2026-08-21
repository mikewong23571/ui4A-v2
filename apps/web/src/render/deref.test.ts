import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { dimensionRef, entityRef, fieldRef, type RenderSpec } from './spec';
import { deref, derefSpec, type EntityCache } from './deref';

// 解引用器(T7 Phase A Task 1 / spec 架构决定 2):纯函数
// (bind 树, entityCache) → props;聚合(分组计数)在解引用器内做,
// spec 只声明维度引用。缺引用/缺字段响亮抛错(事实永不发明)。

function entity(rel: string, properties: Record<string, unknown>): SirenEntity {
  return { class: ['instance'], properties, actions: [], links: [] };
}

function collection(rel: string, members: SirenEntity[]): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, count: members.length },
    actions: [],
    links: [],
    entities: members.map((member) => ({ ...member, rel: ['item'] })),
  };
}

function fixtureCache(): EntityCache {
  const welcome = entity('post:post-welcome', {
    title: 'Welcome to UI4A',
    category: 'tech',
    meta: { region: 'cn-north', rank: 1 },
  });
  const started = entity('post:post-getting-started', {
    title: 'Getting Started',
    category: 'essay',
  });
  const third = entity('post:post-third', { title: 'Third', category: 'tech' });
  return new Map<string, SirenEntity>([
    ['post:post-welcome', welcome],
    ['post:post-getting-started', started],
    ['post:post-third', third],
    ['posts', collection('posts', [welcome, started, third])],
  ]);
}

describe('解引用器:引用节点', () => {
  it('field 引用 → 实体字段值', () => {
    const value = deref({ field: fieldRef('post:post-welcome', 'title') }, fixtureCache());
    expect(value).toBe('Welcome to UI4A');
  });

  it('field 嵌套 path(点号逐层下钻)', () => {
    const value = deref({ field: fieldRef('post:post-welcome', 'meta.region') }, fixtureCache());
    expect(value).toBe('cn-north');
  });

  it('field 数字值原样返回(数值来自实体,不是模型)', () => {
    const value = deref({ field: fieldRef('post:post-welcome', 'meta.rank') }, fixtureCache());
    expect(value).toBe(1);
  });

  it('ref 引用 → 实体本身(渲染器拥有数据模型)', () => {
    const cache = fixtureCache();
    const value = deref({ ref: entityRef('post:post-welcome') }, cache);
    expect(value).toBe(cache.get('post:post-welcome'));
  });

  it('collection 引用(无 dimension)→ 成员实体数组', () => {
    const cache = fixtureCache();
    const value = deref({ collection: 'posts' }, cache);
    expect(Array.isArray(value)).toBe(true);
    const members = value as SirenEntity[];
    expect(members).toHaveLength(3);
    expect(members[0]?.properties.title).toBe('Welcome to UI4A');
    expect(members[2]?.properties.category).toBe('tech');
  });

  it('collection + dimension → 分组计数(chart 数据源)', () => {
    const value = deref(
      { collection: 'posts', dimension: dimensionRef('posts', 'category') },
      fixtureCache(),
    );
    expect(value).toEqual([
      { key: 'tech', count: 2 },
      { key: 'essay', count: 1 },
    ]);
  });

  it('dimension 嵌套 path 分组同样成立', () => {
    const cache = new Map<string, SirenEntity>([
      [
        'posts',
        collection('posts', [
          entity('a', { meta: { category: 'tech' } }),
          entity('b', { meta: { category: 'tech' } }),
          entity('c', { meta: { category: 'essay' } }),
        ]),
      ],
    ]);
    const value = deref(
      { collection: 'posts', dimension: dimensionRef('posts', 'meta.category') },
      cache,
    );
    expect(value).toEqual([
      { key: 'tech', count: 2 },
      { key: 'essay', count: 1 },
    ]);
  });

  it('dimension path 全员缺失 → 响亮失败(不静默置零;事实永不发明)', () => {
    expect(() =>
      deref({ collection: 'posts', dimension: dimensionRef('posts', 'meta.category') }, fixtureCache()),
    ).toThrow(/meta\.category|meta/);
  });

  it('dimension 分组保持首次出现顺序(集合 append 序,确定性)', () => {
    const cache = new Map<string, SirenEntity>([
      [
        'posts',
        collection('posts', [
          entity('a', { category: 'zeta' }),
          entity('b', { category: 'alpha' }),
          entity('c', { category: 'zeta' }),
          entity('d', { category: 'alpha' }),
          entity('e', { category: 'mid' }),
        ]),
      ],
    ]);
    const value = deref({ collection: 'posts', dimension: dimensionRef('posts', 'category') }, cache);
    expect(value).toEqual([
      { key: 'zeta', count: 2 },
      { key: 'alpha', count: 2 },
      { key: 'mid', count: 1 },
    ]);
  });
});

describe('解引用器:结构容器', () => {
  it('字典递归解引用(props 形状与 bind 同构)', () => {
    const value = deref(
      {
        heading: { field: fieldRef('post:post-welcome', 'title') },
        rows: [{ field: fieldRef('posts', 'count') }],
      },
      fixtureCache(),
    );
    expect(value).toEqual({ heading: 'Welcome to UI4A', rows: [3] });
  });

  it('spec 级解引用:derefSpec 返回整个 bind 的 props', () => {
    const spec: RenderSpec = {
      concern: 'home-status',
      component: 'stat',
      bind: { value: { field: fieldRef('posts', 'count') } },
    };
    expect(derefSpec(spec, fixtureCache())).toEqual({ value: 3 });
  });
});

describe('解引用器:响亮失败(事实永不发明)', () => {
  it('引用实体不在缓存 → throw 带路径信息', () => {
    expect(() => deref({ field: fieldRef('post:missing', 'title') }, fixtureCache())).toThrow(
      /post:missing/,
    );
    expect(() => deref({ ref: entityRef('post:missing') }, fixtureCache())).toThrow(/post:missing/);
  });

  it('字段 path 不存在 → throw 带字段名', () => {
    expect(() => deref({ field: fieldRef('post:post-welcome', 'nope') }, fixtureCache())).toThrow(
      /nope/,
    );
  });

  it('dimension path 在某成员缺失 → throw(不静默丢成员)', () => {
    const cache = new Map<string, SirenEntity>([
      [
        'posts',
        collection('posts', [
          entity('a', { category: 'x' }),
          entity('b', { other: 'y' }),
        ]),
      ],
    ]);
    expect(() =>
      deref({ collection: 'posts', dimension: dimensionRef('posts', 'category') }, cache),
    ).toThrow(/category/);
  });

  it('collection 实体无 entities(非集合)→ throw', () => {
    expect(() => deref({ collection: 'post:post-welcome' }, fixtureCache())).toThrow(/post:post-welcome/);
  });
});
