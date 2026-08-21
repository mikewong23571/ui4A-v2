// @vitest-environment jsdom
/**
 * 悬浮聊天窗测试(T5 Phase B / Task 2 可选小改):委托模式开关——
 * "人类监控成本不随 N 超线性"的最贴合形态:发送后立即回执
 * 「已派发委托 <id>,进度见舰队页 /delegations」,委托后台执行,
 * 监控交给舰队页(不在悬浮窗内轮询长任务)。
 *
 * - 默认 inline:POST /api/chat 无 mode 字段,轨迹消息照旧渲染(既有行为);
 * - 委托模式:请求带 mode:'delegated',响应回执进对话(委托 id 短前缀 + 舰队页指路)。
 * jsdom 无 ResizeObserver(assistant-ui 的 viewport/composer 尺寸观测),桩替换。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingChat } from './floating-chat';

// assistant-ui 在浏览器用 ResizeObserver(jsdom 未实现;观测性桩足够渲染与交互)。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function openChat(): void {
  fireEvent.click(screen.getByRole('button', { name: '展开聊天窗' }));
}

/** 输入目标并点发送。 */
function sendGoal(goal: string): void {
  const input = screen.getByPlaceholderText('输入目标…') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: goal } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('悬浮聊天窗 · 委托模式(T5 Phase B)', () => {
  it('开启委托开关:请求带 mode=delegated,回执进对话(id 短前缀 + 舰队页指路)', async () => {
    const fetchMock = vi.fn((_url: string | URL | RequestInfo, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({
          mode: 'delegated',
          delegationId: 'abcdef12-3456-4789-bcde-f0123456789a',
          statusUrl: '/api/delegations/abcdef12-3456-4789-bcde-f0123456789a',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();

    const toggle = screen.getByRole('button', { name: '委托模式' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1]! as RequestInit).body as string) as Record<string, unknown>;
    expect(body.mode).toBe('delegated');
    expect(body.goal).toEqual({ verb: '发布一篇文章' });

    await waitFor(() => {
      expect(screen.getByText(/已派发委托 abcdef12/)).toBeTruthy();
    });
    expect(screen.getByText(/舰队页 \/delegations/)).toBeTruthy();
  });

  it('默认 inline:请求无 mode 字段,轨迹消息照旧(既有行为不动)', async () => {
    const fetchMock = vi.fn((_url: string | URL | RequestInfo, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({
          sessionId: 'sess-inline',
          driver: 'rule',
          outcome: 'done',
          summary: '目标完成',
          messages: [{ role: 'assistant', text: '导航到 articles' }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingChat />);
    openChat();
    sendGoal('发布一篇文章');

    await waitFor(() => {
      expect(screen.getByText('导航到 articles')).toBeTruthy();
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1]! as RequestInit).body as string) as Record<string, unknown>;
    expect('mode' in body).toBe(false);
    expect(body.goal).toEqual({ verb: '发布一篇文章' });
  });
});
