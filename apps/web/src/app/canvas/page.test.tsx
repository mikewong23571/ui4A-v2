// @vitest-environment jsdom
/**
 * 画布页测试(T7 Phase B):A2UI surface 宿主的渲染流。
 *
 * - 目录协商:/api/render/catalog 的 catalogId 与本地注册表同源(不同源即错);
 * - 凝固 spec 列表:/api/entity?rel=render-specs 的成员逐个成 surface;
 * - 单例演示:table 词条静态绑定 articles(走查断言:画布出现文章成员);
 * - 非法凝固 spec(零字面违规)如实呈错,不产半截 surface;
 * - 全站标注:页面控件 data-action/data-nav(I3 基础);
 * - 页面级实体缓存(T12 Phase B Task 3):多 surface 共享,同 rel 跨 surface
 *   零重复 fetch;version 一致性戳(/.well-known/ui4a.json)每页面会话一次。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { renderCatalogJson } from '@/render/registry';

import CanvasPage from './page';

// useSearchParams:jsdom 无 AppRouter 上下文;桩读真实 window.location
// (与本文件 pushState 设址手法一致——concern 变化经 rerender 反映)。
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ARTICLES: SirenEntity = {
  class: ['collection', 'articles'],
  properties: { rel: 'articles', count: 2 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
  entities: [
    {
      class: ['flow-instance', 'post-status'],
      rel: ['item'],
      properties: {
        rel: 'post:post-welcome',
        node: 'published',
        fields: { title: '欢迎来到 UI4A', category: 'tech' },
      },
      actions: [],
      links: [],
    },
    {
      class: ['flow-instance', 'post-status'],
      rel: ['item'],
      properties: {
        rel: 'post:first-post',
        node: 'published',
        fields: { title: '第一篇', category: 'essay' },
      },
      actions: [],
      links: [],
    },
  ],
};

/** 凝固 spec 集合(chart 词条:articles 按分类聚合)。 */
function renderSpecsCollection(withIllegal: boolean): SirenEntity {
  const frozen = (concern: string, component: string, bind: unknown): SirenEntity => ({
    class: ['render-spec', 'frozen'],
    rel: ['item'],
    properties: { concern, component, bind, 'requested-by': { actor: 'agent' } },
    actions: [],
    links: [],
  });
  const entities = [
    frozen('articles-by-category', 'chart', {
      series: { collection: 'articles', dimension: 'articles.fields.category' },
    }),
  ];
  if (withIllegal) {
    entities.push(frozen('broken', 'table', { rows: 42 }));
  }
  return {
    class: ['collection', 'render-specs'],
    properties: { rel: 'render-specs', count: entities.length },
    actions: [],
    links: [],
    entities,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCanvasContract(
  options: { illegal?: boolean; missingCategory?: boolean } = {},
): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/render/catalog') return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    // 页面级缓存的一致性戳(T12:sitemap version,每页面会话只取一次)。
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(jsonResponse(200, { version: 'test-v1' }));
    }
    if (url.startsWith('/api/entity?rel=render-specs')) {
      return Promise.resolve(jsonResponse(200, renderSpecsCollection(options.illegal === true)));
    }
    if (url.startsWith('/api/entity?rel=articles')) {
      const articles = options.missingCategory
        ? {
            ...ARTICLES,
            entities: ARTICLES.entities?.map((member, index) =>
              index === 1
                ? {
                    ...member,
                    properties: {
                      ...member.properties,
                      fields: { title: '第一篇' },
                    },
                  }
                : member,
            ),
          }
        : ARTICLES;
      return Promise.resolve(jsonResponse(200, articles));
    }
    return Promise.resolve(jsonResponse(404, { error: `未知端点 ${url}` }));
  });
}

/** 按 URL 前缀统计 fetch 次数(缓存去重断言)。 */
function callsOf(mock: ReturnType<typeof vi.fn>, prefix: string): unknown[][] {
  return mock.mock.calls.filter(([input]) => String(input).startsWith(prefix));
}

