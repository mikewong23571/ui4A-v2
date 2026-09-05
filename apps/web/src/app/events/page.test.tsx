// @vitest-environment jsdom
/**
 * 事件流页测试(T7 Phase B / spec 架构决定 5):/api/events 投影 →
 * timeline 词条(react-chrono,零 AI)。
 *
 * - 事件与 /api/events 逐条一致(acceptance 5:seq/kind/rel/action 可见);
 * - 分页 afterSeq:加载更多经 afterSeq=<已显示尾部 seq> 重取(增量窗口,
 *   回包 ≤ PAGE_SIZE 即尾部);
 * - 可点元素标注:加载更多 data-nav(I3 基础)。
 * - 只读过滤(G13):domain(合同枚举)/kind(精确匹配)显式收窄,过滤参数
 *   随请求发送;当前过滤可见 + 一键清除恢复全量;过滤后翻页沿用 beforeSeq
 *   游标不丢失不重复;空态区分「全量空」与「过滤无匹配」。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubBrowserApis } from '@/test/browser-stubs';

import EventsPage from './page';

stubBrowserApis();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stubBrowserApis();
});

interface EventRow {
  seq: number;
  ts?: string;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: string | null;
  principal: string | null;
  channel: string | null;
  reason?: string | null;
  detail?: unknown;
}

function row(seq: number, kind = 'action-executed', rel = 'post:post-welcome'): EventRow {
  return {
    seq,
    ts: `2026-08-22T01:${String(seq).padStart(2, '0')}:00.000Z`,
    kind,
    rel,
    action: 'unpublish',
    actor: 'human',
    principal: 'local-user',
    channel: 'renderer',
  };
}

/** 每次调用产出新 Response(body 只能读一次;mock 必须逐次新造)。 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('事件流页(/events,timeline 零 AI)', () => {
  it('/api/events 最新投影 → 时间线按 seq 倒序且事件逐条一致', async () => {
    const events: EventRow[] = [
      {
        seq: 3,
        ts: '2026-08-22T01:03:00.000Z',
        kind: 'render-spec-frozen',
        rel: 'render-spec:articles-by-category',
        action: null,
        actor: 'agent',
        principal: null,
        channel: null,
      },
      row(2, 'action-executed', 'post:post-welcome'),
      {
        seq: 1,
        ts: '2026-08-22T01:00:00.000Z',
        kind: 'seed',
        rel: 'seed:business-domain',
        action: null,
        actor: null,
        principal: null,
        channel: null,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ events, page: { hasMore: false, nextBeforeSeq: null } })),
        ),
    );
    const { container } = render(<EventsPage />);

    // chrono 异步挂载条目:等内容出现再逐条断言
    await waitFor(() => {
      expect(container.querySelector('[data-word="timeline"]')?.textContent).toContain('seed');
    });
    const text = container.querySelector('[data-word="timeline"]')?.textContent ?? '';
    for (const event of events) {
      expect(text).toContain(String(event.seq));
      expect(text).toContain(event.kind);
      if (event.rel !== null) expect(text).toContain(event.rel);
    }
    expect(text).toContain('unpublish');
    expect(text).toContain('执行「unpublish」');
    expect(container.querySelectorAll('time')).toHaveLength(3);
    expect(container.querySelectorAll('details:not([open])')).toHaveLength(3);
    const renderedSeqs = [...container.querySelectorAll('[data-word="timeline"] li')].map(
      (item) => item.querySelector('[aria-hidden]')?.textContent,
    );
    expect(renderedSeqs).toEqual(['3', '2', '1']);
    // 回包 ≤ PAGE_SIZE → 尾部已到,无分页按钮
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('拒绝原因与 detail 在折叠审计层保留,摘要行直接给出结果', async () => {
    const events: EventRow[] = [
      {
        ...row(1, 'action-rejected', 'post:p1'),
        action: 'archive',
        reason: '高风险动作需要人类确认',
        detail: { layer: 'policy', policy: 'high-risk-confirm' },
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ events, page: { hasMore: false, nextBeforeSeq: null } })),
    );
    const { container } = render(<EventsPage />);

    await waitFor(() => expect(container.textContent).toContain('已拒绝：高风险动作需要人类确认'));
    const disclosure = container.querySelector('details');
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.textContent).toContain('high-risk-confirm');
  });

  it('分页 beforeSeq:最新一页向更早事件加载', async () => {
    const firstBatch = Array.from({ length: 20 }, (_, index) => row(40 - index));
    const secondBatch = [row(20, 'confirmation-requested', 'confirmation:c1'), row(19)];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/events?order=desc&limit=20') {
        return Promise.resolve(
          jsonResponse({
            events: firstBatch,
            page: { hasMore: true, nextBeforeSeq: 21 },
          }),
        );
      }
      if (url.includes('beforeSeq=21')) {
        return Promise.resolve(
          jsonResponse({
            events: secondBatch,
            page: { hasMore: false, nextBeforeSeq: null },
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({ events: [], page: { hasMore: false, nextBeforeSeq: null } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<EventsPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-word="timeline"]')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/events?order=desc&limit=20');

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/events?order=desc&limit=20&beforeSeq=21');
    });
    await waitFor(() => {
      const text = container.querySelector('[data-word="timeline"]')?.textContent ?? '';
      expect(text).toContain('confirmation-requested');
      expect(text).toContain('confirmation:c1');
    });
  });

  it('可点元素标注:加载更多 data-nav(本地视图控件)', async () => {
    const firstBatch = Array.from({ length: 20 }, (_, index) => row(20 - index));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          jsonResponse({
            events: firstBatch,
            page: { hasMore: true, nextBeforeSeq: 1 },
          }),
        ),
      ),
    );
    const { container } = render(<EventsPage />);
    await waitFor(() => {
      expect(container.querySelector('button[data-nav="local:events-more"]')).not.toBeNull();
    });
  });

  it('读取失败 → 如实呈错(不粉饰)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    render(<EventsPage />);
    await waitFor(() => {
      expect(screen.getByText(/读取事件失败/)).toBeTruthy();
    });
  });
});

describe('事件流页只读过滤(/events,G13)', () => {
  it('默认全量不变;输入草稿不触发请求;显式应用后过滤参数随请求发送且当前过滤可见', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ events: [row(1)], page: { hasMore: false, nextBeforeSeq: null } }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<EventsPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-word="timeline"]')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/events?order=desc&limit=20');
    expect(screen.queryByTestId('active-filters')).toBeNull();

    // 草稿只是本地输入:未点「应用过滤」前不产生新请求
    fireEvent.change(screen.getByLabelText(/事件域/), { target: { value: 'core' } });
    fireEvent.change(screen.getByLabelText(/kind/), { target: { value: 'action-executed' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '应用过滤' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/events?order=desc&limit=20&domain=core&kind=action-executed',
      );
    });
    expect(screen.getByTestId('active-filters').textContent).toContain('domain=core');
    expect(screen.getByTestId('active-filters').textContent).toContain('kind=action-executed');
  });

  it('一键清除 → 恢复全量请求(无过滤参数、无游标,从头部开始)且过滤指示消失', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('domain=presence')) {
        return Promise.resolve(
          jsonResponse({
            events: [row(7, 'presence-snapshot')],
            page: { hasMore: false, nextBeforeSeq: null },
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          events: [row(9, 'seed', 'seed:business-domain'), row(8)],
          page: { hasMore: false, nextBeforeSeq: null },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<EventsPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-word="timeline"]')).not.toBeNull();
    });
    fireEvent.change(screen.getByLabelText(/事件域/), { target: { value: 'presence' } });
    fireEvent.click(screen.getByRole('button', { name: '应用过滤' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/events?order=desc&limit=20&domain=presence');
    });

    fireEvent.click(screen.getByRole('button', { name: '清除过滤' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/events?order=desc&limit=20');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('active-filters')).toBeNull();
    });
    // 清除后从头部开始:全量首屏(含 seed)重新可见,下拉恢复「全部」
    await waitFor(() => {
      expect(container.querySelector('[data-word="timeline"]')?.textContent).toContain('seed');
    });
    expect((screen.getByLabelText(/事件域/) as HTMLSelectElement).value).toBe('');
  });

  it('过滤后翻页沿用 nextBeforeSeq 游标:跨页 seq 不丢失、不重复(不本地去重)', async () => {
    const firstBatch = Array.from({ length: 20 }, (_, index) => row(60 - index));
    const secondBatch = [row(40), row(39)];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('beforeSeq=41')) {
        return Promise.resolve(
          jsonResponse({ events: secondBatch, page: { hasMore: false, nextBeforeSeq: null } }),
        );
      }
      return Promise.resolve(
        jsonResponse({ events: firstBatch, page: { hasMore: true, nextBeforeSeq: 41 } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<EventsPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-word="timeline"]')).not.toBeNull();
    });
    fireEvent.change(screen.getByLabelText(/kind/), { target: { value: 'action-executed' } });
    fireEvent.click(screen.getByRole('button', { name: '应用过滤' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/events?order=desc&limit=20&kind=action-executed',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/events?order=desc&limit=20&kind=action-executed&beforeSeq=41',
      );
    });
    await waitFor(() => {
      const items = [...container.querySelectorAll('[data-word="timeline"] li')];
      expect(items).toHaveLength(22); // 20 + 2,无丢失
      const renderedSeqs = items.map((item) => item.querySelector('[aria-hidden]')?.textContent);
      expect(new Set(renderedSeqs).size).toBe(22); // 无重复(游标保证,非本地去重)
      expect(renderedSeqs).toContain('40');
      expect(renderedSeqs).toContain('39');
    });
  });

  it('空态区分:全量空 → 暂无事件;过滤无匹配 → 明确空态文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            jsonResponse({ events: [], page: { hasMore: false, nextBeforeSeq: null } }),
          ),
        ),
    );
    render(<EventsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-events').textContent).toContain('暂无事件');
    });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('domain=capability')) {
        return Promise.resolve(
          jsonResponse({ events: [], page: { hasMore: false, nextBeforeSeq: null } }),
        );
      }
      return Promise.resolve(
        jsonResponse({ events: [row(1)], page: { hasMore: false, nextBeforeSeq: null } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    cleanup();
    stubBrowserApis();
    render(<EventsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '应用过滤' })).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/事件域/), { target: { value: 'capability' } });
    fireEvent.click(screen.getByRole('button', { name: '应用过滤' }));
    await waitFor(() => {
      expect(screen.getByTestId('empty-events').textContent).toContain('当前过滤条件下无匹配事件');
    });
    // 空态下仍可一键清除恢复全量
    expect(screen.getByRole('button', { name: '清除过滤' })).toBeTruthy();
  });

  it('过滤请求失败(HTTP 非 2xx)→ 按现有页面错误口径呈错,过滤状态仍可见', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('domain=core')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: 'principal filter cannot exceed credential scope' }),
            {
              status: 403,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      }
      return Promise.resolve(
        jsonResponse({ events: [row(1)], page: { hasMore: false, nextBeforeSeq: null } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<EventsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '应用过滤' })).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(/事件域/), { target: { value: 'core' } });
    fireEvent.click(screen.getByRole('button', { name: '应用过滤' }));
    await waitFor(() => {
      expect(screen.getByText(/读取事件失败/)).toBeTruthy();
    });
    expect(screen.getByTestId('active-filters').textContent).toContain('domain=core');
  });
});
