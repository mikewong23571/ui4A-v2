// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { renderCatalogJson } from '@/render/registry';

import CanvasPage from './page';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/canvas');
});

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

const WELCOME = post('post:post-welcome', '欢迎来到 UI4A', '欢迎正文', 'tech');
const FIRST = post('post:first-post', '第一篇', '这是第一篇完整文章，用来验证正文阅读。', 'essay');
const ARTICLES: SirenEntity = {
  class: ['collection', 'articles'],
  properties: { rel: 'articles', identity: 'articles', count: 2 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
  entities: [WELCOME, FIRST],
};
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

function mockCanvasContract(): ReturnType<typeof vi.fn> {
  const rows: Record<string, SirenEntity> = {
    articles: ARTICLES,
    'post:post-welcome': WELCOME,
    'post:first-post': FIRST,
    'render-specs': EMPTY_SPECS,
  };
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/render/catalog')
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
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

function callsOf(mock: ReturnType<typeof vi.fn>, prefix: string): unknown[][] {
  return mock.mock.calls.filter(([input]) => String(input).startsWith(prefix));
}

describe('Canvas semantic Presentation runtime', () => {
  it('renders one Entity by semantic hierarchy instead of fixed detail/raw fields', async () => {
    window.history.pushState({}, '', '/canvas?focus=post%3Afirst-post');
    const mock = mockCanvasContract();
    vi.stubGlobal('fetch', mock);
    render(<CanvasPage />);

    expect(await screen.findByRole('heading', { name: '第一篇', level: 1 })).toBeTruthy();
    expect(screen.getByText(/这是第一篇完整文章/)).toBeTruthy();
    expect(screen.getByText('published')).toBeTruthy();
    expect(screen.queryByText('essay')).toBeNull();
    // T35 F-24:常规 focus 页不激活蓝框(data-active 只服务 ?concern= 锚点)。
    const surface = document.querySelector('[data-concern="presentation:post:first-post"]');
    expect(surface?.getAttribute('data-active')).toBeNull();
    expect(surface?.textContent).not.toContain('fields=');
    fireEvent.click(screen.getByRole('button', { name: '查看原始合同' }));
    expect(screen.getByTestId('raw-contract-json').textContent).toContain('essay');
    expect(callsOf(mock, '/api/entity?rel=post%3Afirst-post')).toHaveLength(1);
  });

  it('renders the default collection once and opens every member through semantic links', async () => {
    const mock = mockCanvasContract();
    vi.stubGlobal('fetch', mock);
    render(<CanvasPage />);

    const welcome = await screen.findByRole('link', { name: /欢迎来到 UI4A/ });
    const first = screen.getByRole('link', { name: /第一篇/ });
    expect(welcome.getAttribute('href')).toBe('/canvas?focus=post%3Apost-welcome');
    expect(first.getAttribute('href')).toBe('/canvas?focus=post%3Afirst-post');
    expect(document.querySelectorAll('[data-surface]')).toHaveLength(1);
    expect(callsOf(mock, '/api/entity?rel=articles')).toHaveLength(1);
  });

  it('renders an explicit selection as two source-isolated surfaces', async () => {
    window.history.pushState({}, '', '/canvas?roots=post%3Apost-welcome%2Cpost%3Afirst-post');
    vi.stubGlobal('fetch', mockCanvasContract());
    render(<CanvasPage />);

    expect(await screen.findByRole('heading', { name: '欢迎来到 UI4A', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '第一篇', level: 1 })).toBeTruthy();
    expect(document.querySelectorAll('[data-surface]')).toHaveLength(2);
  });

  it('fails closed before entity hydration when concrete catalog negotiation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input) === '/api/render/catalog'
          ? Promise.resolve(jsonResponse(200, { catalogId: 'urn:wrong' }))
          : Promise.resolve(jsonResponse(404, {})),
      ),
    );
    render(<CanvasPage />);

    // T32 Q5 迁移:首屏固定人话零机制词;目录协商细节进 why 抽屉,fail-closed 语义不变。
    expect((await screen.findByTestId('canvas-errors')).textContent).toBe(
      '画布内容暂时无法载入，请稍后重试',
    );
    expect(document.querySelector('[data-surface]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '为什么这样展示' }));
    expect(screen.getByTestId('canvas-why-diagnostics').textContent).toContain('目录协商失败');
  });

  it('reloads the Surface while reusing unchanged entity cache entries', async () => {
    const mock = mockCanvasContract();
    vi.stubGlobal('fetch', mock);
    render(<CanvasPage />);
    await screen.findByRole('link', { name: /第一篇/ });

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
    await waitFor(() => expect(callsOf(mock, '/api/entity?rel=render-specs')).toHaveLength(2));
    expect(callsOf(mock, '/api/entity?rel=articles')).toHaveLength(1);
    expect(document.querySelector('[data-nav="local:canvas-reload"]')).not.toBeNull();
  });

  it('keeps the newer navigation when an older catalog request completes late', async () => {
    const base = mockCanvasContract();
    let release: ((response: Response) => void) | undefined;
    let catalogCalls = 0;
    const mock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/render/catalog') {
        catalogCalls += 1;
        if (catalogCalls === 1) {
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
      }
      return (base as unknown as (value: RequestInfo | URL) => Promise<Response>)(input);
    });
    vi.stubGlobal('fetch', mock);
    const { rerender } = render(<CanvasPage />);
    await waitFor(() => expect(catalogCalls).toBe(1));

    window.history.pushState({}, '', '/canvas?focus=post%3Afirst-post');
    rerender(<CanvasPage />);
    expect(await screen.findByRole('heading', { name: '第一篇', level: 1 })).toBeTruthy();
    release?.(jsonResponse(200, renderCatalogJson()));
    await Promise.resolve();
    expect(screen.getByRole('heading', { name: '第一篇', level: 1 })).toBeTruthy();
  });
});
