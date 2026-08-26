import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  MAX_THREAD_GOAL_LENGTH,
  MAX_THREAD_ID_LENGTH,
  MAX_THREAD_OWNER_LENGTH,
  MAX_THREAD_RECENT_EVENTS,
  MAX_THREAD_REFERENCES_PER_CATEGORY,
  MAX_THREAD_REL_LENGTH,
  THREAD_EVENT_KINDS,
  parseThreadEventDetail,
  parseThreadSnapshot,
  type ThreadCreatedDetail,
  type ThreadReferenceAttachedDetail,
  type ThreadReferenceDetachedDetail,
  type ThreadSnapshot,
  type ThreadStatusChangedDetail,
} from './work-thread';

describe('work thread event contract', () => {
  const validReceipt = {
    declaration: { passed: true as const },
    guards: [{ name: 'thread-owner', pass: true as const }],
    schema: { passed: true as const },
    confirmation: { required: false as const, status: 'not-required' as const },
  };
  const created = {
    threadId: 'release.2026-08',
    owner: 'user:mike',
    goal: {
      text: 'Ship the release safely',
      source: 'message:goal-1',
    },
    receipt: validReceipt,
  };

  it('parses the four closed event detail shapes', () => {
    expect(THREAD_EVENT_KINDS).toEqual([
      'thread-created',
      'thread-reference-attached',
      'thread-reference-detached',
      'thread-status-changed',
    ]);

    const parsedCreated = parseThreadEventDetail('thread-created', created);
    const parsedAttached = parseThreadEventDetail('thread-reference-attached', {
      threadId: created.threadId,
      category: 'context',
      rel: 'post:welcome',
      receipt: validReceipt,
    });
    const parsedDetached = parseThreadEventDetail('thread-reference-detached', {
      threadId: created.threadId,
      category: 'approval',
      rel: 'confirmation:42',
      receipt: validReceipt,
    });
    const parsedStatus = parseThreadEventDetail('thread-status-changed', {
      threadId: created.threadId,
      status: 'completed',
      receipt: validReceipt,
    });

    expect(parsedCreated).toEqual(created);
    expectTypeOf(parsedCreated).toEqualTypeOf<ThreadCreatedDetail>();
    expectTypeOf(parsedAttached).toEqualTypeOf<ThreadReferenceAttachedDetail>();
    expectTypeOf(parsedDetached).toEqualTypeOf<ThreadReferenceDetachedDetail>();
    expectTypeOf(parsedStatus).toEqualTypeOf<ThreadStatusChangedDetail>();
  });

  it.each(['context', 'active', 'approval'] as const)(
    'accepts a bounded canonical %s reference',
    (category) => {
      expect(
        parseThreadEventDetail('thread-reference-attached', {
          threadId: 'work-1',
          category,
          rel: 'meta/application:publishing',
          receipt: validReceipt,
        }),
      ).toMatchObject({ category });
    },
  );

  it.each(['inbox', 'articles', 'meta/flows'])(
    'preserves the existing canonical collection or surface rel %s',
    (rel) => {
      expect(
        parseThreadEventDetail('thread-reference-attached', {
          threadId: 'work-1',
          category: 'context',
          rel,
          receipt: validReceipt,
        }),
      ).toMatchObject({ rel });
    },
  );

  it('accepts event references only as positive event sequence rels', () => {
    expect(
      parseThreadEventDetail('thread-reference-attached', {
        threadId: 'work-1',
        category: 'event',
        rel: 'event:42',
        receipt: validReceipt,
      }),
    ).toMatchObject({ category: 'event', rel: 'event:42' });

    for (const rel of ['event:0', 'event:-1', 'event:1.5', 'event:not-a-seq', 'post:42']) {
      expect(() =>
        parseThreadEventDetail('thread-reference-attached', {
          threadId: 'work-1',
          category: 'event',
          rel,
          receipt: validReceipt,
        }),
      ).toThrow();
    }
  });

  it.each([
    ['unknown kind', 'thread-renamed', created],
    ['extra field', 'thread-created', { ...created, sessionId: 'session:forbidden' }],
    ['invalid id', 'thread-created', { ...created, threadId: 'Bad id' }],
    ['empty id', 'thread-created', { ...created, threadId: '' }],
    ['long id', 'thread-created', { ...created, threadId: 'a'.repeat(MAX_THREAD_ID_LENGTH + 1) }],
    ['empty owner', 'thread-created', { ...created, owner: '   ' }],
    [
      'long owner',
      'thread-created',
      { ...created, owner: `u${'x'.repeat(MAX_THREAD_OWNER_LENGTH)}` },
    ],
    ['empty goal', 'thread-created', { ...created, goal: { ...created.goal, text: '' } }],
    [
      'long goal',
      'thread-created',
      { ...created, goal: { ...created.goal, text: 'x'.repeat(MAX_THREAD_GOAL_LENGTH + 1) } },
    ],
    [
      'extra goal field',
      'thread-created',
      { ...created, goal: { ...created.goal, inherited: true } },
    ],
    [
      'invalid goal source',
      'thread-created',
      { ...created, goal: { ...created.goal, source: 'message:goal?forged=true' } },
    ],
    [
      'long goal source',
      'thread-created',
      {
        ...created,
        goal: { ...created.goal, source: `message:${'x'.repeat(MAX_THREAD_REL_LENGTH)}` },
      },
    ],
    [
      'invalid category',
      'thread-reference-attached',
      { threadId: 'work-1', category: 'message', rel: 'message:1', receipt: validReceipt },
    ],
    [
      'invalid rel',
      'thread-reference-attached',
      { threadId: 'work-1', category: 'context', rel: 'not a rel', receipt: validReceipt },
    ],
    [
      'query rel',
      'thread-reference-attached',
      {
        threadId: 'work-1',
        category: 'context',
        rel: 'articles?scope=governance',
        receipt: validReceipt,
      },
    ],
    [
      'hash rel',
      'thread-reference-attached',
      {
        threadId: 'work-1',
        category: 'context',
        rel: 'post:welcome#actions',
        receipt: validReceipt,
      },
    ],
    [
      'long rel',
      'thread-reference-detached',
      {
        threadId: 'work-1',
        category: 'context',
        rel: `post:${'x'.repeat(MAX_THREAD_REL_LENGTH)}`,
        receipt: validReceipt,
      },
    ],
    [
      'invalid status',
      'thread-status-changed',
      { threadId: 'work-1', status: 'closed', receipt: validReceipt },
    ],
    [
      'missing receipt',
      'thread-created',
      { threadId: created.threadId, owner: created.owner, goal: created.goal },
    ],
  ])('rejects %s', (_label, kind, detail) => {
    expect(() => parseThreadEventDetail(kind, detail)).toThrow();
  });

  it('defines a bounded, reference-only snapshot without message copies', () => {
    const snapshot = parseThreadSnapshot({
      id: created.threadId,
      owner: created.owner,
      goal: created.goal,
      status: 'open',
      references: {
        context: ['post:welcome'],
        active: ['delegation:publish'],
        approval: ['confirmation:42'],
        event: ['event:42'],
      },
      recentEventSeqs: [42],
    });

    expectTypeOf(snapshot).toEqualTypeOf<ThreadSnapshot>();
    expect(snapshot.recentEventSeqs).toHaveLength(1);
    expect(MAX_THREAD_RECENT_EVENTS).toBe(50);
    expect(snapshot).not.toHaveProperty('messages');
  });

  it.each([
    [
      'too many context references',
      {
        context: Array.from(
          { length: MAX_THREAD_REFERENCES_PER_CATEGORY + 1 },
          (_, index) => `post:${index}`,
        ),
        active: [],
        approval: [],
        event: [],
      },
      [],
    ],
    [
      'too many recent events',
      {
        context: [],
        active: [],
        approval: [],
        event: Array.from(
          { length: MAX_THREAD_RECENT_EVENTS + 1 },
          (_, index) => `event:${index + 1}`,
        ),
      },
      Array.from({ length: MAX_THREAD_RECENT_EVENTS + 1 }, (_, index) => index + 1),
    ],
    [
      'duplicate references',
      { context: ['post:one', 'post:one'], active: [], approval: [], event: [] },
      [],
    ],
    [
      'mismatched event sequence',
      { context: [], active: [], approval: [], event: ['event:42'] },
      [43],
    ],
  ])('rejects a snapshot with %s', (_label, references, recentEventSeqs) => {
    expect(() =>
      parseThreadSnapshot({
        id: created.threadId,
        owner: created.owner,
        goal: created.goal,
        status: 'open',
        references,
        recentEventSeqs,
      }),
    ).toThrow();
  });
});
