import { describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { PageEntityCache } from './entity-cache';

function entity(rel: string, node: string): SirenEntity {
  return { class: ['instance'], properties: { rel, node }, actions: [], links: [] };
}

describe('canonical entity cache invalidation', () => {
  it('refreshes every observed alias after executing the canonical entity, keeping unrelated reads', async () => {
    let node = 'saved';
    const fetcher = vi.fn(async (rel: string) =>
      entity(rel === 'unrelated' ? rel : 'capture:main', node),
    );
    const cache = new PageEntityCache(fetcher);
    await cache.get('flow:capture', 'v1');
    await cache.get('flow:capture', 'v1', 'offset=0');
    await cache.get('capture:main', 'v1');
    await cache.get('unrelated', 'v1');
    node = 'capture';
    cache.invalidateAfterExecSources('capture:main', [entity('capture:main', node)]);
    expect((await cache.get('flow:capture', 'v1'))?.properties.node).toBe('capture');
    expect((await cache.get('flow:capture', 'v1', 'offset=0'))?.properties.node).toBe('capture');
    expect((await cache.get('capture:main', 'v1'))?.properties.node).toBe('capture');
    expect((await cache.get('unrelated', 'v1'))?.properties.node).toBe('saved');
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it('does not repopulate an invalidated entry from an older in-flight read', async () => {
    let resolveOld!: (value: SirenEntity) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SirenEntity>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue(entity('capture:main', 'capture'));
    const cache = new PageEntityCache(fetcher);
    const oldRead = cache.get('capture:main', 'v1');
    cache.invalidateAfterExec('capture:main');
    await cache.get('capture:main', 'v1');
    resolveOld(entity('capture:main', 'saved'));
    await oldRead;
    expect((await cache.get('capture:main', 'v1'))?.properties.node).toBe('capture');
  });
});
