import { describe, expect, it } from 'vitest';

import type { FlowDefinition } from '@ui4a/engine';
import type { EngineSnapshot, InstanceSnapshot } from '@ui4a/shared';

import { flowInstancesCollection, resolveFlowRelAlias } from './flow-entry';

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
      snapshot(instance('post:a','post-status'), instance('post:b','post-status')),
      FLOWS,
    );
    expect(entity!.properties.count).toBe(2);
    expect(entity!.entities!.map((member) => member.properties.rel)).toEqual([
      'post:a',
      'post:b',
    ]);
    // 成员只携带实例自身投影字段,不复制目标实体内容(T26 口径同源)。
    expect(entity!.entities![0]!.properties.flow).toBe('post-status');
    expect(entity!.entities![0]!.properties.node).toBe('title');
  });

  it('carries a self link and no actions (read-only listing)', () => {
    const entity = flowInstancesCollection('flow:post-status', snapshot(instance('post:a','post-status')), FLOWS);
    expect(entity!.actions).toHaveLength(0);
    expect(entity!.links.some((link) => link.rel.includes('self'))).toBe(true);
  });

  it('returns null for non-flow rels and unknown flow names (404 honesty preserved)', () => {
    expect(flowInstancesCollection('post:a', snapshot(), FLOWS)).toBeNull();
    expect(flowInstancesCollection('flow:', snapshot(), [])).toBeNull();
  });
});
