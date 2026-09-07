import { describe, expect, it } from 'vitest';

import type { LogEvent } from '@ui4a/engine';

import { executionAuditContext } from './audit-context';

function executed(seq: number, principal: string, rel: string): LogEvent {
  return {
    seq,
    kind: 'action-executed',
    rel,
    action: 'archive',
    actor: 'agent',
    principal,
    channel: 'chat',
    detail: {
      execution: {
        declaration: { passed: true },
        guards: [],
        schema: { passed: true },
        confirmation: { required: false, status: 'not-required' },
      },
    },
  };
}

describe('bounded execution audit context', () => {
  it('filters by the session authorization before applying the execution limit', () => {
    const message = (seq: number, sessionId: string, principal = 'p1'): LogEvent => ({
      seq,
      kind: 'chat-message-appended',
      principal,
      rel: `chat:${sessionId}`,
      detail: { sessionId, role: 'user', messageId: `m${seq}`, content: '归档' },
    });
    const action = (seq: number, source: string, principal = 'p1'): LogEvent => ({
      ...executed(seq, principal, `post:${seq}`),
      detail: {
        execution: {
          declaration: { passed: true },
          guards: [],
          schema: { passed: true },
          confirmation: { required: false, status: 'not-required' },
          authorization: { sourceMessageId: source, quote: '归档' },
        },
      },
    });
    const events = [
      message(1, 's1'),
      action(2, 'm1'),
      message(3, 's2'),
      action(4, 'm3'),
      message(5, 's1', 'other'),
      action(6, 'm5', 'other'),
    ];
    expect(executionAuditContext(events, 'p1', 1, 's1')).toMatchObject([
      { rel: 'post:2', authorization: { status: 'verified' } },
    ]);
    expect(executionAuditContext(events, 'p1', 8, 'new-session')).toEqual([]);
  });

  it('只披露当前 principal 的最近执行，且保留缺授权错误供 Assistant 如实说明', () => {
    const context = executionAuditContext(
      [
        executed(1, 'user:other', 'post:secret'),
        executed(2, 'user:s1', 'post:first'),
        executed(3, 'user:s1', 'post:second'),
      ],
      'user:s1',
      1,
    );

    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({
      rel: 'post:second',
      integrity: 'authorization-error',
      authorization: null,
    });
    expect(JSON.stringify(context)).not.toContain('post:secret');
  });
});
