import { describe, expect, it } from 'vitest';

import type { FlowDefinition, SirenEntity } from '@ui4a/engine';
import type { EngineSnapshot, InstanceSnapshot } from '@ui4a/shared';

import {
  flowInstancesCollection,
  resolveFlowRelAlias,
  withCollectionFlowEntryLinks,
} from './flow-entry';

function instance(rel: string, flow = 'article-drafting'): InstanceSnapshot {
  return { rel, flow, node: 'title', fields: {} };
}

function snapshot(...instances: InstanceSnapshot[]): EngineSnapshot {
  return {
    instances: Object.fromEntries(instances.map((entry) => [entry.rel, entry])),
    collections: {},
    threads: {},
  };
}

const FLOWS: FlowDefinition[] = [
  { name: 'post-status', title: '文章状态', nodes: [] } as unknown as FlowDefinition,
];

describe('flow entry alias honesty', () => {
  it('resolves only one live instance and does not invent a zero/multi-instance fallback', () => {
    expect(resolveFlowRelAlias('flow:article-drafting', snapshot())).toBeUndefined();
    expect(resolveFlowRelAlias('flow:article-drafting', snapshot(instance('draft:one')))).toBe(
      'draft:one',
    );
    expect(
      resolveFlowRelAlias(
        'flow:article-drafting',
        snapshot(instance('draft:one'), instance('draft:two')),
      ),
    ).toBeUndefined();
  });

  it('does not resolve empty or unrelated rels', () => {
    expect(resolveFlowRelAlias('flow:', snapshot(instance('draft:one')))).toBeUndefined();
    expect(resolveFlowRelAlias('post:one', snapshot(instance('draft:one')))).toBeUndefined();
  });
});

describe('flow instances collection projection (T35 F-02)', () => {
  it('projects zero-instance flows as an honest empty collection', () => {
    const entity = flowInstancesCollection('flow:post-status', snapshot(), FLOWS);
    expect(entity).not.toBeNull();
    expect(entity!.class).toContain('collection');
    expect(entity!.properties.rel).toBe('flow:post-status');
    expect(entity!.properties.count).toBe(0);
    expect(entity!.entities).toHaveLength(0);
  });

  it('lists every live instance for multi-instance flows without inventing truth', () => {
    const entity = flowInstancesCollection(
      'flow:post-status',
      snapshot(instance('post:a', 'post-status'), instance('post:b', 'post-status')),
      FLOWS,
    );
    expect(entity!.properties.count).toBe(2);
    expect(entity!.entities!.map((member) => member.properties.rel)).toEqual(['post:a', 'post:b']);
    // 成员只携带实例自身投影字段,不复制目标实体内容(T26 口径同源)。
    expect(entity!.entities![0]!.properties.flow).toBe('post-status');
    expect(entity!.entities![0]!.properties.node).toBe('title');
  });

  it('carries a self link and no actions (read-only listing)', () => {
    const entity = flowInstancesCollection(
      'flow:post-status',
      snapshot(instance('post:a', 'post-status')),
      FLOWS,
    );
    expect(entity!.actions).toHaveLength(0);
    expect(entity!.links.some((link) => link.rel.includes('self'))).toBe(true);
  });

  it('returns null for non-flow rels and unknown flow names (404 honesty preserved)', () => {
    expect(flowInstancesCollection('post:a', snapshot(), FLOWS)).toBeNull();
    expect(flowInstancesCollection('flow:', snapshot(), [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 集合 → flow 入口回链(T37 FR1:可推导者补齐,不可推导者诚实缺链)
// ---------------------------------------------------------------------------

/** 带 append 效果的向导 flow(publish → articles),口径同 bundle article-drafting。 */
const ARTICLE_DRAFTING: FlowDefinition = {
  name: 'article-drafting',
  title: '文章发布向导',
  initial: 'ready',
  nodes: [
    {
      name: 'ready',
      title: '就绪',
      actions: [
        {
          name: 'publish',
          title: '发布',
          to: 'done',
          effect: [{ type: 'append', collection: 'articles' }],
        },
      ],
    },
    { name: 'done', title: '完成', actions: [] },
  ],
};

function collectionEntity(rel: string): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, count: 0 },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
  };
}

describe('collection flow entry links (T37 FR1)', () => {
  it('wizard scenario: collection with an append-effect flow gains the flow entry link', () => {
    const entity = withCollectionFlowEntryLinks(collectionEntity('articles'), [
      ARTICLE_DRAFTING,
      ...FLOWS,
    ]);
    expect(entity.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=articles' },
      { rel: ['flow'], href: '/api/entity?rel=flow%3Aarticle-drafting', title: '文章发布向导' },
    ]);
  });

  it('no-append collection honestly keeps its links (no invented flow link)', () => {
    // comments 无任何 flow 以 append 效果指向它(纯 seed 通道)——缺链即真相。
    const before = collectionEntity('comments');
    const entity = withCollectionFlowEntryLinks(before, [ARTICLE_DRAFTING, ...FLOWS]);
    expect(entity.links).toEqual([{ rel: ['self'], href: '/api/entity?rel=comments' }]);
  });
});
