// @vitest-environment jsdom
/**
 * T24 呈现诚实化 Red 测试:canvas 首屏零机制词汇。
 *
 * 成功渲染出语义 surface(标题/正文如实呈现)之后,首屏主区域的可读文本
 * 不得出现机制词表(lib/mechanism-words,固定常量清单)中的任何词;机制
 * 信息(目录协商、表面 ID 等)只允许出现在「为什么这样展示」抽屉。
 * - Task 1 断言范围:头部机制行与表面 ID;
 * - Task 4 追加:带 Sidecar 的成功渲染(stub /api/presentation 回执与
 *   /api/presentation/sidecar 个人呈现合同,口径同 canvas-why-drawer.test)
 *   抽屉关闭时主区域零控制条机制文案,抽屉入口是唯一机制入口
 *   (「为什么这样展示」是抽屉入口的保留文案,不在主区域禁词内)。
 *
 * stub 口径与 app/canvas/page.test.tsx 一致:mock next/navigation 的
 * useSearchParams + 全局 fetch 应答目录协商/sitemap/实体读取(/api/entity
 * 经页面级实体缓存默认 fetcher 走同一全局 fetch)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assembleSurfaceRegions, type SirenEntity } from '@ui4a/engine';

import { MECHANISM_WORDS } from '@/lib/mechanism-words';
import { planGenericPresentationSurface } from '@/render/presentation/generic';
import { renderCatalogJson } from '@/render/registry';

import { CanvasBody } from './canvas-body';
import { EntityCacheProvider } from './entity-cache-provider';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/canvas');
});

/** 带 presentation 字段声明的实例(与 /api/entity 的 Siren 投影一致)。 */
function post(rel: string, identity: string, body: string, category: string): SirenEntity {
  return {
    class: ['flow-instance', 'post-status'],
    properties: {
      rel,
      node: 'published',
      identity,
      status: 'published',
      fields: { title: identity, body, category },
      presentation: {
        fields: [
          { path: 'properties.fields.title', title: '文章标题', role: 'identity' },
          { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
          { path: 'properties.fields.category', title: '分类', role: 'metadata' },
        ],
      },
    },
    actions: [],
    links: [],
  };
}

const FIRST = post('post:first-post', '第一篇', '这是第一篇完整文章，用来验证正文阅读。', 'essay');
const EMPTY_SPECS: SirenEntity = {
  class: ['collection', 'render-specs'],
  properties: { rel: 'render-specs', count: 0 },
  actions: [],
  links: [],
  entities: [],
};

const SIDECAR_ID = 'sidecar:1';
/** Sidecar 携带的 Surface Tree:由通用规划器对同一 focus 实体产出(纯函数,
 * 与真实服务端口径一致);hydrate 后语义渲染与无 sidecar 路径相同。 */
const SIDECAR_SURFACE = planGenericPresentationSurface(
  'post:first-post',
  FIRST,
  'definition-v1',
  'read',
).surface;

const WORKSPACE_SOURCES = [
  post('inbox', '在等我', '需要我处理的工作', 'work'),
  post('delegations', '在动', '正在执行的工作', 'work'),
  post('threads', '工作线', '持续推进的工作线', 'work'),
] as const;
const WORKSPACE_SURFACE = assembleSurfaceRegions(
  [
    { region: 'waiting-for-me', entity: WORKSPACE_SOURCES[0] },
    { region: 'in-motion', entity: WORKSPACE_SOURCES[1] },
    { region: 'work-lines', entity: WORKSPACE_SOURCES[2] },
  ].map(({ region, entity }) => ({
    region,
    surface: planGenericPresentationSurface(
      entity.properties.rel as string,
      entity,
      'definition-v1',
      'read',
    ).surface,
    provenance: [
      {
        kind: 'composition-declaration' as const,
        ref: `composition:my-work@1#${region}`,
      },
    ],
  })),
  {
    provenance: [{ kind: 'composition-declaration', ref: 'composition:my-work@1' }],
  },
);

/** 控制条(canvas-sidecar-toolbar)可读机制文案。覆盖两种 retention 下
 * 实际出现的全部机制文本;「为什么这样展示」除外——它同时是抽屉入口的
 * 保留文案,不属主区域禁词。 */
const SIDECAR_TOOLBAR_WORDS: readonly string[] = [
  '个人呈现',
  '已固定',
  '以后都这样看',
  '恢复上一版本',
  '收起视图',
  '切换疏密',
  '设为团队默认',
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** /api/presentation/sidecar 应答:version>1(恢复上一版本可见)、
 * collapsedNodeIds 为空(语义内容如实上屏而非收起占位)。 */
function sidecarResponseBody(retention: 'cache' | 'pinned'): unknown {
  return {
    sidecar: {
      id: SIDECAR_ID,
      version: 2,
      retention,
      key: { subject: 'post:first-post' },
      surface: SIDECAR_SURFACE,
      dependencies: [{ id: 'post-contract', kind: 'entity-contract', ref: 'post:first-post' }],
      view: { collapsedNodeIds: [], densityByNodeId: {} },
    },
  };
}

/** 画布合同桩:目录协商 + sitemap + 实体读取;withSidecar 时再应答
 * /api/presentation(回执)与 /api/presentation/sidecar(个人呈现合同),
 * 其余未用端点(含无 sidecar 路径的 /api/presentation)404。 */
function mockCanvasContract(withSidecar?: {
  retention: 'cache' | 'pinned';
}): ReturnType<typeof vi.fn> {
  const rows: Record<string, SirenEntity> = {
    'post:first-post': FIRST,
    'render-specs': EMPTY_SPECS,
  };
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/render/catalog')
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
    }
    if (withSidecar !== undefined && url === '/api/presentation' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse(200, { sidecar: { id: SIDECAR_ID } }));
    }
    if (withSidecar !== undefined && url.startsWith('/api/presentation/sidecar?')) {
      return Promise.resolve(jsonResponse(200, sidecarResponseBody(withSidecar.retention)));
    }
    if (url.startsWith('/api/entity?rel=')) {
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel') ?? '';
      const entity = rows[rel];
      return Promise.resolve(
        entity === undefined
          ? jsonResponse(404, { error: 'not found' })
          : jsonResponse(200, entity),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
  });
}

