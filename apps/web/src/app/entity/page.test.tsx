// @vitest-environment jsdom
/**
 * 实体页主体测试(T2 Phase F Verification 补齐):EntityPageBody 的取数状态机。
 *
 * 页面壳(app/entity/page.tsx)只做 use(searchParams) 解包 + 挂页面级缓存承载
 * (T12 Phase B:EntityCacheProvider),由 e2e/human.spec 浏览器走查覆盖;此处
 * 在组件级覆盖状态机全分支(测试挂与页面一致的 provider,取数走全局 fetch 桩,
 * 含一致性戳 /.well-known/ui4a.json):
 * - 空 rel → 用法提示;404 → 不存在;非 200 → 服务不可用;200 → EntityView;
 * - 动作 exec 成功后精确失效 + tick 重拉(POST /api/exec 后再次 GET /api/entity)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { EntityCacheProvider } from '@/components/entity-cache-provider';
import { EntityPageBody } from '@/components/entity-page-body';

const postEntity: SirenEntity = {
  class: ['flow-instance', 'post-status'],
  properties: { rel: 'post:post-welcome', node: 'published', title: '已发布', fields: {} },
  actions: [
    {
      name: 'unpublish',
      title: '下线',
      method: 'POST',
      href: '/api/exec',
      fields: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  ],
  links: [{ rel: ['self'], href: '/api/entity?rel=post:post-welcome' }],
  'guard-results': [{ action: 'unpublish', blocked: false, guards: [] }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 页面取数桩:sitemap 一致性戳恒 200;实体响应由 entityResponse 给定。 */
function stubPageFetch(entityResponse: (rel: string) => Response) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(jsonResponse(200, { version: 'v1' }));
    }
    if (url.startsWith('/api/entity')) {
      const rel = new URL(url, 'http://localhost').searchParams.get('rel') ?? '';
      return Promise.resolve(entityResponse(rel));
    }
    return Promise.resolve(jsonResponse(200, { entity: postEntity }));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('实体页主体(EntityPageBody)', () => {
  it('空 rel → 用法提示', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <EntityCacheProvider>
        <EntityPageBody rel="" />
      </EntityCacheProvider>,
    );

    expect(await screen.findByText(/缺少 rel 参数/)).toBeTruthy();
  });

  it('未知 rel(404)→ 不存在提示', async () => {
    vi.stubGlobal(
      'fetch',
      stubPageFetch(() => jsonResponse(404, { error: '实体 "nope" 不存在' })),
    );
    render(
      <EntityCacheProvider>
        <EntityPageBody rel="nope" />
      </EntityCacheProvider>,
    );

    expect(await screen.findByText(/不存在\(404\)/)).toBeTruthy();
  });

  it('读取失败(非 200/404)→ 服务不可用提示', async () => {
    vi.stubGlobal(
      'fetch',
      stubPageFetch(() => jsonResponse(503, { error: 'db' })),
    );
    render(
      <EntityCacheProvider>
        <EntityPageBody rel="articles" />
      </EntityCacheProvider>,
    );

    expect(await screen.findByText(/服务不可用/)).toBeTruthy();
  });

  it('已知 rel → 渲染实体(标题与声明动作)', async () => {
    vi.stubGlobal(
      'fetch',
      stubPageFetch(() => jsonResponse(200, postEntity)),
    );
    render(
      <EntityCacheProvider>
        <EntityPageBody rel="post:post-welcome" />
      </EntityCacheProvider>,
    );

    expect(await screen.findByRole('heading', { name: '已发布' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下线' })).toBeTruthy();
  });

  it('动作 exec 成功后重拉实体(精确失效 + tick)', async () => {
    const fetchMock = stubPageFetch(() => jsonResponse(200, postEntity));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <EntityCacheProvider>
        <EntityPageBody rel="post:post-welcome" />
      </EntityCacheProvider>,
    );

    await screen.findByRole('button', { name: '下线' });
    // 首屏:一致性戳(GET /.well-known/ui4a.json)+ 实体(GET /api/entity)。
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '下线' }));

    await waitFor(() => {
      // exec(POST /api/exec)+ 失效后重拉(GET /api/entity;version 戳不重取)。
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toBe('/.well-known/ui4a.json');
    expect(urls[1]).toBe('/api/entity?rel=post%3Apost-welcome');
    expect(urls[2]).toBe('/api/exec');
    expect(urls[3]).toBe('/api/entity?rel=post%3Apost-welcome');
  });
});
