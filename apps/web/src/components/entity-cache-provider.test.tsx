// @vitest-environment jsdom
/**
 * 页面级实体缓存承载(T12 Phase B Task 2 / spec 架构决定 3)的组件测试。
 *
 * 断言承载语义:
 * - 同 provider(= 同页面)多消费方共享同一 PageEntityCache:同 rel 二次读
 *   零重复 fetch;version 一致性戳每 provider 只取一次;
 * - exec 精确失效:当前 rel + 真实所属 collection(实体 links 回链优先,
 *   无回链回退前缀推导)失效重取,无关 rel 不动;
 * - 跨 provider(= 跨页面)不共享;
 * - version 取数失败:读取如实拒绝,且不焊死(下次读取重试)。
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import {
  EntityCacheProvider,
  useEntityCache,
  type EntityCacheHandle,
} from './entity-cache-provider';

function entity(rel: string, fields: Record<string, unknown> = {}): SirenEntity {
  return { class: ['instance'], properties: { rel, ...fields }, actions: [], links: [] };
}

function withCollectionBacklink(instance: SirenEntity, collection: string): SirenEntity {
  instance.links = [
    { rel: ['self'], href: `/api/entity?rel=${instance.properties.rel}` },
    { rel: ['collection'], href: `/api/entity?rel=${collection}` },
  ];
  return instance;
}

/** 计数 fetcher:rel → 实体字典应答(模拟 /api/entity;未知 rel → null)。 */
function countingFetcher(entities: Record<string, SirenEntity>) {
  const fetcher = vi.fn(async (rel: string): Promise<SirenEntity | null> => entities[rel] ?? null);
  return { fetcher, callsOf: (rel: string) => fetcher.mock.calls.filter(([arg]) => arg === rel) };
}

/** 捕获 provider 内的缓存句柄(测试经句柄直读,组件只是宿主)。 */
function createHandleCapture() {
  let captured: EntityCacheHandle | undefined;
  function Probe() {
    captured = useEntityCache();
    return null;
  }
  const handle = (): EntityCacheHandle => {
    if (captured === undefined) throw new Error('probe 未挂载,句柄不可得');
    return captured;
  };
  return { Probe, handle };
}

afterEach(() => {
  cleanup();
});

describe('EntityCacheProvider:同页共享与 version 一致性戳', () => {
  it('同 rel 二次读零重复 fetch;version 每 provider 只取一次', async () => {
    const articles = entity('articles');
    const { fetcher, callsOf } = countingFetcher({ articles });
    const versionFetcher = vi.fn(async () => 'v1');
    const { Probe, handle } = createHandleCapture();

    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={versionFetcher}>
        <Probe />
      </EntityCacheProvider>,
    );

    expect(await handle().get('articles')).toBe(articles);
    expect(await handle().get('articles')).toBe(articles);
    expect(callsOf('articles')).toHaveLength(1);
    expect(versionFetcher).toHaveBeenCalledTimes(1);
  });

  it('version 变化经 provider 重挂载生效(新实例全量重取)', async () => {
    const articles = entity('articles');
    const { fetcher, callsOf } = countingFetcher({ articles });
    const first = createHandleCapture();
    const second = createHandleCapture();

    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
        <first.Probe />
      </EntityCacheProvider>,
    );
    await first.handle().get('articles');
    cleanup();

    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v2'}>
        <second.Probe />
      </EntityCacheProvider>,
    );
    await second.handle().get('articles');

    expect(callsOf('articles')).toHaveLength(2);
  });

  it('跨 provider 不共享(两实例各自取数)', async () => {
    const articles = entity('articles');
    const { fetcher, callsOf } = countingFetcher({ articles });
    const first = createHandleCapture();
    const second = createHandleCapture();

    render(
      <>
        <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
          <first.Probe />
        </EntityCacheProvider>
        <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
          <second.Probe />
        </EntityCacheProvider>
      </>,
    );

    await first.handle().get('articles');
    await second.handle().get('articles');
    expect(callsOf('articles')).toHaveLength(2);
  });
});

describe('EntityCacheProvider:exec 后精确失效', () => {
  it('实体回链给出真实所属 collection:当前 rel + collection 失效重取,无关 rel 不动', async () => {
    const instance = withCollectionBacklink(entity('post:post-welcome'), 'articles');
    const articles = entity('articles');
    const comments = entity('comments');
    const { fetcher, callsOf } = countingFetcher({
      'post:post-welcome': instance,
      articles,
      comments,
    });
    const { Probe, handle } = createHandleCapture();
    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
        <Probe />
      </EntityCacheProvider>,
    );

    await handle().get('post:post-welcome');
    await handle().get('articles');
    await handle().get('comments');
    expect(fetcher).toHaveBeenCalledTimes(3);

    // exec 成功(以 exec 时页面持有的实体投影解析真实归属)。
    handle().invalidateAfterExec('post:post-welcome', instance);

    await handle().get('post:post-welcome');
    await handle().get('articles');
    expect(callsOf('post:post-welcome')).toHaveLength(2);
    expect(callsOf('articles')).toHaveLength(2);
    await handle().get('comments');
    expect(callsOf('comments')).toHaveLength(1);
  });

  it('无回链实体 → 前缀推导兜底(当前 rel 失效,集合自身 exec 仅失效自身)', async () => {
    const confirmation = entity('confirmation:c1');
    const inbox = entity('inbox');
    const { fetcher, callsOf } = countingFetcher({ 'confirmation:c1': confirmation, inbox });
    const { Probe, handle } = createHandleCapture();
    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
        <Probe />
      </EntityCacheProvider>,
    );

    await handle().get('confirmation:c1');
    await handle().get('inbox');
    expect(fetcher).toHaveBeenCalledTimes(2);

    // 确认实体无 collection 回链(self/target);前缀候选 'confirmation' 不在
    // 缓存是 no-op(安全方向);当前 rel 精确失效。
    handle().invalidateAfterExec('confirmation:c1', confirmation);
    await handle().get('confirmation:c1');
    expect(callsOf('confirmation:c1')).toHaveLength(2);
    await handle().get('inbox');
    expect(callsOf('inbox')).toHaveLength(1);

    // 集合自身 exec:无前缀可扩散,仅失效自身。
    handle().invalidateAfterExec('inbox', inbox);
    await handle().get('inbox');
    expect(callsOf('inbox')).toHaveLength(2);
  });

  it('version 取数失败:读取如实拒绝,后续读取重试(不焊死)', async () => {
    const articles = entity('articles');
    const { fetcher, callsOf } = countingFetcher({ articles });
    const versionFetcher = vi
      .fn(async () => 'v2')
      .mockRejectedValueOnce(new Error('sitemap 数据库不可用'));
    const { Probe, handle } = createHandleCapture();
    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={versionFetcher}>
        <Probe />
      </EntityCacheProvider>,
    );

    await expect(handle().get('articles')).rejects.toThrow('sitemap 数据库不可用');
    expect(await handle().get('articles')).toBe(articles);
    expect(versionFetcher).toHaveBeenCalledTimes(2);
    expect(callsOf('articles')).toHaveLength(1);
  });
});
