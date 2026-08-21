// @vitest-environment jsdom
/**
 * BIOS 列表面(T4 Phase C Task 2):meta/flows 定义清单与 meta/activations
 * 激活队列。读 /_meta/api/entity(同引擎同日志,跨站显式意图),成员链接进
 * BIOS 详情页(/meta/flow/<name>、/meta/activation/<id>)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { ActivationsQueueBody } from './meta-lists';
import { FlowsListBody } from './meta-lists';

const flowsEntity: SirenEntity = {
  class: ['collection', 'meta/flows'],
  properties: { rel: 'meta/flows', count: 2 },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/flows' }],
  'guard-results': [],
  entities: [
    {
      class: ['meta', 'flow-definition'],
      rel: ['item'],
      href: '/_meta/api/entity?rel=meta/flow:article-drafting',
      properties: { name: 'article-drafting', version: 1, status: 'active' },
      actions: [],
      links: [],
    },
    {
      class: ['meta', 'flow-definition'],
      rel: ['item'],
      href: '/_meta/api/entity?rel=meta/flow:post-status',
      properties: { name: 'post-status', version: 2, status: 'pending-approval' },
      actions: [],
      links: [],
    },
  ],
};

const activationsEntity: SirenEntity = {
  class: ['collection', 'meta/activations'],
  properties: { rel: 'meta/activations', count: 1 },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/activations' }],
  'guard-results': [],
  entities: [
    {
      class: ['meta', 'activation', 'pending-approval'],
      rel: ['item'],
      href: '/_meta/api/entity?rel=meta/activation:a1',
      properties: {
        id: 'a1',
        flow: 'article-drafting',
        status: 'pending-approval',
        version: 2,
        'requested-by': { actor: 'agent', principal: 'user:mike' },
      },
      actions: [],
      links: [],
    },
  ],
};

const emptyActivations: SirenEntity = {
  class: ['collection', 'meta/activations'],
  properties: { rel: 'meta/activations', count: 0 },
  actions: [],
  links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta/activations' }],
  'guard-results': [],
  entities: [],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FlowsListBody(定义清单面)', () => {
  it('成员逐条链接到 /meta/flow/<name>,状态与版本可见;请求打 /_meta/api/entity', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      // meta 客户端按 encodeURIComponent 上送(rel 中的 / 编码为 %2F)。
      if (url.startsWith('/_meta/api/entity?rel=meta%2Fflows')) {
        return Promise.resolve(jsonResponse(flowsEntity));
      }
      return Promise.resolve(jsonResponse({ error: `未知端点 ${url}` }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<FlowsListBody />);
    await waitFor(() =>
      expect(container.querySelector('a[href="/meta/flow/article-drafting"]')).not.toBeNull(),
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('/_meta/api/entity?rel=meta%2Fflows');
    expect(container.querySelector('a[href="/meta/flow/post-status"]')).not.toBeNull();
    expect(screen.getByText(/pending-approval/)).toBeTruthy();
    expect(screen.getByText(/v2/)).toBeTruthy();
  });
});

describe('ActivationsQueueBody(激活队列面)', () => {
  it('pending 激活逐条链接到 /meta/activation/<id>,提议者可见', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(activationsEntity));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<ActivationsQueueBody />);
    await waitFor(() =>
      expect(container.querySelector('a[href="/meta/activation/a1"]')).not.toBeNull(),
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('/_meta/api/entity?rel=meta%2Factivations');
    expect(screen.getByText(/article-drafting/)).toBeTruthy();
    expect(screen.getByText(/user:mike/)).toBeTruthy();
  });

  it('空队列:呈现队列为空提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(emptyActivations)));
    render(<ActivationsQueueBody />);
    await waitFor(() => expect(screen.getByText(/队列为空/)).toBeTruthy());
  });
});
