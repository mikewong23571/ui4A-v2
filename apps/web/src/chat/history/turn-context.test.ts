/**
 * turnContextRows / turnContextLine 纯映射测试(T56 P3.3 / D78 决定 5)。
 *
 * 显示口径纪律:userContextKnown ∧ clientView 在场才显示「当时」观察;
 * 观察存在但未定位显式「未定位」;两种未知来路(旧版无观察 / user 事件
 * 缺失)UI 同形「当时上下文未知」,不猜、不用当前 presence 补造。
 */
import { describe, expect, it } from 'vitest';

import type { ChatTurn } from '../history';
import { turnContextLine, turnContextRows } from './turn-context';

function turn(args: {
  turnId: string;
  userContextKnown: boolean;
  clientView?: {
    schemaVersion: 2;
    presence: {
      clientInstanceId: string;
      site: string;
      scope: string | null;
      thread: string | null;
      focus: string | { selection: string[] } | null;
    };
  };
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
    ...(args.clientView === undefined ? {} : { clientView: args.clientView }),
  };
}

const VIEW = {
  schemaVersion: 2 as const,
  presence: {
    clientInstanceId: 'client',
    site: 'workstation',
    scope: 'publishing',
    thread: 'thread:t1',
    focus: 'idea:x' as const,
  },
};

describe('turnContextRows', () => {
  it('有观察 → known 且携带当时 thread/focus;无观察或事件缺失 → 显式 unknown', () => {
    const rows = turnContextRows([
      turn({ turnId: 'turn-known', userContextKnown: true, clientView: VIEW }),
      turn({ turnId: 'turn-noobsv', userContextKnown: true }),
      turn({ turnId: 'turn-orphan', userContextKnown: false }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      turnId: 'turn-known',
      position: 1,
      known: true,
      thread: 'thread:t1',
      focus: 'idea:x',
    });
    expect(rows[1]).toMatchObject({ turnId: 'turn-noobsv', position: 2, known: false });
    expect(rows[2]).toMatchObject({ turnId: 'turn-orphan', position: 3, known: false });
  });

  it('观察在场但未定位(thread/focus 皆 null)→ known=true 且 thread/focus 为 null', () => {
    const rows = turnContextRows([
      turn({
        turnId: 'turn-unlocated',
        userContextKnown: true,
        clientView: {
          schemaVersion: 2,
          presence: { ...VIEW.presence, thread: null, focus: null },
        },
      }),
    ]);
    expect(rows[0]!.known).toBe(true);
    expect(rows[0]!.thread).toBeNull();
    expect(rows[0]!.focus).toBeNull();
  });
});

describe('turnContextLine', () => {
  it('unknown 显式「当时上下文未知」,不带任何猜测的线/对象', () => {
    const [row] = turnContextRows([turn({ turnId: 'turn-u', userContextKnown: false })]);
    expect(turnContextLine(row!)).toBe('第 1 问 · 当时上下文未知');
  });

  it('known 完整观察 → 「当时:线 <thread> · 注视 <focus>」', () => {
    const [row] = turnContextRows([
      turn({ turnId: 'turn-k', userContextKnown: true, clientView: VIEW }),
    ]);
    expect(turnContextLine(row!)).toBe('第 1 问 · 当时:线 thread:t1 · 注视 idea:x');
  });

  it('仅线或仅注视时只显示在场的轴;selection 注视按 rel 序拼接', () => {
    const [threadOnly] = turnContextRows([
      turn({
        turnId: 'turn-t',
        userContextKnown: true,
        clientView: {
          schemaVersion: 2,
          presence: { ...VIEW.presence, focus: null },
        },
      }),
    ]);
    expect(turnContextLine(threadOnly!)).toBe('第 1 问 · 当时:线 thread:t1');
    const [selectionFocus] = turnContextRows([
      turn({
        turnId: 'turn-s',
        userContextKnown: true,
        clientView: {
          schemaVersion: 2,
          presence: {
            ...VIEW.presence,
            thread: null,
            focus: { selection: ['idea:a', 'idea:b'] },
          },
        },
      }),
    ]);
    expect(turnContextLine(selectionFocus!)).toBe('第 1 问 · 当时:注视 idea:a、idea:b');
  });

  it('known 但未定位 → 显式「未定位」(与 unknown 严格区分)', () => {
    const [row] = turnContextRows([
      turn({
        turnId: 'turn-n',
        userContextKnown: true,
        clientView: {
          schemaVersion: 2,
          presence: { ...VIEW.presence, thread: null, focus: null },
        },
      }),
    ]);
    expect(turnContextLine(row!)).toBe('第 1 问 · 当时:未定位');
  });
});
