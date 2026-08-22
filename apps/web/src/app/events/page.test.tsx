// @vitest-environment jsdom
/**
 * 事件流页测试(T7 Phase B / spec 架构决定 5):/api/events 投影 →
 * timeline 词条(react-chrono,零 AI)。
 *
 * - 事件与 /api/events 逐条一致(acceptance 5:seq/kind/rel/action 可见);
 * - 分页 afterSeq:加载更多经 afterSeq=<已显示尾部 seq> 重取(增量窗口,
 *   回包 ≤ PAGE_SIZE 即尾部);
 * - 可点元素标注:加载更多 data-nav(I3 基础)。
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
  return { seq, ts: `2026-08-22T01:${String(seq).padStart(2, '0')}:00.000Z`, kind, rel, action: 'unpublish', actor: 'human', principal: 'local-user', channel: 'renderer' };
}

/** 每次调用产出新 Response(body 只能读一次;mock 必须逐次新造)。 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('事件流页(/events,timeline 零 AI)', () => {
  it('/api/events 投影 → 时间线条目与事件逐条一致(小批即尾部,无分页按钮)', async () => {
    const events: EventRow[] = [
      { seq: 1, ts: '2026-08-22T01:00:00.000Z', kind: 'seed', rel: 'seed:business-domain', action: null, actor: null, principal: null, channel: null },
      row(2, 'action-executed', 'post:post-welcome'),
      { seq: 3, ts: '2026-08-22T01:03:00.000Z', kind: 'render-spec-frozen', rel: 'render-spec:articles-by-category', action: null, actor: 'agent', principal: null, channel: null },
    ];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ events }))));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ events })));
    const { container } = render(<EventsPage />);

    await waitFor(() => expect(container.textContent).toContain('已拒绝：高风险动作需要人类确认'));
    const disclosure = container.querySelector('details');
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.textContent).toContain('high-risk-confirm');
  });

  it('分页 afterSeq:首批超页 → 加载更多经尾部 seq 重取增量窗口', async () => {
    const firstBatch = Array.from({ length: 25 }, (_, index) => row(index + 1));
    const secondBatch = [row(26, 'confirmation-requested', 'confirmation:c1'), row(27)];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('afterSeq=0')) return Promise.resolve(jsonResponse({ events: firstBatch }));
      if (url.includes('afterSeq=20')) return Promise.resolve(jsonResponse({ events: secondBatch }));
      return Promise.resolve(jsonResponse({ events: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<EventsPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-word="timeline"]')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/events?afterSeq=0');

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/events?afterSeq=20');
    });
    await waitFor(() => {
      const text = container.querySelector('[data-word="timeline"]')?.textContent ?? '';
      expect(text).toContain('confirmation-requested');
      expect(text).toContain('confirmation:c1');
    });
  });

  it('可点元素标注:加载更多 data-nav(本地视图控件)', async () => {
    const firstBatch = Array.from({ length: 25 }, (_, index) => row(index + 1));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ events: firstBatch }))),
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
