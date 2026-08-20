// @vitest-environment jsdom
/**
 * 实体页主体测试(T2 Phase F Verification 补齐):EntityPageBody 的取数状态机。
 *
 * 页面壳(app/entity/page.tsx)只做 use(searchParams) 解包,由 e2e/human.spec
 * 浏览器走查覆盖;此处在组件级覆盖状态机全分支:
 * - 空 rel → 用法提示;404 → 不存在;非 200 → 服务不可用;200 → EntityView;
 * - 动作 exec 成功后 tick 重拉(POST /api/exec 后再次 GET /api/entity)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('实体页主体(EntityPageBody)', () => {
  it('空 rel → 用法提示', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<EntityPageBody rel="" />);

    expect(await screen.findByText(/缺少 rel 参数/)).toBeTruthy();
  });

  it('未知 rel(404)→ 不存在提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { error: '实体 "nope" 不存在' })),
    );
    render(<EntityPageBody rel="nope" />);

    expect(await screen.findByText(/不存在\(404\)/)).toBeTruthy();
  });

  it('读取失败(非 200/404)→ 服务不可用提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { error: 'db' })));
    render(<EntityPageBody rel="articles" />);

    expect(await screen.findByText(/服务不可用/)).toBeTruthy();
  });

  it('已知 rel → 渲染实体(标题与声明动作)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, postEntity)));
    render(<EntityPageBody rel="post:post-welcome" />);

    expect(await screen.findByRole('heading', { name: '已发布' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下线' })).toBeTruthy();
  });

  it('动作 exec 成功后重拉实体(tick)', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/entity')) return Promise.resolve(jsonResponse(200, postEntity));
      return Promise.resolve(jsonResponse(200, { entity: postEntity }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<EntityPageBody rel="post:post-welcome" />);

    await screen.findByRole('button', { name: '下线' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '下线' }));

    await waitFor(() => {
      // exec(POST /api/exec)+ 重拉(GET /api/entity)
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[1]).toBe('/api/exec');
    expect(urls[2]).toBe('/api/entity?rel=post%3Apost-welcome');
  });
});
