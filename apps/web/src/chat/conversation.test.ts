import { describe, expect, it } from 'vitest';

import type { StoredEvent } from '../db/events';
import { conversationView, foldConversation } from './conversation';
import type {
  ChatContextUpdatedDetail,
  ChatMessageAppendedDetail,
  ChatTurnDetail,
} from './history';

function event(
  seq: number,
  kind: StoredEvent['kind'],
  detail: unknown,
  rel = 'chat:sess-main',
): StoredEvent {
  return {
    seq,
    ts: `2026-08-22T00:00:${String(seq).padStart(2, '0')}.000Z`,
    actor: null,
    principal: null,
    channel: null,
    kind,
    rel,
    action: null,
    params: {},
    reason: null,
    detail,
  };
}

function message(
  seq: number,
  detail: Omit<ChatMessageAppendedDetail, 'sessionId'>,
  sessionId = 'sess-main',
): StoredEvent {
  return event(seq, 'chat-message-appended', { sessionId, ...detail }, `chat:${sessionId}`);
}

function context(
  seq: number,
  detail: Omit<ChatContextUpdatedDetail, 'sessionId'>,
  sessionId = 'sess-main',
): StoredEvent {
  return event(seq, 'chat-context-updated', { sessionId, ...detail }, `chat:${sessionId}`);
}

