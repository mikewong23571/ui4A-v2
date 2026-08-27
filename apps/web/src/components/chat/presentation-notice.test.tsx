// @vitest-environment jsdom
/**
 * 呈现回执条目(presentation 帧)测试:failed 终局在聊天时间线插入可见失败
 * 条目、pending 占位被失败/成功终局终结(不允许「正在准备呈现」永久悬挂)、
 * ready 导航回归、未知 reasonCode 走通用文案(不编造原因)。
 *
 * stub 口径同 floating-chat 套件(floating-chat-test-stubs.ts + next/navigation
 * mock);crypto.randomUUID 桩为固定 turnId,使 presentation 帧的 turnId 与本
 * 回合对得上(帧级 turnId 不符即丢弃)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingChat } from './floating-chat';
import {
  openChat,
  ResizeObserverStub,
  scriptedSseResponse,
  sendGoal,
  sseResponse,
} from './floating-chat-test-stubs';

// usePathname:jsdom 无 AppRouter 上下文;桩为 '/'(工作台壳生效路径)。
// useRouter:同上;push 桩经 vi.hoisted 提取(ready 导航回归的断言锚点)。
const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: routerPushMock }),
}));

const TURN_ID = 'turn-1';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // jsdom 未实现 Element.scrollTo(assistant-ui viewport 自动滚动调用),桩替换。
  Element.prototype.scrollTo = () => undefined;
  // 固定 turnId/sessionId:presentation 帧的 turnId 必须与本回合一致。
  vi.stubGlobal('crypto', { randomUUID: () => TURN_ID });
  routerPushMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('呈现回执条目(presentation 帧)', () => {
  it('failed 终局帧 → 时间线出现可见失败条目(中性主行 + reasonCode 次要)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            {
              type: 'presentation',
              turnId: TURN_ID,
              payload: {
                schemaVersion: 1,
                requestId: `${TURN_ID}:presentation:1`,
                status: 'failed',
                reasonCode: 'authorization-failed',
              },
            },
          ]),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('展示第一篇文章');

    await waitFor(() => {
      expect(
        screen.getByText('呈现失败 · 未获授权 · reasonCode=authorization-failed'),
      ).toBeTruthy();
    });
    // 不显示成功式话术(无「在画布查看」入口、无导航)。
    expect(screen.queryByRole('link', { name: /在画布查看/ })).toBeNull();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('pending 占位 → failed 终局替换为失败条目(不悬挂「正在准备呈现」)', async () => {
    const stream = scriptedSseResponse([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(stream.response)),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('展示第一篇文章');

    stream.push({
      type: 'presentation',
      turnId: TURN_ID,
      payload: { schemaVersion: 1, requestId: `${TURN_ID}:presentation:1`, status: 'pending' },
    });
    await waitFor(() => expect(screen.getByText('正在准备呈现')).toBeTruthy());

    stream.push({
      type: 'presentation',
      turnId: TURN_ID,
      payload: {
        schemaVersion: 1,
        requestId: `${TURN_ID}:presentation:1`,
        status: 'failed',
        reasonCode: 'planning-failed',
      },
    });
    await waitFor(() => {
      expect(screen.getByText('呈现失败 · 无法准备呈现 · reasonCode=planning-failed')).toBeTruthy();
    });
    expect(screen.queryByText('正在准备呈现')).toBeNull();

    stream.close();
  });

  it('pending → ready 终局:移除占位并保持导航(router.push 到 surfaceUrl)', async () => {
    const surfaceUrl = '/canvas?scope=publishing';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            {
              type: 'presentation',
              turnId: TURN_ID,
              payload: {
                schemaVersion: 1,
                requestId: `${TURN_ID}:presentation:1`,
                status: 'pending',
              },
            },
            {
              type: 'presentation',
              turnId: TURN_ID,
              payload: {
                schemaVersion: 1,
                requestId: `${TURN_ID}:presentation:1`,
                status: 'ready',
                surfaceUrl,
              },
            },
          ]),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('展示第一篇文章');

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith(surfaceUrl));
    expect(screen.queryByText('正在准备呈现')).toBeNull();
  });

  it('未知 reasonCode → 通用主行「呈现失败」,原文只作次要附属(不编造原因)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sseResponse([
            {
              type: 'presentation',
              turnId: TURN_ID,
              payload: {
                schemaVersion: 1,
                requestId: `${TURN_ID}:presentation:1`,
                status: 'failed',
                reasonCode: 'planner-unavailable',
              },
            },
          ]),
        ),
      ),
    );

    render(<FloatingChat />);
    openChat();
    sendGoal('展示第一篇文章');

    await waitFor(() => {
      expect(screen.getByText('呈现失败 · reasonCode=planner-unavailable')).toBeTruthy();
    });
  });
});
