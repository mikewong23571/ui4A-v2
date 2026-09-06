/**
 * projectChatTurns 纯投影测试(T56 P3.3 / D78 决定 5)。
 *
 * 覆盖:user 原话事件按 turnId 精确 join、principal 双键再校验(D68.3 纵深
 * 防御)、rel×detail.sessionId 会话归属、缺失上下文两态可分、running 回合
 * join、损坏 clientView 按缺失处理、citations join 保持既有口径。
 */
import { describe, expect, it } from 'vitest';

import { projectChatTurns, type ChatHistoryEvent } from './project-turns';

const SESSION = 't56p33-proj-sess';

function baseEvent(args: Partial<ChatHistoryEvent> & { kind: string }): ChatHistoryEvent {
  return {
    seq: 1,
    ts: '2026-09-06T00:00:00.000Z',
    rel: `chat:${SESSION}`,
    principal: 'user:p1',
    detail: null,
    ...args,
  };
}

function userMessage(args: {
  seq?: number;
  turnId: string;
  principal?: string;
  clientView?: unknown;
  sessionId?: string;
}): ChatHistoryEvent {
  return baseEvent({
    seq: args.seq,
    kind: 'chat-message-appended',
    ...(args.principal === undefined ? {} : { principal: args.principal }),
    detail: {
      sessionId: args.sessionId ?? SESSION,
      turnId: args.turnId,
      messageId: args.turnId,
      role: 'user',
      content: '原话',
      provenance: { kind: 'user-input' },
      ...(args.clientView === undefined ? {} : { clientView: args.clientView }),
    },
  });
}

function assistantCitation(args: { seq?: number; turnId: string; rel: string }): ChatHistoryEvent {
  return baseEvent({
    seq: args.seq,
    kind: 'chat-message-appended',
    detail: {
      sessionId: SESSION,
      turnId: args.turnId,
      messageId: `${args.turnId}:assistant`,
      role: 'assistant',
      content: '回答',
      provenance: { kind: 'assistant-output' },
      citations: [{ rel: args.rel, pointer: '/properties/status' }],
    },
  });
}

function finalTurn(args: {
  seq?: number;
  turnId: string;
  principal?: string;
  verb?: string;
  sessionId?: string;
}): ChatHistoryEvent {
  return baseEvent({
    seq: args.seq,
    kind: 'chat-turn',
    ...(args.principal === undefined ? {} : { principal: args.principal }),
    detail: {
      sessionId: args.sessionId ?? SESSION,
      turnId: args.turnId,
      goal: { verb: args.verb ?? '目标' },
      outcome: 'done',
      summary: null,
      messages: [{ role: 'assistant', text: '回答' }],
      steps: [],
      driver: 'llm',
    },
  });
}

const VIEW_A = {
  schemaVersion: 2 as const,
  presence: {
    clientInstanceId: 'client-a',
    site: 'workstation',
    scope: 'publishing',
    thread: 'thread:t-a',
    focus: 'idea:a',
  },
};

const VIEW_B = {
  schemaVersion: 2 as const,
  presence: {
    clientInstanceId: 'client-b',
    site: 'workstation',
    scope: 'publishing',
    thread: 'thread:t-b',
    focus: 'idea:b',
  },
};