function mockWorkspaceCanvasContract(
  dependencies = WORKSPACE_SOURCES.map((entity, index) => ({
    id: `workspace-source:${index}`,
    kind: 'entity-contract',
    ref: entity.properties.rel,
  })),
): ReturnType<typeof vi.fn> {
  const rows = Object.fromEntries(
    WORKSPACE_SOURCES.map((entity) => [entity.properties.rel as string, entity]),
  );
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/render/catalog')
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    if (url.startsWith('/.well-known/ui4a.json'))
      return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
    if (url.includes('explain=1')) {
      return Promise.resolve(
        jsonResponse(200, {
          explanation: {
            provenance: { kind: 'generic-fallback', ref: 'workspace:my-work' },
            dependencyIds: ['definition', 'catalog', 'policy'],
            composition: {
              id: 'my-work',
              version: '1',
              regions: [
                { region: 'waiting-for-me', availability: 'available' },
                { region: 'in-motion', availability: 'available' },
                { region: 'work-lines', availability: 'available' },
              ],
              declarationProvenance: {
                kind: 'composition-declaration',
                ref: 'composition:my-work@1',
              },
            },
          },
        }),
      );
    }
    if (url.startsWith('/api/presentation/sidecar?')) {
      return Promise.resolve(
        jsonResponse(200, {
          sidecar: {
            id: 'sidecar:workspace',
            version: 1,
            retention: 'cache',
            key: { subject: 'workspace:my-work' },
            surface: WORKSPACE_SURFACE,
            dependencies,
            view: { collapsedNodeIds: [], densityByNodeId: {} },
          },
        }),
      );
    }
    if (url.startsWith('/api/entity?rel=')) {
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel') ?? '';
      const entity = rel === 'render-specs' ? EMPTY_SPECS : rows[rel];
      return Promise.resolve(
        entity === undefined
          ? jsonResponse(404, { error: 'not found' })
          : jsonResponse(200, entity),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
  });
}

/** 带 Sidecar 的成功渲染:返回主区域容器文本(抽屉默认关闭)。 */
async function renderCanvasWithSidecar(retention: 'cache' | 'pinned'): Promise<{
  container: HTMLElement;
  text: string;
}> {
  window.history.pushState({}, '', '/canvas?focus=post%3Afirst-post');
  vi.stubGlobal('fetch', mockCanvasContract({ retention }));
  const { container } = render(
    <EntityCacheProvider>
      <CanvasBody />
    </EntityCacheProvider>,
  );
  // 前置(非断言目标):sidecar 视图成功上屏(语义内容如实呈现)——若这里
  // 失败是 setup 问题,不算机制词 Red。
  expect(await screen.findByRole('heading', { name: '第一篇', level: 1 })).toBeTruthy();
  expect(screen.getByText(/这是第一篇完整文章/)).toBeTruthy();
  return { container, text: container.textContent ?? '' };
}

