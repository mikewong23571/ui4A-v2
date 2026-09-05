// @vitest-environment jsdom
/**
 * 历史会话清单测试(G11 / 证据 A33/R22):清单行是日志投影的末回合快照,
 * 终态须按「上次回合结果」的历史口径呈现——suspended 的「待确认」不得裸呈
 * 为当前待办;非 suspended 终态措辞不受影响;目标预览的截断机制(truncate)
 * 现状钉测试。多会话切换/刷新的重放不串台由 floating-chat-session.test.tsx
 * 的 U1/U3 锚定,此处只锚定清单行自身的渲染契约与切换回调。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatSessionSummary } from '@/chat/history';

import type { ChatSession } from './chat-types';
import { SessionList } from './session-list';

/** 最小 ChatSession 桩(SessionList 只消费 sessions/sessionId/selectSession)。 */
function sessionStub(
  sessions: ChatSessionSummary[],
  overrides: Partial<Pick<ChatSession, 'sessionId' | 'selectSession'>> = {},
): ChatSession {
  return {
    sessionId: 'sess-current',
    isRunning: false,
    delegated: false,
    lastRender: undefined,
    lastPresentation: undefined,
    lastFocus: undefined,
    toggleDelegated: () => undefined,
    startNewSession: () => undefined,
    runtime: {} as ChatSession['runtime'],
    view: 'sessions',
    sessions,
    sessionsError: null,
    openSessions: () => undefined,
    closeSessions: () => undefined,
    selectSession: () => undefined,
    ...overrides,
  };
}

/** 清单行夹具(字段直出投影形状)。 */
function row(overrides: Partial<ChatSessionSummary> & { sessionId: string }): ChatSessionSummary {
  return {
    turns: 1,
    firstTs: '2026-09-05T08:00:00.000Z',
    lastTs: '2026-09-05T09:00:00.000Z',
    lastGoal: '清单目标',
    lastOutcome: 'done',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('SessionList · 末回合终态的历史口径(G11 / A33/R22)', () => {
  it('suspended 标注为「上次回合:待确认」,不裸呈当前待办', () => {
    render(
      <SessionList
        session={sessionStub([row({ sessionId: 'sess-susp', lastOutcome: 'suspended' })])}
      />,
    );

    expect(screen.getByText('上次回合:待确认')).toBeTruthy();
    // 裸「待确认」(当前待办口径)不得在场。
    expect(screen.queryByText('待确认')).toBeNull();
  });

  it('非 suspended 终态措辞不受影响(无历史前缀)', () => {
    render(
      <SessionList
        session={sessionStub([
          row({ sessionId: 'sess-done', lastOutcome: 'done' }),
          row({ sessionId: 'sess-failed', lastOutcome: 'failed' }),
          row({ sessionId: 'sess-max', lastOutcome: 'max-steps' }),
        ])}
      />,
    );

    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText('步数上限')).toBeTruthy();
    expect(screen.queryByText('上次回合:完成')).toBeNull();
    expect(screen.queryByText('上次回合:失败')).toBeNull();
    expect(screen.queryByText('上次回合:步数上限')).toBeNull();
  });

  it('目标预览的截断机制在场(truncate class)', () => {
    render(
      <SessionList
        session={sessionStub([row({ sessionId: 'sess-trunc', lastGoal: '发布一篇文章' })])}
      />,
    );

    expect(screen.getByText('发布一篇文章').className).toContain('truncate');
  });

  it('多行各自渲染目标与终态;点击行回调 selectSession(该行 sessionId)', () => {
    const selectSession = vi.fn<(sessionId: string) => void>();
    render(
      <SessionList
        session={sessionStub(
          [
            row({ sessionId: 'sess-a', lastGoal: 'A 的目标', lastOutcome: 'suspended', turns: 3 }),
            row({ sessionId: 'sess-b', lastGoal: 'B 的目标', lastOutcome: 'done', turns: 1 }),
          ],
          { selectSession },
        )}
      />,
    );

    expect(screen.getByText('A 的目标')).toBeTruthy();
    expect(screen.getByText('B 的目标')).toBeTruthy();
    expect(screen.getByText('上次回合:待确认')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.getByText('3 回合')).toBeTruthy();
    expect(screen.getByText('1 回合')).toBeTruthy();

    fireEvent.click(screen.getByText('B 的目标'));
    expect(selectSession).toHaveBeenCalledWith('sess-b');
  });
});
