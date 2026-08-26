import { describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '@ui4a/shared';

import { fold } from './index';
import type { LogEvent } from './log-event';

const deps = { flows: {} };
const owner = 'user:mike';
const validReceipt = {
  declaration: { passed: true as const },
  guards: [{ name: 'thread-owner', pass: true as const }],
  schema: { passed: true as const },
  confirmation: { required: false as const, status: 'not-required' as const },
};

function created(seq = 1, threadId = 'release-1', principal = owner): LogEvent {
  return {
    seq,
    kind: 'thread-created',
    principal,
    detail: {
      threadId,
      owner,
      goal: { text: 'Ship safely', source: 'message:goal-1' },
      receipt: validReceipt,
    },
  };
}

function attached(
  seq: number,
  category: 'context' | 'active' | 'approval' | 'event',
  rel: string,
  principal = owner,
): LogEvent {
  return {
    seq,
    kind: 'thread-reference-attached',
    principal,
    detail: { threadId: 'release-1', category, rel, receipt: validReceipt },
  };
}

function detached(
  seq: number,
  category: 'context' | 'active' | 'approval' | 'event',
  rel: string,
): LogEvent {
  return {
    seq,
    kind: 'thread-reference-detached',
    principal: owner,
    detail: { threadId: 'release-1', category, rel, receipt: validReceipt },
  };
}

function status(seq: number, next: 'open' | 'paused' | 'completed' | 'archived'): LogEvent {
  return {
    seq,
    kind: 'thread-status-changed',
    principal: owner,
    detail: { threadId: 'release-1', status: next, receipt: validReceipt },
  };
}

describe('Work Thread fold', () => {
  it('always carries the threads table for empty and incremental snapshots', () => {
    expect(fold([], deps).threads).toEqual({});
    const initial: EngineSnapshot = { instances: {}, collections: {} };
    expect(fold([], deps, initial).threads).toEqual({});
  });

  it('creates a reference-only snapshot and attaches all four closed categories', () => {
    const snapshot = fold(
      [
        created(),
        attached(2, 'context', 'articles'),
        attached(3, 'active', 'delegation:publish'),
        attached(4, 'approval', 'confirmation:42'),
        attached(5, 'event', 'event:42'),
      ],
      deps,
    ).threads?.['release-1'];

    expect(snapshot).toEqual({
      id: 'release-1',
      owner,
      goal: { text: 'Ship safely', source: 'message:goal-1' },
      status: 'open',
      references: {
        context: ['articles'],
        active: ['delegation:publish'],
        approval: ['confirmation:42'],
        event: ['event:42'],
      },
      recentEventSeqs: [42],
    });
    expect(snapshot).not.toHaveProperty('messages');
  });

  it('ignores trusted identity audit metadata stored beside the strict business detail', () => {
    const createdWithIdentity = created();
    createdWithIdentity.detail = {
      ...(createdWithIdentity.detail as Record<string, unknown>),
      identity: {
        authorizationMode: 'credential',
        scopes: ['ui4a:write', 'publishing'],
        policyScope: 'publishing',
        humanApprovalEligible: false,
      },
    };
    const attachedWithIdentity = attached(2, 'context', 'articles');
    attachedWithIdentity.detail = {
      ...(attachedWithIdentity.detail as Record<string, unknown>),
      identity: {
        authorizationMode: 'credential',
        scopes: ['ui4a:write', 'publishing'],
        policyScope: 'publishing',
        humanApprovalEligible: false,
      },
    };

    expect(
      fold([createdWithIdentity, attachedWithIdentity], deps).threads?.['release-1'],
    ).toMatchObject({
      owner,
      references: { context: ['articles'] },
    });
  });

  it('deduplicates attachments, makes absent detach idempotent, and removes matching refs', () => {
    const once = fold([created(), attached(2, 'context', 'articles')], deps);
    const events = [
      created(),
      attached(2, 'context', 'articles'),
      attached(3, 'context', 'articles'),
      detached(4, 'context', 'inbox'),
      detached(5, 'context', 'articles'),
    ];
    expect(fold(events.slice(0, 3), deps).threads).toEqual(once.threads);
    expect(fold(events, deps).threads?.['release-1']?.references.context).toEqual([]);
  });

  it('retains only the most recent 50 event references and rejects overflow elsewhere', () => {
    const events = Array.from({ length: 55 }, (_, index) =>
      attached(index + 2, 'event', `event:${index + 1}`),
    );
    const snapshot = fold([created(), ...events], deps).threads?.['release-1'];
    expect(snapshot?.references.event).toEqual(
      Array.from({ length: 50 }, (_, index) => `event:${index + 6}`),
    );
    expect(snapshot?.recentEventSeqs).toEqual(Array.from({ length: 50 }, (_, index) => index + 6));

    const contextEvents = Array.from({ length: 257 }, (_, index) =>
      attached(index + 2, 'context', `post:${index}`),
    );
    expect(() => fold([created(), ...contextEvents], deps)).toThrow(/256|bounded|上限/u);
  });

  it('accepts the complete legal lifecycle graph ending in terminal archived', () => {
    const events = [
      created(),
      status(2, 'paused'),
      status(3, 'open'),
      status(4, 'completed'),
      status(5, 'open'),
      status(6, 'paused'),
      status(7, 'completed'),
      status(8, 'archived'),
    ];
    expect(fold(events, deps).threads?.['release-1']?.status).toBe('archived');
    expect(fold([created(), status(2, 'archived')], deps).threads?.['release-1']?.status).toBe(
      'archived',
    );
    expect(
      fold([created(), status(2, 'paused'), status(3, 'archived')], deps).threads?.['release-1']
        ?.status,
    ).toBe('archived');
  });

  it.each([
    ['missing thread', [attached(1, 'context', 'articles')]],
    ['duplicate create', [created(), created(2)]],
    ['empty principal', [created(1, 'release-1', '')]],
    ['create owner mismatch', [created(1, 'release-1', 'user:other')]],
    ['existing owner mismatch', [created(), attached(2, 'context', 'articles', 'user:other')]],
    ['invalid transition', [created(), status(2, 'open')]],
    ['write after archive', [created(), status(2, 'archived'), attached(3, 'context', 'articles')]],
    ['transition after archive', [created(), status(2, 'archived'), status(3, 'open')]],
    [
      'invalid detail',
      [
        created(),
        {
          seq: 2,
          kind: 'thread-reference-attached',
          principal: owner,
          detail: {
            threadId: 'release-1',
            category: 'message',
            rel: 'message:1',
            receipt: validReceipt,
          },
        } as LogEvent,
      ],
    ],
  ])('fails closed for %s', (_label, events) => {
    expect(() => fold(events, deps)).toThrow();
  });

  it('fails closed when any second-writer thread event omits its judgment receipt', () => {
    const withoutReceipt = created();
    withoutReceipt.detail = {
      threadId: 'release-1',
      owner,
      goal: { text: 'Ship safely', source: 'message:goal-1' },
    };
    expect(() => fold([withoutReceipt], deps)).toThrow(/receipt|object/u);
  });

  it('matches incremental fold with full replay and rebuilds deterministically after late seq', () => {
    const ordered = [
      created(),
      attached(2, 'context', 'articles'),
      status(3, 'paused'),
      attached(4, 'active', 'delegation:publish'),
    ];
    const first = fold(ordered.slice(0, 2), deps);
    expect(fold(ordered.slice(2), deps, first)).toEqual(fold(ordered, deps));

    const arrivedBeforeLate = [ordered[0]!, ordered[2]!, ordered[3]!];
    const rebuilt = fold(
      [...arrivedBeforeLate, ordered[1]!].sort((left, right) => left.seq - right.seq),
      deps,
    );
    expect(rebuilt).toEqual(fold(ordered, deps));
  });

  it('continues to reject an unknown event kind', () => {
    expect(() => fold([{ seq: 1, kind: 'thread-renamed' } as unknown as LogEvent], deps)).toThrow(
      /未知事件 kind/u,
    );
  });
});
