// @vitest-environment jsdom
/**
 * 集合读面贯通的宿主级测试(T38;自 presentation-surface-host.test.tsx 沿功能
 * 边界拆出,GR3):hydrate 携带声明读面参数(offset=0 初始游标 / URL 优先 /
 * 平台视图零参数)+ 组合面语境的就地读面导航(宿主注入导航面,翻页/过滤
 * 只合并 offset/filter.*,subject 状态保留;无宿主注入回退 focus 落点)。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SirenEntity } from '@ui4a/engine';

import { planGenericSurface, type SurfaceTree } from '@ui4a/engine';

import { CanvasBody } from '@/components/canvas/canvas-body';
import { EntityCacheProvider } from '@/components/entity-cache-provider';
import { PRESENTATION_SURFACE_CATALOG } from '@/engine/presentation/catalog';
import { planGenericPresentationSurface } from '@/render/presentation/generic';
import { renderCatalogJson } from '@/render/registry';

import { collectionQueryNavigation } from './collection-query';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/canvas');
});

const EMPTY_SPECS: SirenEntity = {
  class: ['collection', 'render-specs'],
  properties: { rel: 'render-specs', count: 0 },
  actions: [],
  links: [],
  entities: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const member: SirenEntity = {
  class: ['post'],
  properties: { rel: 'post:p1', identity: '第一篇', fields: { title: '第一篇' } },
  actions: [{ name: 'publish', title: '发布', method: 'POST', href: '/api/exec', fields: {} }],
  links: [],
};

function articlesPageAt(offset: number): SirenEntity {
  return {
    class: ['collection', 'articles'],
    properties: {
      rel: 'articles',
      count: 27,
      offset,
      presentation: {
        fields: [
          { path: 'properties.fields.title', title: '标题', role: 'identity', overview: true },
          { path: 'properties.fields.category', title: '分类', role: 'metadata', overview: true },
        ],
        filters: [
          { field: 'status', title: '状态', values: [{ value: 'pending', title: '待处理' }] },
        ],
      },
    },
    actions: [],
    links: [
      { rel: ['self'], href: `/api/entity?rel=articles&offset=${offset}` },
      ...(offset + 20 < 27
        ? [{ rel: ['next'], href: `/api/entity?rel=articles&offset=${offset + 20}` }]
        : []),
      ...(offset > 0
        ? [{ rel: ['prev'], href: `/api/entity?rel=articles&offset=${offset - 20}` }]
        : []),
    ],
    entities: [member],
  };
}

function sidecarFixture(input: {
  subject: string;
  surface: ReturnType<typeof planGenericPresentationSurface>['surface'];
  dependencies: string[];
  entities: Record<string, SirenEntity>;
  surfaces?: unknown[];
  scope?: string;
}): ReturnType<typeof vi.fn> {
  const scopeQuery = input.scope === undefined ? '' : `?scope=${encodeURIComponent(input.scope)}`;
  return vi.fn((request: RequestInfo | URL) => {
    const url = String(request);
    if (url === '/api/render/catalog') {
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    }
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(
        jsonResponse(200, { version: 'definition-v1', surfaces: input.surfaces ?? [] }),
      );
    }
    if (url === `/api/presentation${scopeQuery}`) {
      return Promise.resolve(jsonResponse(200, { sidecar: { id: 'sidecar:cq' } }));
    }
    if (url.startsWith('/api/presentation/sidecar?')) {
      return Promise.resolve(
        jsonResponse(200, {
          sidecar: {
            id: 'sidecar:cq',
            version: 1,
            retention: 'cache',
            key: { subject: input.subject },
            surface: input.surface,
            dependencies: input.dependencies.map((ref) => ({ kind: 'entity-contract', ref })),
            view: { collapsedNodeIds: [], densityByNodeId: {} },
          },
        }),
      );
    }
    if (url.startsWith('/api/entity?rel=')) {
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel');
      if (rel === 'render-specs') return Promise.resolve(jsonResponse(200, EMPTY_SPECS));
      const entity = input.entities[rel ?? ''];
      return entity === undefined
        ? Promise.resolve(jsonResponse(404, { error: 'not found' }))
        : Promise.resolve(jsonResponse(200, entity));
    }
    return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
  });
}

function fetchesOf(fetchMock: ReturnType<typeof vi.fn>, prefix: string): string[] {
  return fetchMock.mock.calls
    .map(([request]) => String(request))
    .filter((url) => url.startsWith(prefix));
}

describe('T38 集合读面贯通(hydrate 携带声明读面参数)', () => {
  it('集合区域初始取数携带 offset=0(服务端定页大小),声明 next 链接渲染分页脚', async () => {
    const page = articlesPageAt(0);
    const surface = planGenericPresentationSurface(
      'articles',
      page,
      'definition-v1',
      'read',
    ).surface;
    const fetchMock = sidecarFixture({
      subject: 'articles',
      surface,
      dependencies: ['articles'],
      entities: { articles: page },
      surfaces: [{ rel: 'articles', title: '文章', collection: true, app: 'publishing' }],
      scope: 'publishing',
    });
    vi.stubGlobal('fetch', fetchMock);

    window.history.pushState({}, '', '/canvas?focus=articles&scope=publishing');
    render(
      <EntityCacheProvider scope="publishing">
        <CanvasBody />
      </EntityCacheProvider>,
    );

    // 分页脚来自合同声明的 next 链接(集合区域拿到的是第一页,而非全量)。
    expect(await screen.findByRole('button', { name: '下一页' })).toBeTruthy();
    const fetches = fetchesOf(fetchMock, '/api/entity?rel=articles');
    expect(fetches.length).toBeGreaterThan(0);
    for (const url of fetches) {
      expect(url).toBe('/api/entity?rel=articles&offset=0&scope=publishing');
    }
  });

  it('URL 读面参数优先于初始游标(分享/回放以 URL 为准)', async () => {
    const page = articlesPageAt(20);
    const surface = planGenericPresentationSurface(
      'articles',
      page,
      'definition-v1',
      'read',
    ).surface;
    const fetchMock = sidecarFixture({
      subject: 'articles',
      surface,
      dependencies: ['articles'],
      entities: { articles: page },
      surfaces: [{ rel: 'articles', title: '文章', collection: true }],
      scope: 'publishing',
    });
    vi.stubGlobal('fetch', fetchMock);

    window.history.pushState(
      {},
      '',
      '/canvas?focus=articles&offset=20&filter.status=pending&scope=publishing',
    );
    render(
      <EntityCacheProvider scope="publishing">
        <CanvasBody />
      </EntityCacheProvider>,
    );

    expect(await screen.findByRole('button', { name: '上一页' })).toBeTruthy();
    const fetches = fetchesOf(fetchMock, '/api/entity?rel=articles');
    expect(fetches.length).toBeGreaterThan(0);
    for (const url of fetches) {
      expect(url).toBe('/api/entity?rel=articles&offset=20&filter.status=pending&scope=publishing');
    }
  });

  it('非成员集合的平台视图(repeat 区域但 sitemap 未声明 collection)零参数(我的事不破)', async () => {
    const inboxView: SirenEntity = {
      class: ['collection', 'inbox'],
      properties: { rel: 'inbox', count: 1 },
      actions: [],
      links: [{ rel: ['self'], href: '/api/entity?rel=inbox' }],
      entities: [member],
    };
    const surface = planGenericPresentationSurface(
      'inbox',
      inboxView,
      'definition-v1',
      'read',
    ).surface;
    const fetchMock = sidecarFixture({
      subject: 'workspace:my-work',
      surface,
      dependencies: ['inbox'],
      entities: { inbox: inboxView },
      surfaces: [],
    });
    vi.stubGlobal('fetch', fetchMock);

    window.history.pushState({}, '', '/canvas?focus=workspace%3Amy-work');
    render(
      <EntityCacheProvider>
        <CanvasBody />
      </EntityCacheProvider>,
    );

    expect(await screen.findByRole('button', { name: '为什么这样展示' })).toBeTruthy();
    const fetches = fetchesOf(fetchMock, '/api/entity?rel=inbox');
    expect(fetches.length).toBeGreaterThan(0);
    for (const url of fetches) {
      expect(url).toBe('/api/entity?rel=inbox');
    }
  });
});

describe('T38 Phase C 修复 2:组合面语境的就地读面导航(宿主注入导航面)', () => {
  function stubAssign(): ReturnType<typeof vi.fn> {
    const assign = vi.fn();
    const original = collectionQueryNavigation.assign;
    collectionQueryNavigation.assign = assign;
    return assign;
  }

  /** 组合面区域面(产物集合以表格密度呈现,member-table;忠实 T37 声明推导)。 */
  function tableSurfaceOf(entity: SirenEntity): SurfaceTree {
    return planGenericSurface('articles', entity, PRESENTATION_SURFACE_CATALOG, {
      entityVersion: 'definition-v1',
      intent: 'read',
      density: 'table',
    });
  }

  it('组合面点下一页 → 就地合并读面参数(scope 保留、零 focus 注入;表格不翻面)', async () => {
    const page = articlesPageAt(0);
    const surface = tableSurfaceOf(page);
    const fetchMock = sidecarFixture({
      subject: 'workspace:app:publishing',
      surface,
      dependencies: ['articles'],
      entities: { articles: page },
      surfaces: [{ rel: 'articles', title: '文章', collection: true, app: 'publishing' }],
      scope: 'publishing',
    });
    vi.stubGlobal('fetch', fetchMock);
    const assign = stubAssign();

    window.history.pushState({}, '', '/canvas?scope=publishing');
    render(
      <EntityCacheProvider scope="publishing">
        <CanvasBody />
      </EntityCacheProvider>,
    );

    expect(await screen.findByRole('button', { name: '下一页' })).toBeTruthy();
    // 组合面语境:member-table 表格仍在(未 focus 落点替换单主体卡片面)。
    expect(document.querySelector('[data-word="member-table"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(assign).toHaveBeenCalledWith('/canvas?scope=publishing&offset=20');
  });

  it('组合面过滤选择 → 就地合并读面参数(清除/选择都只动 offset/filter.*)', async () => {
    const page = articlesPageAt(0);
    const surface = tableSurfaceOf(page);
    const fetchMock = sidecarFixture({
      subject: 'workspace:app:publishing',
      surface,
      dependencies: ['articles'],
      entities: { articles: page },
      surfaces: [{ rel: 'articles', title: '文章', collection: true, app: 'publishing' }],
      scope: 'publishing',
    });
    vi.stubGlobal('fetch', fetchMock);
    const assign = stubAssign();

    window.history.pushState({}, '', '/canvas?scope=publishing');
    render(
      <EntityCacheProvider scope="publishing">
        <CanvasBody />
      </EntityCacheProvider>,
    );

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'pending' } });
    expect(assign).toHaveBeenCalledWith('/canvas?scope=publishing&filter.status=pending');
  });

  it('注视面语境翻页 → focus 保留,读面参数就地合并(同一宿主注入)', async () => {
    const page = articlesPageAt(0);
    const surface = planGenericPresentationSurface(
      'articles',
      page,
      'definition-v1',
      'read',
    ).surface;
    const fetchMock = sidecarFixture({
      subject: 'articles',
      surface,
      dependencies: ['articles'],
      entities: { articles: page },
      surfaces: [{ rel: 'articles', title: '文章', collection: true, app: 'publishing' }],
      scope: 'publishing',
    });
    vi.stubGlobal('fetch', fetchMock);
    const assign = stubAssign();

    window.history.pushState({}, '', '/canvas?focus=articles&scope=publishing');
    render(
      <EntityCacheProvider scope="publishing">
        <CanvasBody />
      </EntityCacheProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '下一页' }));
    expect(assign).toHaveBeenCalledWith('/canvas?focus=articles&scope=publishing&offset=20');
  });
});
