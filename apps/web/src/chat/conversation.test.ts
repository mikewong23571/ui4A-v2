import { describe, expect, it } from 'vitest';

import type { StoredEvent } from '@ui4a/db/events';
import { conversationView, foldConversation } from './conversation';
import type { ChatContextUpdatedDetail, ChatMessageAppendedDetail } from './history';

/** D68.3 双键装配的既有会话 fixture 主 principal(本地 demo 口径 user:<sessionId>)。 */
const PRINCIPAL = 'user:sess-main';

function event(
  seq: number,
  kind: StoredEvent['kind'],
  detail: unknown,
  rel = 'chat:sess-main',
  principal: string | null = PRINCIPAL,
): StoredEvent {
  return {
    seq,
    ts: `2026-08-22T00:00:${String(seq).padStart(2, '0')}.000Z`,
    actor: null,
    principal,
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
  principal: string | null = PRINCIPAL,
): StoredEvent {
  return event(
    seq,
    'chat-message-appended',
    { sessionId, ...detail },
    `chat:${sessionId}`,
    principal,
  );
}

function context(
  seq: number,
  detail: Omit<ChatContextUpdatedDetail, 'sessionId'>,
  sessionId = 'sess-main',
  principal: string | null = PRINCIPAL,
): StoredEvent {
  return event(seq, 'chat-context-updated', { sessionId, ...detail }, `chat:${sessionId}`, principal);
}

function clientView(clientInstanceId: string, focus: string) {
  return {
    schemaVersion: 2 as const,
    presence: {
      clientInstanceId,
      site: 'workstation',
      scope: null,
      thread: null,
      focus,
    },
  };
}

function navigation(
  seq: number,
  detail: Record<string, unknown>,
  sessionId = 'sess-main',
  principal: string | null = PRINCIPAL,
): StoredEvent {
  return event(
    seq,
    'chat-navigation-completed' as StoredEvent['kind'],
    { sessionId, ...detail },
    `chat:${sessionId}`,
    principal,
  );
}

describe('event-sourced conversation context', () => {
  it('keeps the current user message client view separate from navigation history', () => {
    const firstView = clientView('client:a', 'post:first-post');
    const folded = foldConversation(
      [
        message(1, {
          turnId: 'turn-1',
          messageId: 'm1',
          role: 'user',
          content: '总共有几篇？',
          provenance: { kind: 'user-input' },
          clientView: firstView,
        }),
        navigation(2, {
          schemaVersion: 1,
          navigationId: 'turn-0:navigate:1',
          source: 'agent-navigate',
          turnId: 'turn-0',
          subject: 'articles',
          route: '/canvas?focus=articles',
          sourceMessageIds: ['m0'],
          step: 1,
        }),
      ],
      'sess-main',
      PRINCIPAL,
    );

    expect(folded.clientView).toEqual({
      ...firstView,
      sourceMessageId: 'm1',
      observedAtSeq: 1,
    });
    expect(folded.lastNavigation).toMatchObject({
      navigationId: 'turn-0:navigate:1',
      subject: 'articles',
      completedAtSeq: 2,
    });
    expect(folded.messages[0]?.clientView).toEqual(firstView);
  });

  it('treats a later user message without client view as unknown instead of carrying forward', () => {
    const folded = foldConversation(
      [
        message(1, {
          turnId: 'turn-1',
          messageId: 'm1',
          role: 'user',
          content: '第一窗口',
          provenance: { kind: 'user-input' },
          clientView: clientView('client:a', 'post:first-post'),
        }),
        message(2, {
          turnId: 'turn-2',
          messageId: 'm2',
          role: 'user',
          content: '没有客户端观察',
          provenance: { kind: 'user-input' },
        }),
      ],
      'sess-main',
      PRINCIPAL,
    );

    expect(folded.clientView).toBeNull();
    expect(folded.messages[0]?.clientView).toMatchObject({
      presence: { clientInstanceId: 'client:a' },
    });
    expect(folded.messages[1]?.clientView).toBeUndefined();
  });

  it('keeps concurrent client observations immutable and selects the current message instance', () => {
    const folded = foldConversation(
      [
        message(2, {
          turnId: 'turn-b',
          messageId: 'm-b',
          role: 'user',
          content: '窗口 B',
          provenance: { kind: 'user-input' },
          clientView: clientView('client:b', 'articles'),
        }),
        message(1, {
          turnId: 'turn-a',
          messageId: 'm-a',
          role: 'user',
          content: '窗口 A',
          provenance: { kind: 'user-input' },
          clientView: clientView('client:a', 'post:first-post'),
        }),
      ],
      'sess-main',
      PRINCIPAL,
    );

    expect(folded.messages.map((item) => item.clientView?.presence.clientInstanceId)).toEqual([
      'client:a',
      'client:b',
    ]);
    expect(folded.clientView?.presence.clientInstanceId).toBe('client:b');
  });

  it('folds successful navigation by seq, ignores duplicate ids and isolates sessions', () => {
    const folded = foldConversation(
      [
        navigation(4, {
          schemaVersion: 1,
          navigationId: 'nav:a',
          source: 'agent-navigate',
          turnId: 'turn-duplicate',
          subject: 'post:should-not-win',
          route: '/canvas?focus=post%3Ashould-not-win',
          sourceMessageIds: ['m-duplicate'],
          step: 1,
        }),
        navigation(2, {
          schemaVersion: 1,
          navigationId: 'nav:a',
          source: 'agent-navigate',
          turnId: 'turn-a',
          subject: 'post:first-post',
          route: '/canvas?focus=post%3Afirst-post',
          sourceMessageIds: ['m-a'],
          step: 1,
        }),
        navigation(3, {
          schemaVersion: 1,
          navigationId: 'nav:b',
          source: 'presentation-receipt',
          turnId: 'turn-b',
          subject: 'articles',
          route: '/canvas?focus=articles',
          sourceMessageIds: ['m-b'],
          presentationRequestId: 'turn-b:presentation:1',
        }),
        navigation(
          5,
          {
            schemaVersion: 1,
            navigationId: 'nav:other',
            source: 'agent-navigate',
            turnId: 'turn-other',
            subject: 'post:other',
            route: '/canvas?focus=post%3Aother',
            sourceMessageIds: ['m-other'],
            step: 1,
          },
          'sess-other',
        ),
      ],
      'sess-main',
      PRINCIPAL,
    );

    expect(folded.lastNavigation).toMatchObject({
      navigationId: 'nav:b',
      source: 'presentation-receipt',
      subject: 'articles',
      completedAtSeq: 3,
    });
  });

  it('does not derive successful navigation from pending, failed or not-found evidence', () => {
    const folded = foldConversation(
      [
        event(1, 'presentation-resolved', {
          sessionId: 'sess-main',
          requestId: 'presentation:pending',
          status: 'pending',
        }),
        event(2, 'presentation-failed', {
          sessionId: 'sess-main',
          requestId: 'presentation:failed',
          status: 'failed',
        }),
        event(3, 'chat-turn-progress', {
          sessionId: 'sess-main',
          step: { op: { kind: 'navigate', rel: 'post:missing' }, outcome: 'not-found' },
        }),
      ],
      'sess-main',
      PRINCIPAL,
    );

    expect(folded.lastNavigation).toBeNull();
    expect(folded.clientView).toBeNull();
  });

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
        provenance: { kind: 'assistant-output', model: 'configured-model' },
      }),
    ];

    const folded = foldConversation(events, 'sess-main', PRINCIPAL);

    expect(
      folded.messages.map(({ messageId, role, content }) => ({ messageId, role, content })),
    ).toEqual([
      { messageId: 'm1', role: 'user', content: '总结第一篇文章' },
      { messageId: 'm3', role: 'user', content: '  不用保存。\n' },
      { messageId: 'm4', role: 'assistant', content: '我会只在对话中总结。' },
    ]);
    expect(events[0]?.detail).toMatchObject({ content: '  不用保存。\n' });
  });

  it('strictly preserves and deduplicates assistant citations without parsing its text', () => {
    const citations = [
      { rel: 'post:first-post', pointer: '/properties/fields/body' },
      { rel: 'post:first-post', pointer: '/properties/fields/body' },
      { rel: 'articles', pointer: '/properties/count' },
    ];
    const valid = message(1, {
      turnId: 'turn-1',
      messageId: 'turn-1:assistant',
      role: 'assistant',
      content: '正文没有任何实体名。',
      provenance: { kind: 'assistant-output' },
      citations,
    });
    const malformed = message(2, {
      turnId: 'turn-2',
      messageId: 'turn-2:assistant',
      role: 'assistant',
      content: 'post:ghost 不应变成引用。',
      provenance: { kind: 'assistant-output' },
      citations: [{ rel: 'post:ghost', pointer: 'properties/body' }],
    });

    expect(foldConversation([valid, malformed], 'sess-main', PRINCIPAL).messages).toMatchObject([
      {
        messageId: 'turn-1:assistant',
        citations: [
          { rel: 'post:first-post', pointer: '/properties/fields/body' },
          { rel: 'articles', pointer: '/properties/count' },
        ],
      },
    ]);
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
          model: 'configured-model',
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
          model: 'configured-model',
          sourceMessageIds: ['m1', 'm3'],
        },
        patch: {
          constraints: [{ text: '仅临时回答，不持久化', sourceMessageId: 'm3' }],
          pendingClarification: null,
        },
      }),
    ];

    const folded = foldConversation(events, 'sess-main', PRINCIPAL);

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
        model: 'configured-model',
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
          model: 'configured-model',
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
          model: 'configured-model',
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

    expect(foldConversation(events, 'sess-main', PRINCIPAL).context).toMatchObject({
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
        provenance: { kind: 'assistant-output', model: 'configured-model' },
      }),
    ];

    expect(
      foldConversation(events, 'sess-main', PRINCIPAL).messages.map((item) => item.content),
    ).toEqual(['总结一下', '这篇文章用于验证正文阅读链路。']);
  });

  it('chat-turn 完成事件不进入 dialogue:原话只来自 chat-message-appended', () => {
    const folded = foldConversation(
      [
        event(1, 'chat-turn-progress', {
          sessionId: 'sess-main',
          turnId: 'old-turn',
          message: { role: 'assistant', text: '思考中' },
        }),
        event(2, 'chat-turn', {
          sessionId: 'sess-main',
          turnId: 'old-turn',
          goal: { verb: '总结第一篇文章' },
          outcome: 'answered',
          summary: '完成总结',
          messages: [
            { role: 'assistant', text: '导航到 post:first-post' },
            { role: 'assistant', text: '第一篇文章用于验证正文阅读链路。' },
          ],
          steps: [],
          driver: 'llm',
        }),
      ],
      'sess-main',
      PRINCIPAL,
    );

    expect(folded.messages).toEqual([]);
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
        provenance: { kind: 'assistant-output', model: 'configured-model' },
      }),
      message(3, {
        turnId: 'turn-2',
        messageId: 'm3',
        role: 'user',
        content: '  第三条保留空白  ',
        provenance: { kind: 'user-input' },
      }),
    ];

    const view = conversationView(events, 'sess-main', PRINCIPAL, { maxMessages: 2 });

    expect(view.recentMessages.map((item) => item.content)).toEqual([
      '第二条',
      '  第三条保留空白  ',
    ]);
    expect(view.truncatedMessageCount).toBe(1);
  });

  it('D68.3 双键:同 sessionId 跨 principal 碰撞,各自视图互不可见', () => {
    const events = [
      message(
        1,
        {
          turnId: 'turn-a1',
          messageId: 'm-a1',
          role: 'user',
          content: 'alice 的目标',
          provenance: { kind: 'user-input' },
        },
        'sess-main',
        'human-alice',
      ),
      context(
        2,
        {
          basedOnSeq: 1,
          provenance: {
            kind: 'llm-interpretation',
            model: 'configured-model',
            sourceMessageIds: ['m-a1'],
          },
          patch: { activeGoal: { verb: '总结', targetRel: 'post:alice' } },
        },
        'sess-main',
        'human-alice',
      ),
      message(
        3,
        {
          turnId: 'turn-b1',
          messageId: 'm-b1',
          role: 'user',
          content: 'bob 的目标',
          provenance: { kind: 'user-input' },
        },
        'sess-main',
        'human-bob',
      ),
      context(
        4,
        {
          basedOnSeq: 3,
          provenance: {
            kind: 'llm-interpretation',
            model: 'configured-model',
            sourceMessageIds: ['m-b1'],
          },
          patch: { activeGoal: { verb: '总结', targetRel: 'post:bob' } },
        },
        'sess-main',
        'human-bob',
      ),
    ];

    const aliceView = conversationView(events, 'sess-main', 'human-alice');
    const bobView = conversationView(events, 'sess-main', 'human-bob');

    expect(aliceView.recentMessages.map((item) => item.messageId)).toEqual(['m-a1']);
    expect(aliceView.context.activeGoal).toMatchObject({ targetRel: 'post:alice' });
    expect(aliceView.recentMessages.some((item) => item.content === 'bob 的目标')).toBe(false);

    expect(bobView.recentMessages.map((item) => item.messageId)).toEqual(['m-b1']);
    expect(bobView.context.activeGoal).toMatchObject({ targetRel: 'post:bob' });
    expect(bobView.recentMessages.some((item) => item.content === 'alice 的目标')).toBe(false);
  });

  it('principal 为 null/undefined 的事件不属于任何 principal 视图', () => {
    const nullPrincipal = message(
      1,
      {
        turnId: 'turn-1',
        messageId: 'm-null',
        role: 'user',
        content: '无主消息',
        provenance: { kind: 'user-input' },
      },
      'sess-main',
      null,
    );
    const undefinedPrincipal = {
      ...message(1, {
        turnId: 'turn-1',
        messageId: 'm-undefined',
        role: 'user',
        content: '缺主消息',
        provenance: { kind: 'user-input' },
      }),
      principal: undefined,
    } as unknown as StoredEvent;

    for (const viewer of [PRINCIPAL, 'human-alice', 'human-bob']) {
      const view = conversationView([nullPrincipal, undefinedPrincipal], 'sess-main', viewer);
      expect(view.recentMessages).toEqual([]);
      expect(view.context).toMatchObject({ activeGoal: null, basedOnSeq: 0, updatedAtSeq: 0 });
      expect(view.clientView).toBeNull();
      expect(view.lastNavigation).toBeNull();
    }
  });

  it('同 principal 新 sessionId:空视图,旧会话回合不得混入(U2)', () => {
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
          model: 'configured-model',
          sourceMessageIds: ['m1'],
        },
        patch: {
          activeGoal: { verb: '总结', targetRel: 'post:first-post' },
          referents: [{ text: '第一篇文章', rel: 'post:first-post', sourceMessageId: 'm1' }],
        },
      }),
      message(3, {
        turnId: 'turn-1',
        messageId: 'm3',
        role: 'assistant',
        content: '这篇文章用于验证正文阅读链路。',
        provenance: { kind: 'assistant-output', model: 'configured-model' },
      }),
    ];

    const view = conversationView(events, 'sess-fresh', PRINCIPAL);

    expect(view.sessionId).toBe('sess-fresh');
    expect(view.recentMessages).toEqual([]);
    expect(view.truncatedMessageCount).toBe(0);
    expect(view.clientView).toBeNull();
    expect(view.lastNavigation).toBeNull();
    expect(view.context).toEqual({
      activeGoal: null,
      focus: null,
      referents: [],
      constraints: [],
      pendingClarification: null,
      authorizedEffects: [],
      basedOnSeq: 0,
      updatedAtSeq: 0,
      provenance: null,
    });
  });
});