describe('event-sourced conversation context', () => {
  it('按 seq 重建 user/assistant 原话，并隔离其他 session', () => {
    const events = [
      message(3, {
        turnId: 'turn-2',
        messageId: 'm3',
        role: 'user',
        content: '  不用保存。\n',
        provenance: { kind: 'user-input' },
      }),
      message(1, {
        turnId: 'turn-1',
        messageId: 'm1',
        role: 'user',
        content: '总结第一篇文章',
        provenance: { kind: 'user-input' },
      }),
      message(
        2,
        {
          turnId: 'other-turn',
          messageId: 'other-m1',
          role: 'user',
          content: '不属于这个会话',
          provenance: { kind: 'user-input' },
        },
        'sess-other',
      ),
      message(4, {
        turnId: 'turn-2',
        messageId: 'm4',
        role: 'assistant',
        content: '我会只在对话中总结。',
        provenance: { kind: 'assistant-output', model: 'deepseek-v4-flash' },
      }),
    ];

    const folded = foldConversation(events, 'sess-main');

    expect(
      folded.messages.map(({ messageId, role, content }) => ({ messageId, role, content })),
    ).toEqual([
      { messageId: 'm1', role: 'user', content: '总结第一篇文章' },
      { messageId: 'm3', role: 'user', content: '  不用保存。\n' },
      { messageId: 'm4', role: 'assistant', content: '我会只在对话中总结。' },
    ]);
    expect(events[0]?.detail).toMatchObject({ content: '  不用保存。\n' });
  });

  it('从 derived update 重建目标、focus、指代、约束、澄清与授权骨架', () => {
    const events = [
      message(1, {
        turnId: 'turn-1',
        messageId: 'm1',
        role: 'user',
        content: '总结第一篇文章',
        provenance: { kind: 'user-input' },
      }),
      context(2, {
        basedOnSeq: 1,
        provenance: {
          kind: 'llm-interpretation',
          model: 'deepseek-v4-flash',
          sourceMessageIds: ['m1'],
        },
        patch: {
          activeGoal: { verb: '总结', targetRel: 'post:first-post' },
          focus: {
            currentRel: 'post:first-post',
            history: [{ rel: 'articles' }, { rel: 'post:first-post', sourceMessageId: 'm1' }],
          },
          referents: [{ text: '第一篇文章', rel: 'post:first-post', sourceMessageId: 'm1' }],
          constraints: [],
          pendingClarification: {
            question: '摘要只在对话中显示，还是保存？',
            continuation: { verb: '总结', targetRel: 'post:first-post' },
            sourceMessageIds: ['m1'],
          },
          authorizedEffects: [],
        },
      }),
      message(3, {
        turnId: 'turn-2',
        messageId: 'm3',
        role: 'user',
        content: '你自己总结就行，不用保存',
        provenance: { kind: 'user-input' },
      }),
      context(4, {
        basedOnSeq: 3,
        provenance: {
          kind: 'llm-interpretation',
          model: 'deepseek-v4-flash',
          sourceMessageIds: ['m1', 'm3'],
        },
        patch: {
          constraints: [{ text: '仅临时回答，不持久化', sourceMessageId: 'm3' }],
          pendingClarification: null,
        },
      }),
    ];

    const folded = foldConversation(events, 'sess-main');

    expect(folded.context).toMatchObject({
      activeGoal: { verb: '总结', targetRel: 'post:first-post' },
      focus: {
        currentRel: 'post:first-post',
        history: [{ rel: 'articles' }, { rel: 'post:first-post', sourceMessageId: 'm1' }],
      },
      referents: [{ text: '第一篇文章', rel: 'post:first-post', sourceMessageId: 'm1' }],
      constraints: [{ text: '仅临时回答，不持久化', sourceMessageId: 'm3' }],
      pendingClarification: null,
      authorizedEffects: [],
      basedOnSeq: 3,
      updatedAtSeq: 4,
      provenance: {
        kind: 'llm-interpretation',
        model: 'deepseek-v4-flash',
        sourceMessageIds: ['m1', 'm3'],
      },
    });
  });

  it('basedOnSeq 较旧的晚到 update 不覆盖较新的解释', () => {
    const events = [
      message(1, {
        turnId: 'turn-1',
        messageId: 'm1',
        role: 'user',
        content: '总结欢迎文章',
        provenance: { kind: 'user-input' },
      }),
      context(2, {
        basedOnSeq: 1,
        provenance: {
          kind: 'llm-interpretation',
          model: 'deepseek-v4-flash',
          sourceMessageIds: ['m1'],
        },
        patch: {
          focus: {
            currentRel: 'post:post-welcome',
            history: [{ rel: 'post:post-welcome', sourceMessageId: 'm1' }],
          },
        },
      }),
      message(3, {
        turnId: 'turn-2',
        messageId: 'm3',
        role: 'user',
        content: '不对，我说的是第一篇',
        provenance: { kind: 'user-input' },
      }),
      context(4, {
        basedOnSeq: 3,
        provenance: {
          kind: 'llm-interpretation',
          model: 'deepseek-v4-flash',
          sourceMessageIds: ['m1', 'm3'],
        },
        patch: {
          focus: {
            currentRel: 'post:first-post',
            history: [
              { rel: 'post:post-welcome', sourceMessageId: 'm1' },
              { rel: 'post:first-post', sourceMessageId: 'm3' },
            ],
          },
        },
      }),
      context(5, {
        basedOnSeq: 1,
        provenance: {
          kind: 'llm-interpretation',
          model: 'slow-response',
          sourceMessageIds: ['m1'],
        },
        patch: {
          focus: {
            currentRel: 'post:post-welcome',
            history: [{ rel: 'post:post-welcome', sourceMessageId: 'm1' }],
          },
        },
      }),
    ];

    expect(foldConversation(events, 'sess-main').context).toMatchObject({
      focus: {
        currentRel: 'post:first-post',
        history: [
          { rel: 'post:post-welcome', sourceMessageId: 'm1' },
          { rel: 'post:first-post', sourceMessageId: 'm3' },
        ],
      },
      basedOnSeq: 3,
      updatedAtSeq: 4,
    });
  });

  it('thinking、progress 与 agent-decision 不进入 dialogue', () => {
    const events = [
      message(1, {
        turnId: 'turn-1',
        messageId: 'm1',
        role: 'user',
        content: '总结一下',
        provenance: { kind: 'user-input' },
      }),
      event(2, 'chat-turn-progress', {
        sessionId: 'sess-main',
        turnId: 'turn-1',
        message: { role: 'assistant', text: '导航到 post:first-post' },
      }),
      event(3, 'agent-decision', {
        sessionId: 'sess-main',
        turnId: 'turn-1',
        reasoning: '内部思考不应进入对话',
      }),
      message(4, {
        turnId: 'turn-1',
        messageId: 'm4',
        role: 'assistant',
        content: '这篇文章用于验证正文阅读链路。',
        provenance: { kind: 'assistant-output', model: 'deepseek-v4-flash' },
      }),
    ];

    expect(foldConversation(events, 'sess-main').messages.map((item) => item.content)).toEqual([
      '总结一下',
      '这篇文章用于验证正文阅读链路。',
    ]);
  });

  it('兼容旧 chat-turn：保留目标与最终 assistant 消息，不吸收 progress 事件', () => {
    const legacy: ChatTurnDetail = {
      sessionId: 'sess-main',
      turnId: 'legacy-turn',
      goal: { verb: '总结第一篇文章' },
      outcome: 'answered',
      summary: '完成总结',
      messages: [
        { role: 'assistant', text: '导航到 post:first-post' },
        { role: 'assistant', text: '第一篇文章用于验证正文阅读链路。' },
      ],
      steps: [],
      driver: 'llm',
    };

    const folded = foldConversation(
      [
        event(1, 'chat-turn-progress', {
          sessionId: 'sess-main',
          turnId: 'legacy-turn',
          message: { role: 'assistant', text: '思考中' },
        }),
        event(2, 'chat-turn', legacy),
      ],
      'sess-main',
    );

    expect(folded.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: '总结第一篇文章' },
      { role: 'assistant', content: '第一篇文章用于验证正文阅读链路。' },
    ]);
    expect(folded.messages.every((item) => item.provenance.kind === 'legacy-chat-turn')).toBe(true);
  });

  it('bounded view 只取最后 N 条原文，不截断也不改写内容', () => {
    const events = [
      message(1, {
        turnId: 'turn-1',
        messageId: 'm1',
        role: 'user',
        content: '第一条',
        provenance: { kind: 'user-input' },
      }),
      message(2, {
        turnId: 'turn-1',
        messageId: 'm2',
        role: 'assistant',
        content: '第二条',
        provenance: { kind: 'assistant-output', model: 'deepseek-v4-flash' },
      }),
      message(3, {
        turnId: 'turn-2',
        messageId: 'm3',
        role: 'user',
        content: '  第三条保留空白  ',
        provenance: { kind: 'user-input' },
      }),
    ];

    const view = conversationView(events, 'sess-main', { maxMessages: 2 });

    expect(view.recentMessages.map((item) => item.content)).toEqual([
      '第二条',
      '  第三条保留空白  ',
    ]);
    expect(view.truncatedMessageCount).toBe(1);
  });
});
