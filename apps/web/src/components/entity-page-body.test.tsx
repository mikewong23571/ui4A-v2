// @vitest-environment jsdom
/**
 * 实体页主体的页面级缓存接线测试(T12 Phase B Task 2 / spec 架构决定 3、验收 5)。
 *
 * - 取数改经 EntityCacheProvider 的页面级缓存:同 rel 二次渲染(卸载重挂)
 *   零重复 fetch,version 一致性戳每页面会话只取一次;
 * - exec 成功 → 精确失效(当前 rel + 真实所属 collection,实体回链)后
 *   tick 重拉当前实体(整面 reload 兜底保留):新鲜投影上屏,所属集合下次
 *   读取重取;
 * - 拒绝不失效不重取(诚实失败口径不变)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { EntityPageBody } from './entity-page-body';
import {
  EntityCacheProvider,
  useEntityCache,
  type EntityCacheHandle,
} from './entity-cache-provider';

// ---- fixtures(形状与 /api/entity 的 Siren 投影一致)-------------------------

const publishAction: SirenAction = {
  name: 'publish',
  title: '发布',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

function instance(rel: string, title: string): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    properties: { rel, flow: 'post-status', node: 'draft', title, fields: {} },
    actions: [publishAction],
    links: [
      { rel: ['self'], href: `/api/entity?rel=${rel}` },
      { rel: ['collection'], href: '/api/entity?rel=articles' },
    ],
    'guard-results': [{ action: 'publish', blocked: false, guards: [] }],
  };
}

function collection(rel: string): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, count: 0 },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
    'guard-results': [],
    entities: [],
  };
}

/** 计数 fetcher:rel → 实体字典应答(可中途换数据模拟 exec 后的新投影)。 */
function countingFetcher(entities: Record<string, SirenEntity>) {
  const fetcher = vi.fn(async (rel: string): Promise<SirenEntity | null> => entities[rel] ?? null);
  return { fetcher, callsOf: (rel: string) => fetcher.mock.calls.filter(([arg]) => arg === rel) };
}

/** exec 成功应答(全局 fetch 只服务 /api/exec;实体读取走注入 fetcher)。 */
function stubExecOk(entity: SirenEntity) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ entity }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** 预读集合的消费方探针(同页另一 surface 的替身:共享同一页面缓存)。 */
function createCollectionProbe() {
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EntityPageBody:页面级缓存接入', () => {
  it('同 rel 二次渲染(同 provider 内卸载重挂)零重复 fetch;version 只取一次', async () => {
    const entities = { 'post:post-welcome': instance('post:post-welcome', '第一版') };
    const { fetcher, callsOf } = countingFetcher(entities);
    const versionFetcher = vi.fn(async () => 'v1');

    function Tree({ mounted }: { mounted: boolean }) {
      return (
        <EntityCacheProvider fetcher={fetcher} versionFetcher={versionFetcher}>
          {mounted ? <EntityPageBody rel="post:post-welcome" /> : null}
        </EntityCacheProvider>
      );
    }

    const view = render(<Tree mounted={true} />);
    await screen.findByRole('heading', { name: '第一版' });
    expect(callsOf('post:post-welcome')).toHaveLength(1);

    view.rerender(<Tree mounted={false} />);
    view.rerender(<Tree mounted={true} />);
    await screen.findByRole('heading', { name: '第一版' });

    expect(callsOf('post:post-welcome')).toHaveLength(1);
    expect(versionFetcher).toHaveBeenCalledTimes(1);
  });

  it('exec 成功 → 当前 rel 与真实所属 collection 失效重取,新鲜投影上屏(reload 兜底)', async () => {
    const entities = {
      'post:post-welcome': instance('post:post-welcome', '第一版'),
      articles: collection('articles'),
    };
    const { fetcher, callsOf } = countingFetcher(entities);
    const versionFetcher = vi.fn(async () => 'v1');
    vi.stubGlobal('fetch', stubExecOk(instance('post:post-welcome', '第二版')));
    const probe = createCollectionProbe();

    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={versionFetcher}>
        <EntityPageBody rel="post:post-welcome" />
        <probe.Probe />
      </EntityCacheProvider>,
    );
    await screen.findByRole('heading', { name: '第一版' });
    // 同页另一 surface 预读所属集合(画布多 surface 共享场景的替身)。
    await probe.handle().get('articles');
    expect(callsOf('articles')).toHaveLength(1);

    // exec 成功 → 缓存失效 + tick 重拉;服务端投影已变(第二版)。
    entities['post:post-welcome'] = instance('post:post-welcome', '第二版');
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await screen.findByRole('heading', { name: '第二版' });

    // 当前 rel 失效重取(旧缓存不上屏);version 不重取。
    expect(callsOf('post:post-welcome')).toHaveLength(2);
    expect(versionFetcher).toHaveBeenCalledTimes(1);
    // 真实所属 collection(实体回链 articles,非前缀候选 'post')已失效:
    // 同页 surface 下次读取重取。
    await probe.handle().get('articles');
    expect(callsOf('articles')).toHaveLength(2);
  });

  it('exec 拒绝 → 如实呈现且不失效不重取(诚实失败口径不变)', async () => {
    const entities = { 'post:post-welcome': instance('post:post-welcome', '第一版') };
    const { fetcher, callsOf } = countingFetcher(entities);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ layer: 'guard-failed', reason: 'guard 不满足' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={async () => 'v1'}>
        <EntityPageBody rel="post:post-welcome" />
      </EntityCacheProvider>,
    );
    await screen.findByRole('heading', { name: '第一版' });

    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('guard-failed');

    // 拒绝路径零实体重取(缓存原样,无失效)。
    await waitFor(() => expect(callsOf('post:post-welcome')).toHaveLength(1));
  });
});
