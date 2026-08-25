// @vitest-environment jsdom
/**
 * T24 呈现诚实化 Red 测试:canvas 首屏零机制词汇。
 *
 * 成功渲染出语义 surface(标题/正文如实呈现)之后,首屏主区域的可读文本
 * 不得出现机制词表(lib/mechanism-words,固定常量清单)中的任何词;机制
 * 信息(目录协商、表面 ID 等)只允许出现在后续任务的「为什么这样展示」
 * 抽屉。本任务断言范围:头部机制行与表面 ID;「个人呈现」相关断言由后续
 * 任务追加(词表已收录,此处一并巡检)。
 *
 * stub 口径与 app/canvas/page.test.tsx 一致:mock next/navigation 的
 * useSearchParams + 全局 fetch 应答目录协商/sitemap/实体读取(/api/entity
 * 经页面级缓存默认 fetcher 走同一全局 fetch)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { MECHANISM_WORDS } from '@/lib/mechanism-words';
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 画布合同桩:目录协商 + sitemap + 实体读取;/api/presentation 等未用端点 404。 */
function mockCanvasContract(): ReturnType<typeof vi.fn> {
  const rows: Record<string, SirenEntity> = {
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

describe('CanvasBody 首屏零机制词(T24)', () => {
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
});
