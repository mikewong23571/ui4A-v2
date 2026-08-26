import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, InstanceSnapshot } from '@ui4a/shared';

import { resolveFlowRelAlias } from './flow-entry';

function instance(rel: string): InstanceSnapshot {
  return { rel, flow: 'article-drafting', node: 'title', fields: {} };
}

function snapshot(...instances: InstanceSnapshot[]): EngineSnapshot {
  return {
    instances: Object.fromEntries(instances.map((entry) => [entry.rel, entry])),
    collections: {},
    threads: {},
  };
}

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
