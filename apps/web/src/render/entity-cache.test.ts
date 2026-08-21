import { describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { collectionRelOf, PageEntityCache, type EntityFetcher } from './entity-cache';

// 页面级实体缓存(T12 Phase B Task 1 / spec 架构决定 3):rel 索引 +
// sitemap version 一致性戳。version 变 → 全量失效;exec 成功 → 精确失效
// 当前 rel + 所属 collection rel(宁可多失效不可脏读,I2);读 miss 经
// 既有 /api/entity 取数路径填充(测试以注入 fetcher 计数替代真实 fetch)。

function entity(rel: string, fields: Record<string, unknown> = {}): SirenEntity {
  return { class: ['instance'], properties: { rel, ...fields }, actions: [], links: [] };
}

function collection(rel: string, members: SirenEntity[]): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, count: members.length },
    actions: [],
    links: [],
    entities: members,
  };
}

/** 计数 fetcher:以 rel → 实体字典应答,模拟 /api/entity(未知 rel → null)。 */
function countingFetcher(entities: Record<string, SirenEntity>) {
  const fetcher = vi.fn(async (rel: string): Promise<SirenEntity | null> => {
    return entities[rel] ?? null;
  });
  return { fetcher: fetcher as EntityFetcher, calls: fetcher.mock.calls };
}

describe('所属 collection 推导口径(collectionRelOf)', () => {
  it('实体 rel `<collection>:<name>` → 前缀为所属集合', () => {
    expect(collectionRelOf('post:post-welcome')).toBe('post');
    expect(collectionRelOf('comment:c1')).toBe('comment');
    expect(collectionRelOf('meta/flow:article-drafting')).toBe('meta/flow');
  });

  it('集合 rel(不含 ":")→ 自身', () => {
    expect(collectionRelOf('articles')).toBe('articles');
    expect(collectionRelOf('inbox')).toBe('inbox');
  });
});

describe('页面级实体缓存:读路径', () => {
  it('同 rel 二次读零重复 fetch(命中缓存)', async () => {
    const articles = collection('articles', [entity('post:post-welcome')]);
    const { fetcher, calls } = countingFetcher({ articles });
    const cache = new PageEntityCache(fetcher);

    const first = await cache.get('articles', 'v1');
    const second = await cache.get('articles', 'v1');

    expect(first).toBe(articles);
    expect(second).toBe(articles);
    expect(calls).toHaveLength(1);
  });

  it('不同 rel 各自经 /api/entity 取数一次', async () => {
    const { fetcher, calls } = countingFetcher({
      articles: collection('articles', []),
      comments: collection('comments', []),
    });
    const cache = new PageEntityCache(fetcher);

    await cache.get('articles', 'v1');
    await cache.get('comments', 'v1');

    expect(calls).toHaveLength(2);
  });

  it('并发读同 rel 只发一次 fetch(inflight 去重)', async () => {
    const { fetcher, calls } = countingFetcher({ inbox: collection('inbox', []) });
    const cache = new PageEntityCache(fetcher);

    const [a, b] = await Promise.all([cache.get('inbox', 'v1'), cache.get('inbox', 'v1')]);

    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('实体不存在(null / 404)不缓存:二次读再次取数(宁可多取不可脏读)', async () => {
    const { fetcher, calls } = countingFetcher({});
    const cache = new PageEntityCache(fetcher);

    expect(await cache.get('ghost', 'v1')).toBeNull();
    expect(await cache.get('ghost', 'v1')).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe('页面级实体缓存:version 一致性戳', () => {
  it('version 变 → 全量失效(所有 rel 重取,含未执行 exec 的 rel)', async () => {
    const { fetcher, calls } = countingFetcher({
      articles: collection('articles', []),
      comments: collection('comments', []),
    });
    const cache = new PageEntityCache(fetcher);

    await cache.get('articles', 'v1');
    await cache.get('comments', 'v1');
    expect(calls).toHaveLength(2);

    // 定义/拓扑变化(投影口径可能变):所有缓存条目作废,不止单个 rel。
    await cache.get('articles', 'v2');
    await cache.get('comments', 'v2');
    expect(calls).toHaveLength(4);
  });

  it('version 不变 → 不失效(同 version 重复读仍零重复 fetch)', async () => {
    const { fetcher, calls } = countingFetcher({ articles: collection('articles', []) });
    const cache = new PageEntityCache(fetcher);

    await cache.get('articles', 'v1');
    await cache.get('articles', 'v1');
    await cache.get('articles', 'v1');
    expect(calls).toHaveLength(1);
  });
});

describe('页面级实体缓存:exec 后精确失效', () => {
  it('失效当前 rel + 所属 collection rel,其他 rel 不失效', async () => {
    const { fetcher, calls } = countingFetcher({
      'articles:a1': entity('articles:a1', { title: 'A1' }),
      articles: collection('articles', [entity('articles:a1')]),
      'comments:c1': entity('comments:c1', { body: 'C1' }),
      comments: collection('comments', [entity('comments:c1')]),
    });
    const cache = new PageEntityCache(fetcher);

    await cache.get('articles:a1', 'v1');
    await cache.get('articles', 'v1');
    await cache.get('comments:c1', 'v1');
    await cache.get('comments', 'v1');
    expect(calls).toHaveLength(4);

    cache.invalidateAfterExec('articles:a1');

    // 当前 rel 与所属集合重取;
    await cache.get('articles:a1', 'v1');
    await cache.get('articles', 'v1');
    expect(calls).toHaveLength(6);
    // 无关 rel(兄弟集合及其成员)命中缓存,零重复 fetch。
    await cache.get('comments:c1', 'v1');
    await cache.get('comments', 'v1');
    expect(calls).toHaveLength(6);
  });

  it('集合 rel 自身 exec → 仅失效自身(无前缀集合可扩散)', async () => {
    const { fetcher, calls } = countingFetcher({
      articles: collection('articles', []),
      comments: collection('comments', []),
    });
    const cache = new PageEntityCache(fetcher);

    await cache.get('articles', 'v1');
    await cache.get('comments', 'v1');
    expect(calls).toHaveLength(2);

    cache.invalidateAfterExec('articles');

    await cache.get('articles', 'v1');
    expect(calls).toHaveLength(3);
    await cache.get('comments', 'v1');
    expect(calls).toHaveLength(3);
  });

  it('失效后重取拿到新数据(不残留旧投影)', async () => {
    const stale = collection('articles', []);
    const fresh = collection('articles', [entity('articles:a1')]);
    const fetcher = vi
      .fn(async (): Promise<SirenEntity | null> => stale)
      .mockResolvedValueOnce(stale);
    const cache = new PageEntityCache(fetcher as EntityFetcher);

    expect(await cache.get('articles', 'v1')).toBe(stale);
    cache.invalidateAfterExec('articles');
    fetcher.mockResolvedValue(fresh);
    expect(await cache.get('articles', 'v1')).toBe(fresh);
  });
});

describe('页面级实体缓存:deref 消费视图', () => {
  it('snapshot() 暴露 rel → 实体映射(渲染器私有 EntityCache 形状)', async () => {
    const articles = collection('articles', []);
    const { fetcher } = countingFetcher({ articles });
    const cache = new PageEntityCache(fetcher);

    await cache.get('articles', 'v1');

    expect(cache.snapshot().get('articles')).toBe(articles);
    expect(cache.snapshot().size).toBe(1);
  });
});
