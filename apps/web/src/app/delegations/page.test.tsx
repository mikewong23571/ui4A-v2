// @vitest-environment jsdom
/**
 * 委托舰队页测试(T5 Phase B / Task 2):/delegations = 委托执行的人类监控视图
 * (spec 验收 5;arch-brief §9.3"人类监控成本不随 N 超线性"——一行一委托,
 * 状态/步数/成功数/摘要一眼可扫)。
 *
 * - 列表渲染:GET /api/delegations → 每委托一行(目标/状态/步数/成功/摘要);
 * - 状态徽标:running default / completed secondary / failed destructive /
 *   max-steps outline(shadcn Badge,data-status + data-variant 断言);
 * - 空态:暂无委托;
 * - 自动轮询:每 3s 重拉(舰队页零操作刷新)+ 手动重新载入;
 * - 失败态:服务不可用如实提示(不粉饰)。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DelegationsPage from './page';

interface FleetRow {
  id: string;
  goal: { verb: string; fields?: Record<string, unknown> };
  status: 'running' | 'completed' | 'failed' | 'max-steps';
  steps: number;
  successes: number;
  summary?: string;
  reason?: string;
}

function row(overrides: Partial<FleetRow> = {}): FleetRow {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    goal: { verb: '发布一篇文章', fields: { title: '舰队首航' } },
    status: 'completed',
    steps: 6,
    successes: 4,
    summary: '目标完成: publish 已成功',
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** /api/delegations 列表桩(计数调用)。 */
function mockFleet(rows: FleetRow[]) {
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ delegations: rows })));
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('委托舰队页(/delegations)', () => {
  it('列表渲染:每委托一行(目标/状态/步数/成功/摘要),表头可见', async () => {
    const fetchMock = mockFleet([
      row(),
      row({
        id: 'aaaaaaa1-0000-0000-0000-000000000000',
        goal: { verb: '审核', fields: { resource: 'comment:c1' } },
        status: 'running',
        steps: 2,
        successes: 0,
        summary: undefined,
      }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    render(<DelegationsPage />);

    await waitFor(() => {
      expect(screen.getByText(/舰队首航/)).toBeTruthy();
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('委托监控');
    expect(screen.getByText(/每 3s 自动刷新/).textContent).toContain('执行中');
    for (const header of ['目标', '状态', '步数', '成功', '摘要']) {
      expect(screen.getByText(header)).toBeTruthy();
    }
    // 行内容:目标动词 + 字段值;计数列;摘要列。
    expect(screen.getByText(/发布一篇文章/)).toBeTruthy();
    expect(screen.getByText(/目标完成: publish 已成功/)).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText(/审核 · comment:c1/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/delegations');
  });

  it('状态徽标:running/completed/failed/max-steps → Badge variant(data-status 锚点)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFleet([
        row({ id: 'id-running-0000', status: 'running', summary: undefined }),
        row({ id: 'id-completed0', status: 'completed' }),
        row({ id: 'id-failed-000', status: 'failed', summary: undefined, reason: '目标不可达' }),
        row({
          id: 'id-maxsteps00',
          status: 'max-steps',
          summary: undefined,
          reason: '达到步数上限 24',
        }),
      ]),
    );

    render(<DelegationsPage />);

    await waitFor(() => {
      expect(screen.getByText('id-running-0000'.slice(0, 8))).toBeTruthy();
    });
    const expected: [FleetRow['status'], string][] = [
      ['running', 'default'],
      ['completed', 'secondary'],
      ['failed', 'destructive'],
      ['max-steps', 'outline'],
    ];
    for (const [status, variant] of expected) {
      const badge = document.querySelector(`[data-status="${status}"]`);
      expect(badge, `状态 ${status} 应有 data-status 徽标`).not.toBeNull();
      expect(badge!.getAttribute('data-variant')).toBe(variant);
    }
  });

  it('空态:暂无委托(空舰队是合法状态)', async () => {
    vi.stubGlobal('fetch', mockFleet([]));
    render(<DelegationsPage />);
    await waitFor(() => {
      expect(screen.getByText('暂无委托')).toBeTruthy();
    });
  });

  it('失败态:服务不可用如实提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    render(<DelegationsPage />);
    await waitFor(() => {
      expect(screen.getByText(/读取委托列表失败/)).toBeTruthy();
    });
  });

  it('自动轮询:每 3s 重新拉取(零操作刷新)', async () => {
    const fetchMock = mockFleet([row()]);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);

    render(<DelegationsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('手动重新载入:立即重拉', async () => {
    const fetchMock = mockFleet([row()]);
    vi.stubGlobal('fetch', fetchMock);

    render(<DelegationsPage />);
    await waitFor(() => {
      expect(screen.getByText(/舰队首航/)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
