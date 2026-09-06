// @vitest-environment jsdom
/**
 * TurnContextNotice 组件测试(T56 P3.3 / US08):历史回合当时上下文的显式
 * 呈现——known 行逐条直出固定词表行,unknown 行显式「当时上下文未知」;
 * 空行序列不渲染任何占位(无历史不占位)。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { turnContextRows } from '@/chat/history/turn-context';
import type { ChatTurn } from '@/chat/history';

import { TurnContextNotice } from './turn-context-notice';

afterEach(() => {
  cleanup();
});

function turn(args: {
  turnId: string;
  userContextKnown: boolean;
  thread?: string | null;
  focus?: string | null;
}): ChatTurn {
  return {
    seq: 1,
    ts: '2026-09-06T00:00:00.000Z',
    sessionId: 'sess',
    turnId: args.turnId,
    goal: { verb: '目标' },
    outcome: 'done',
    summary: null,
    messages: [],
    steps: [],
    driver: 'llm',
    status: 'final',
    userContextKnown: args.userContextKnown,
    ...(args.thread === undefined && args.focus === undefined
      ? {}
      : {
          clientView: {
            schemaVersion: 2 as const,
            presence: {
              clientInstanceId: 'client',
              site: 'workstation',
              scope: 'publishing',
              thread: args.thread ?? null,
              focus: args.focus ?? null,
            },
          },
        }),
  };
}

describe('TurnContextNotice', () => {
  it('known/unknown 混合回合一屏两态:known 行带当时线/对象,unknown 行显式未知', () => {
    const rows = turnContextRows([
      turn({
        turnId: 'turn-a',
        userContextKnown: true,
        thread: 'thread:t-a',
        focus: 'idea:a',
      }),
      turn({ turnId: 'turn-u', userContextKnown: false }),
    ]);
    const { container } = render(<TurnContextNotice rows={rows} />);
    expect(screen.getByTestId('turn-context-notice').textContent).toContain('历史回合当时上下文');
    const rendered = screen.getAllByTestId('turn-context-row');
    expect(rendered).toHaveLength(2);
    expect(rendered[0]!.getAttribute('data-known')).toBe('true');
    expect(rendered[0]!.textContent).toContain('线 thread:t-a');
    expect(rendered[0]!.textContent).toContain('注视 idea:a');
    expect(rendered[1]!.getAttribute('data-known')).toBe('false');
    expect(rendered[1]!.textContent).toBe('第 2 问 · 当时上下文未知');
    expect(container.textContent).not.toContain('idea:b');
  });

  it('空行序列不渲染(无历史回合不占位)', () => {
    const { container } = render(<TurnContextNotice rows={[]} />);
    expect(container.querySelector('[data-testid="turn-context-notice"]')).toBeNull();
    expect(screen.queryByTestId('turn-context-row')).toBeNull();
  });
});