describe('projectChatTurns(D78 决定 5 时点读)', () => {
  it('按 principal×sessionId×turnId 精确 join:各回合取各自的 user 观察', () => {
    const events = [
      userMessage({ seq: 1, turnId: 'turn-a', clientView: VIEW_A }),
      finalTurn({ seq: 2, turnId: 'turn-a' }),
      userMessage({ seq: 3, turnId: 'turn-b', clientView: VIEW_B }),
      finalTurn({ seq: 4, turnId: 'turn-b' }),
    ];
    const turns = projectChatTurns(events, { sessionId: SESSION });
    expect(turns.map((turn) => turn.turnId)).toEqual(['turn-a', 'turn-b']);
    expect(turns[0]!.clientView).toEqual(VIEW_A);
    expect(turns[0]!.userContextKnown).toBe(true);
    expect(turns[1]!.clientView).toEqual(VIEW_B);
    expect(turns[1]!.userContextKnown).toBe(true);
  });

  it('principal 提供时按事件 principal 列再校验(异 principal 事件不参与 join/投影)', () => {
    const events = [
      userMessage({ seq: 1, turnId: 'turn-p1', principal: 'user:p1', clientView: VIEW_A }),
      finalTurn({ seq: 2, turnId: 'turn-p1', principal: 'user:p1' }),
      userMessage({ seq: 3, turnId: 'turn-p2', principal: 'user:p2', clientView: VIEW_B }),
      finalTurn({ seq: 4, turnId: 'turn-p2', principal: 'user:p2' }),
    ];
    const turns = projectChatTurns(events, { sessionId: SESSION, principal: 'user:p1' });
    expect(turns.map((turn) => turn.turnId)).toEqual(['turn-p1']);
    expect(turns[0]!.clientView).toEqual(VIEW_A);
    // 开放视图(无 principal)保持 dev 开放口径:两侧回合都可见。
    const open = projectChatTurns(events, { sessionId: SESSION });
    expect(open).toHaveLength(2);
  });

  it('会话归属按 rel×detail.sessionId 双键:异 rel 或异 sessionId 的事件不参与', () => {
    const events = [
      // 同 turnId、异 rel:不得跨会话误 join。
      baseEvent({
        seq: 1,
        rel: 'chat:other-sess',
        kind: 'chat-message-appended',
        detail: {
          sessionId: 'other-sess',
          turnId: 'turn-a',
          messageId: 'turn-a',
          role: 'user',
          content: '别的会话原话',
          provenance: { kind: 'user-input' },
          clientView: VIEW_B,
        },
      }),
      // 同 rel 但 detail.sessionId 漂移:同样不参与。
      userMessage({ seq: 2, turnId: 'turn-a', sessionId: 'drifted' }),
      finalTurn({ seq: 3, turnId: 'turn-a' }),
    ];
    const turns = projectChatTurns(events, { sessionId: SESSION });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.userContextKnown).toBe(false);
    expect('clientView' in turns[0]!).toBe(false);
  });

  it('缺失上下文两态可分:事件在场但无观察 known=true,事件缺失 known=false', () => {
    const events = [
      userMessage({ seq: 1, turnId: 'turn-noobsv' }),
      finalTurn({ seq: 2, turnId: 'turn-noobsv' }),
      finalTurn({ seq: 3, turnId: 'turn-orphan' }),
    ];
    const turns = projectChatTurns(events, { sessionId: SESSION });
    const noObsv = turns.find((turn) => turn.turnId === 'turn-noobsv')!;
    const orphan = turns.find((turn) => turn.turnId === 'turn-orphan')!;
    expect(noObsv.userContextKnown).toBe(true);
    expect('clientView' in noObsv).toBe(false);
    expect(orphan.userContextKnown).toBe(false);
    expect('clientView' in orphan).toBe(false);
  });

  it('损坏的 clientView 按缺失处理:事件存在(known=true)但不携带观察', () => {
    const events = [
      userMessage({ seq: 1, turnId: 'turn-corrupt', clientView: { presence: 'not-a-report' } }),
      finalTurn({ seq: 2, turnId: 'turn-corrupt' }),
    ];
    const turns = projectChatTurns(events, { sessionId: SESSION });
    expect(turns[0]!.userContextKnown).toBe(true);
    expect('clientView' in turns[0]!).toBe(false);
  });

  it('running 回合同样参与 join(started+progress+user 原话)', () => {
    const events = [
      userMessage({ seq: 1, turnId: 'turn-run', clientView: VIEW_A }),
      baseEvent({
        seq: 2,
        kind: 'chat-turn-started',
        detail: {
          sessionId: SESSION,
          turnId: 'turn-run',
          goal: { verb: '目标' },
          driver: 'llm',
          mode: 'inline',
        },
      }),
      baseEvent({
        seq: 3,
        kind: 'chat-turn-progress',
        detail: {
          sessionId: SESSION,
          turnId: 'turn-run',
          message: { role: 'assistant', text: '进行中' },
        },
      }),
    ];
    const turns = projectChatTurns(events, { sessionId: SESSION });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.status).toBe('running');
    expect(turns[0]!.messages.map((message) => message.text)).toEqual(['进行中']);
    expect(turns[0]!.userContextKnown).toBe(true);
    expect(turns[0]!.clientView).toEqual(VIEW_A);
  });

  it('citations join 保持既有口径:assistant 原话引用挂到精确 turnId 的 final 回合', () => {
    const events = [
      userMessage({ seq: 1, turnId: 'turn-a', clientView: VIEW_A }),
      finalTurn({ seq: 2, turnId: 'turn-a' }),
      assistantCitation({ seq: 3, turnId: 'turn-a', rel: 'idea:cited' }),
    ];
    const turns = projectChatTurns(events, { sessionId: SESSION });
    expect(turns[0]!.citations).toEqual([{ rel: 'idea:cited', pointer: '/properties/status' }]);
  });

  it('空切片 → 空回合序列', () => {
    expect(projectChatTurns([], { sessionId: SESSION })).toEqual([]);
  });
});