describe('画布页(A2UI surface 宿主)', () => {
  it('目录协商 + 凝固 spec(chart)+ 单例演示(table)→ surface 渲染词条内容', async () => {
    vi.stubGlobal('fetch', mockCanvasContract());
    render(<CanvasPage />);

    // 目录协商标注(catalogId 同源)
    await waitFor(() => {
      expect(screen.getByText(/已协商/)).toBeTruthy();
    });
    // 单例演示:table 词条渲染 articles 成员(走查断言口径)
    await waitFor(() => {
      expect(screen.getByText('欢迎来到 UI4A')).toBeTruthy();
    });
    expect(screen.getByText('第一篇')).toBeTruthy();
    expect(screen.getAllByText('tech').length).toBeGreaterThanOrEqual(1);
    // 凝固 spec:chart 词条(维度聚合 tech=1/essay=1)
    await waitFor(() => {
      const chart = document.querySelector('[data-word="chart"]');
      expect(chart?.getAttribute('aria-label')).toContain('tech=1');
      expect(chart?.getAttribute('aria-label')).toContain('essay=1');
    });
    // surface 数量:凝固 chart + 演示 table = 2
    expect(document.querySelectorAll('[data-surface]').length).toBe(2);
  });

  it('非法凝固 spec(零字面违规)如实呈错;合法 surface 不受影响', async () => {
    vi.stubGlobal('fetch', mockCanvasContract({ illegal: true }));
    render(<CanvasPage />);

    await waitFor(() => {
      expect(screen.getByTestId('canvas-errors').textContent).toContain('broken');
    });
    await waitFor(() => {
      expect(screen.getByText('欢迎来到 UI4A')).toBeTruthy();
    });
    expect(document.querySelectorAll('[data-surface]').length).toBe(2);
  });

  it('维度字段缺失成员被跳过并在对应 surface 标注,其余成员继续渲染', async () => {
    vi.stubGlobal('fetch', mockCanvasContract({ missingCategory: true }));
    render(<CanvasPage />);

    await waitFor(() => {
      const chart = document.querySelector('[data-word="chart"]');
      expect(chart?.getAttribute('aria-label')).toContain('tech=1');
    });
    const warning = screen.getByTestId('surface-warning');
    expect(warning.textContent).toContain('1 条成员');
    expect(warning.textContent).toContain('fields.category');
    expect(warning.textContent).toContain('post:first-post');
    expect(document.querySelectorAll('[data-surface]').length).toBe(2);
  });

  it('目录协商失败(不同源)→ 整页呈错,零 surface', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/render/catalog') {
          return Promise.resolve(jsonResponse(200, { $id: 'https://other/', catalogId: 'https://other/' }));
        }
        return Promise.resolve(jsonResponse(404, { error: 'x' }));
      }),
    );
    render(<CanvasPage />);

    await waitFor(() => {
      expect(screen.getByTestId('canvas-errors').textContent).toContain('目录协商失败');
    });
    expect(document.querySelector('[data-surface]')).toBeNull();
  });

  it('页面控件标注:重新载入 data-nav(本地视图控件;I3 基础)', async () => {
    vi.stubGlobal('fetch', mockCanvasContract());
    render(<CanvasPage />);
    await waitFor(() => {
      expect(screen.getByText('欢迎来到 UI4A')).toBeTruthy();
    });
    expect(document.querySelector('[data-nav="local:canvas-reload"]')).not.toBeNull();
  });

  it('?concern= 激活:命中凝固 spec 排最前并高亮,各 surface 带 data-concern', async () => {
    window.history.pushState({}, '', '/canvas?concern=demo-articles-table');
    try {
      vi.stubGlobal('fetch', mockCanvasContract());
      render(<CanvasPage />);
      await waitFor(() => {
        expect(screen.getByText('欢迎来到 UI4A')).toBeTruthy();
      });
      const surfaces = [...document.querySelectorAll('[data-surface]')];
      expect(surfaces.length).toBe(2);
      // data-concern:surface 的关注点标识(chat 链接/断言锚点)
      expect(surfaces.map((node) => node.getAttribute('data-concern'))).toEqual(
        expect.arrayContaining(['articles-by-category', 'demo-articles-table']),
      );
      // 激活排序:?concern=demo-articles-table 的 surface 排最前 + data-active
      expect(surfaces[0]!.getAttribute('data-concern')).toBe('demo-articles-table');
      expect(surfaces[0]!.getAttribute('data-active')).toBe('true');
      expect(surfaces[1]!.getAttribute('data-active')).toBeNull();
    } finally {
      window.history.pushState({}, '', '/canvas');
    }
  });

  it('?concern= 未命中任何凝固 spec:不改变缺省排序(凝固在前,演示在后)', async () => {
    window.history.pushState({}, '', '/canvas?concern=no-such-concern');
    try {
      vi.stubGlobal('fetch', mockCanvasContract());
      render(<CanvasPage />);
      await waitFor(() => {
        expect(screen.getByText('欢迎来到 UI4A')).toBeTruthy();
      });
      const surfaces = [...document.querySelectorAll('[data-surface]')];
      expect(surfaces[0]!.getAttribute('data-concern')).toBe('articles-by-category');
      expect(surfaces.every((node) => node.getAttribute('data-active') === null)).toBe(true);
    } finally {
      window.history.pushState({}, '', '/canvas');
    }
  });

  it('?concern= 同路由变化(不重挂载)→ 重载:高亮迁移到新 surface(render 回执即达即跳在画布上的二次渲染)', async () => {
    window.history.pushState({}, '', '/canvas?concern=demo-articles-table');
    try {
      const mock = mockCanvasContract();
      vi.stubGlobal('fetch', mock);
      const { rerender } = render(<CanvasPage />);
      await waitFor(() => {
        expect(document.querySelectorAll('[data-surface]').length).toBe(2);
      });
      let surfaces = [...document.querySelectorAll('[data-surface]')];
      expect(surfaces[0]!.getAttribute('data-concern')).toBe('demo-articles-table');
      expect(surfaces[0]!.getAttribute('data-active')).toBe('true');

      // 软导航换 concern(同路由不重挂载):spec 列表重新直取(新回执的
      // spec 立即可见)+ 激活排序/高亮迁移。
      window.history.pushState({}, '', '/canvas?concern=articles-by-category');
      rerender(<CanvasPage />);
      await waitFor(() => {
        expect(callsOf(mock, '/api/entity?rel=render-specs')).toHaveLength(2);
      });
      await waitFor(() => {
        surfaces = [...document.querySelectorAll('[data-surface]')];
        expect(surfaces[0]!.getAttribute('data-concern')).toBe('articles-by-category');
        expect(surfaces[0]!.getAttribute('data-active')).toBe('true');
        expect(surfaces[1]!.getAttribute('data-concern')).toBe('demo-articles-table');
        expect(surfaces[1]!.getAttribute('data-active')).toBeNull();
      });
    } finally {
      window.history.pushState({}, '', '/canvas');
    }
  });

  it('多 surface 共享页面缓存:同 rel(凝固 chart + 演示 table)零重复 fetch,version 戳一次', async () => {
    const mock = mockCanvasContract();
    vi.stubGlobal('fetch', mock);
    render(<CanvasPage />);

    // 两个 surface 都绑定 articles 集合(换 concern/换词条的同 rel 二次渲染)。
    await waitFor(() => {
      expect(document.querySelectorAll('[data-surface]').length).toBe(2);
    });
    expect(callsOf(mock, '/api/entity?rel=articles')).toHaveLength(1);
    expect(callsOf(mock, '/.well-known/ui4a.json')).toHaveLength(1);
    // 凝固 spec 列表是每轮 load 的输入:直取(reload 即新鲜的兜底口径不变)。
    expect(callsOf(mock, '/api/entity?rel=render-specs')).toHaveLength(1);
  });

  it('重新载入:整面 reload 兜底保留(重建全部 surface),未失效 rel 命中缓存零重复 fetch', async () => {
    const mock = mockCanvasContract();
    vi.stubGlobal('fetch', mock);
    render(<CanvasPage />);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-surface]').length).toBe(2);
    });

    fireEvent.click(screen.getByText('重新载入'));

    // 重载完成锚点:spec 列表再次直取(每轮 fresh)。
    await waitFor(() => {
      expect(callsOf(mock, '/api/entity?rel=render-specs')).toHaveLength(2);
    });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-surface]').length).toBe(2);
    });
    // 未 exec 无失效:articles 命中页面缓存;version 戳仍一次。
    expect(callsOf(mock, '/api/entity?rel=articles')).toHaveLength(1);
    expect(callsOf(mock, '/.well-known/ui4a.json')).toHaveLength(1);
  });
});
