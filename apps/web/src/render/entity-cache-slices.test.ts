import { expect, it, vi } from 'vitest';
import type { SirenEntity } from '@ui4a/engine';
import { PageEntityCache } from './entity-cache';

function slice(rel: string, count: number): SirenEntity {
  return {
    class: ['collection'],
    properties: { rel, count },
    actions: [],
    links: [{ rel: ['collection'], href: '/api/entity?rel=source-items' }],
    entities: [],
  };
}

it.each(['source-items', 'item:one'])(
  'invalidates observed read slices after %s changes, including an empty slice and query variants',
  async (rel) => {
    let count = 0;
    const fetcher = vi.fn(async (key: string) => slice(key, count));
    const cache = new PageEntityCache(fetcher);
    await cache.get('current-items', 'v1');
    await cache.get('current-items', 'v1', 'offset=10');
    await cache.get('past-items', 'v1');
    await cache.get('unrelated', 'v1');
    // Only the first three are read slices of the mutated collection.
    cache.snapshot().get('unrelated')!.links = [];
    count = 1;
    cache.invalidateAfterExecSources(rel, [slice(rel, count)]);
    for (const [key, query] of [
      ['current-items', undefined],
      ['current-items', 'offset=10'],
      ['past-items', undefined],
    ]) {
      expect((await cache.get(key!, 'v1', query))?.properties.count).toBe(1);
    }
    expect((await cache.get('unrelated', 'v1'))?.properties.count).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(7);
  },
);
