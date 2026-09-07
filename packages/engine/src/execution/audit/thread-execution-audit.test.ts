import { describe, expect, it } from 'vitest';
import { executeThreadCommand } from '../../projection/work-thread-command';
import { projectExecutionAudit } from './execution-audit';
import type { LogEvent } from '../../projection/fold/index';
import type { EngineSnapshot } from '@ui4a/shared';

describe('work thread execution audit', () => {
  it('retains each real thread receipt with its actor, authorization and event sequence', () => {
    const principal = 'p1';
    const authorization = { sourceMessageId: 'm1', quote: '创建并整理工作线' };
    const events: LogEvent[] = [
      {
        seq: 1,
        kind: 'chat-message-appended',
        principal,
        rel: 'chat:s1',
        detail: { sessionId: 's1', messageId: 'm1', role: 'user', content: authorization.quote },
      },
    ];
    let snapshot: EngineSnapshot = { instances: {}, collections: {}, threads: {} };
    for (const [action, params] of [
      ['create', { commandId: 't1', goal: '界面优化' }],
      ['attach', { category: 'context', rel: 'articles' }],
      ['detach', { category: 'context', rel: 'articles' }],
      ['pause', {}],
    ] as const) {
      const outcome = executeThreadCommand(
        {
          rel: action === 'create' ? 'threads' : 'thread:t1',
          action,
          params,
          principal,
          actor: 'agent',
          channel: 'chat',
          authorization,
        },
        snapshot,
      );
      expect(outcome.kind).toBe('accepted');
      if (outcome.kind !== 'accepted') throw new Error('fixture command rejected');
      snapshot = outcome.snapshot;
      events.push({ ...outcome.event, seq: events.length + 1 });
    }
    const audit = projectExecutionAudit(events);
    expect(audit.map(({ action }) => action)).toEqual(['create', 'attach', 'detach', 'pause']);
    for (const [index, record] of audit.entries()) {
      expect(record).toMatchObject({
        rel: 'thread:t1',
        actor: 'agent',
        principal,
        eventSeqs: [index + 2],
        authorization: { ...authorization, status: 'verified' },
        integrity: 'complete',
        judgment: { guards: [{ name: 'thread-owner', pass: true }] },
      });
    }
    expect(projectExecutionAudit([...events].reverse())).toEqual(audit);
    expect(projectExecutionAudit(events.slice(1))[0]).toMatchObject({
      integrity: 'authorization-error',
      authorization: { status: 'invalid-reference' },
    });
  });
});
