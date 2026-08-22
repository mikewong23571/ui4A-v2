// @vitest-environment jsdom
/**
 * 首页主体的页面级缓存接线测试(T12 Phase B Task 3 / spec 架构决定 3/4、验收 5)。
 *
 * - 取数经 EntityCacheProvider 的页面级缓存:四集合各取一次,version 一致性戳
 *   每页面会话只取一次;首屏渲染口径不变(成员链接/态势 stat 与实体对拍);
 * - 同 rel 二次渲染(同 provider 内卸载重挂)零重复 fetch(缓存命中);
 * - /api/events 是事件投影而非实体,不入实体缓存:每轮挂载直取。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { stubBrowserApis } from '@/test/browser-stubs';

import { EntityCacheProvider } from './entity-cache-provider';
import { HomeBody } from './home-body';

stubBrowserApis();

// ---- fixtures(形状与 /api/entity 的 Siren 投影一致)-------------------------

function member(rel: string, node: string, title: string): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    rel: ['item'],
    href: `/api/entity?rel=${encodeURIComponent(rel)}`,
    properties: { rel, node, title: node, fields: { title } },
    actions: [],
    links: [],
  };
}

const articles: SirenEntity = {
  class: ['collection', 'articles'],
  properties: { rel: 'articles', count: 1 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
  'guard-results': [],
  entities: [member('post:post-welcome', 'published', '欢迎来到 UI4A')],
};

const comments: SirenEntity = {
  class: ['collection', 'comments'],
  properties: { rel: 'comments', count: 1 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=comments' }],
  'guard-results': [],
  entities: [member('comment:c1', 'pending', '好文章')],
};

const inbox: SirenEntity = {
  class: ['collection', 'inbox'],
  properties: { rel: 'inbox', count: 0 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=inbox' }],
  'guard-results': [],
  entities: [],
};

const delegations: SirenEntity = {
  class: ['collection', 'delegations'],
  properties: { rel: 'delegations', count: 1 },
  actions: [],
  links: [],
  entities: [
    {
      class: ['delegation'],
      properties: { rel: 'delegation:a', status: 'running' },
      actions: [],
      links: [],
    },
  ],
};

/** 计数 fetcher:rel → 实体字典应答(模拟 /api/entity;未知 rel → null)。 */
function countingFetcher() {
  const entities: Record<string, SirenEntity> = { articles, comments, inbox, delegations };
  const fetcher = vi.fn(async (rel: string): Promise<SirenEntity | null> => entities[rel] ?? null);
  return { fetcher, callsOf: (rel: string) => fetcher.mock.calls.filter(([arg]) => arg === rel) };
}

/** 事件投影桩(全局 fetch 只服务 /api/events;实体读取走注入 fetcher)。 */
function stubEvents() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  stubBrowserApis();
});

describe('HomeBody:页面级缓存接入', () => {
  it('取数经页面级缓存:四集合各取一次,version 一致性戳只取一次;首屏口径不变', async () => {
    const { fetcher, callsOf } = countingFetcher();
    const versionFetcher = vi.fn(async () => 'v1');
    vi.stubGlobal('fetch', stubEvents());

    render(
      <EntityCacheProvider fetcher={fetcher} versionFetcher={versionFetcher}>
        <HomeBody />
      </EntityCacheProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/共 1 篇/)).toBeTruthy();
    });
    expect(callsOf('articles')).toHaveLength(1);
    expect(callsOf('comments')).toHaveLength(1);
    expect(callsOf('inbox')).toHaveLength(1);
    expect(callsOf('delegations')).toHaveLength(1);
    expect(versionFetcher).toHaveBeenCalledTimes(1);

    // 首屏行为不变:成员链接上屏;态势 stat 与实体投影对拍(count/running)。
    expect(screen.getByText(/欢迎来到 UI4A/)).toBeTruthy();
    expect(document.querySelector('[data-testid="stat-articles"]')?.textContent).toContain('1');
    expect(document.querySelector('[data-testid="stat-running"]')?.textContent).toContain('1');
  });

  it('同 rel 二次渲染(同 provider 内卸载重挂)零重复 fetch;事件投影每轮直取', async () => {
    const { fetcher, callsOf } = countingFetcher();
    const versionFetcher = vi.fn(async () => 'v1');
    const events = stubEvents();
    vi.stubGlobal('fetch', events);

    function Tree({ mounted }: { mounted: boolean }) {
      return (
        <EntityCacheProvider fetcher={fetcher} versionFetcher={versionFetcher}>
          {mounted ? <HomeBody /> : null}
        </EntityCacheProvider>
      );
    }

    const view = render(<Tree mounted={true} />);
    await waitFor(() => {
      expect(screen.getByText(/共 1 篇/)).toBeTruthy();
    });

    view.rerender(<Tree mounted={false} />);
    view.rerender(<Tree mounted={true} />);
    await waitFor(() => {
      expect(screen.getByText(/共 1 篇/)).toBeTruthy();
    });

    // 页面缓存命中:实体零重复 fetch,version 戳仍只取一次。
    expect(callsOf('articles')).toHaveLength(1);
    expect(callsOf('comments')).toHaveLength(1);
    expect(callsOf('inbox')).toHaveLength(1);
    expect(callsOf('delegations')).toHaveLength(1);
    expect(versionFetcher).toHaveBeenCalledTimes(1);
    // /api/events 非实体,不入缓存:两次挂载各取一次。
    expect(events).toHaveBeenCalledTimes(2);
  });
});