describe('CanvasBody 首屏零机制词(T24)', () => {
  it('单树挂载 workspace Sidecar 的三个 direct region slots，机制信息仅在 why 抽屉', async () => {
    window.history.pushState(
      {},
      '',
      '/canvas?focus=workspace%3Amy-work&sidecar=sidecar%3Aworkspace',
    );
    const fetchMock = mockWorkspaceCanvasContract();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(
      <EntityCacheProvider>
        <CanvasBody />
      </EntityCacheProvider>,
    );

    expect(await screen.findByRole('heading', { name: '在等我', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '在动', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '工作线', level: 1 })).toBeTruthy();
    expect(container.querySelectorAll('[data-surface]')).toHaveLength(1);
    expect(container.querySelector('section[aria-label="surfaces"]')?.className).not.toContain(
      'grid-cols-2',
    );
    expect(container.textContent).not.toContain('waiting-for-me');
    expect(container.textContent).not.toContain('composition:my-work@1');
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('rel=workspace%3Amy-work')),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    fireEvent.click(screen.getByTestId('canvas-why-explain'));
    expect((await screen.findByTestId('canvas-why-composition-regions')).textContent).toContain(
      'waiting-for-me',
    );
    expect(screen.getByTestId('canvas-why-composition-provenance').textContent).toContain(
      'composition:my-work@1',
    );
  });

  it('Sidecar hydration 只读取已授权 entity-contract refs，空依赖不回退到 workspace focus', async () => {
    window.history.pushState(
      {},
      '',
      '/canvas?focus=workspace%3Amy-work&sidecar=sidecar%3Aworkspace',
    );
    const fetchMock = mockWorkspaceCanvasContract([]);
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(
      <EntityCacheProvider>
        <CanvasBody />
      </EntityCacheProvider>,
    );

    await waitFor(() => expect(container.querySelectorAll('[data-surface]')).toHaveLength(1));
    const entityReads = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith('/api/entity?rel=') && !url.includes('rel=render-specs'));
    expect(entityReads).toEqual([]);
  });

  it('partial workspace hydration 只读取 visible source，不读取 denied regions 或虚主体', async () => {
    window.history.pushState(
      {},
      '',
      '/canvas?focus=workspace%3Amy-work&sidecar=sidecar%3Aworkspace',
    );
    const fetchMock = mockWorkspaceCanvasContract([
      { id: 'workspace-source:threads', kind: 'entity-contract', ref: 'threads' },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <EntityCacheProvider>
        <CanvasBody />
      </EntityCacheProvider>,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('rel=threads'))).toBe(
        true,
      ),
    );
    const entityReads = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith('/api/entity?rel=') && !url.includes('rel=render-specs'));
    expect(entityReads).toHaveLength(1);
    expect(entityReads[0]).toContain('rel=threads');
    expect(entityReads[0]).not.toContain('workspace');
    expect(entityReads[0]).not.toContain('inbox');
    expect(entityReads[0]).not.toContain('delegations');
  });

  it('成功渲染 surface 后,首屏主区域文本不含机制词表中的任何词', async () => {
    // focus 实例 rel 含冒号:表面 ID 呈 presentation-post%3A… 形态(词表特征)。
    window.history.pushState({}, '', '/canvas?focus=post%3Afirst-post');
    vi.stubGlobal('fetch', mockCanvasContract());
    const { container } = render(
      <EntityCacheProvider>
        <CanvasBody />
      </EntityCacheProvider>,
    );

    // 前置(非断言目标):语义 surface 成功上屏——若这里失败是 setup 问题,
    // 不算机制词 Red;机制词断言只在「呈现成功」的首屏上成立。
    expect(await screen.findByRole('heading', { name: '第一篇', level: 1 })).toBeTruthy();
    expect(screen.getByText(/这是第一篇完整文章/)).toBeTruthy();

    // Red 断言:首屏主区域(当前 canvas 主体全部输出,尚无抽屉)的可读文本
    // 零机制词;data-* 属性与 href 不是可读文本,不在本口径内。
    const text = container.textContent ?? '';
    const leaked = MECHANISM_WORDS.filter((word) => text.includes(word));
    expect(leaked).toEqual([]);
  });

  it('带 Sidecar(cache,v2)的成功渲染:抽屉关闭时主区域零控制条机制文案,抽屉入口是唯一机制入口', async () => {
    const { text } = await renderCanvasWithSidecar('cache');

    // Red 断言:机制词表 + 控制条机制文案(个人呈现/以后都这样看/恢复上一
    // 版本/收起/疏密/团队默认)在主区域零泄漏——控制条只允许出现在抽屉内。
    const leaked = [...MECHANISM_WORDS, ...SIDECAR_TOOLBAR_WORDS].filter((word) =>
      text.includes(word),
    );
    expect(leaked).toEqual([]);

    // 抽屉入口(默认关闭)是唯一机制入口:主区域不再有控制条自带的
    // explain 按钮,同名按钮只剩入口一处。
    const entries = screen.getAllByRole('button', { name: '为什么这样展示' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.getAttribute('aria-expanded')).toBe('false');
  });

  it('带 Sidecar(pinned)的成功渲染:主区域零「已固定」等控制条机制文案', async () => {
    const { text } = await renderCanvasWithSidecar('pinned');

    const leaked = [...MECHANISM_WORDS, ...SIDECAR_TOOLBAR_WORDS].filter((word) =>
      text.includes(word),
    );
    expect(leaked).toEqual([]);
    expect(screen.getAllByRole('button', { name: '为什么这样展示' })).toHaveLength(1);
  });
});
