import { describe, expect, it } from 'vitest';

import { seedGuardRegistry, type EngineSnapshot, type ThreadStatus } from '@ui4a/shared';

import { project } from '../contract/siren';
import {
  THREAD_ATTACH_ACTION,
  THREAD_CREATE_ACTION,
  THREAD_DETACH_ACTION,
  threadActionsForStatus,
} from './work-thread';
import { executeThreadCommand } from './work-thread-command';

const deps = { flows: {}, guards: seedGuardRegistry };

function snapshot(status: ThreadStatus = 'open'): EngineSnapshot {
  return {
    instances: {
      'post:known': {
        rel: 'post:known',
        flow: 'post-status',
        node: 'published',
        fields: { title: { value: 'Do not copy me', origin: 'default' } },
      },
      'post:not-a-member': {
        rel: 'post:not-a-member',
        flow: 'post-status',
        node: 'offline',
        fields: {},
      },
    },
    collections: { articles: ['post:known', 'post:not-a-member'] },
    confirmations: {
      'confirmation:approve-1': {
        id: 'approve-1',
        targetRel: 'post:known',
        targetAction: 'archive',
        proposedBy: { actor: 'agent', principal: 'user:mike' },
        status: 'pending',
      },
    },
    delegations: {
      'delegation:publish': {
        id: 'publish',
        goal: { verb: 'publish' },
        driverKind: 'llm',
        startRel: 'articles',
        principal: 'user:mike',
        status: 'running',
        steps: 1,
        successes: 0,
      },
    },
    threads: {
      'release-1': {
        id: 'release-1',
        owner: 'user:mike',
        goal: { text: 'Ship safely', source: 'message:goal-1' },
        status,
        references: {
          context: ['articles'],
          active: ['post:known', 'delegation:publish', 'agent-run:missing'],
          approval: ['confirmation:approve-1', 'draft:missing'],
          event: ['event:40', 'event:42'],
        },
        recentEventSeqs: [40, 42],
      },
    },
  };
}

describe('Work Thread Siren projection', () => {
  it('projects threads as an open collection with create action and navigable items', () => {
    const entity = project(snapshot(), 'threads', deps);

    expect(entity).toMatchObject({
      class: ['collection', 'threads'],
      properties: {
        rel: 'threads',
        title: '我的工作线',
        count: 1,
        presentation: {
          fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
        },
      },
    });
    expect(entity?.actions.map((action) => action.name)).toEqual(['create']);
    expect(entity?.actions[0]?.fields).toMatchObject({
      type: 'object',
      required: ['id', 'goal', 'goalSource'],
      additionalProperties: false,
    });
    expect(entity?.['guard-results']).toEqual([{ action: 'create', blocked: false, guards: [] }]);
    expect(entity?.entities).toHaveLength(1);
    expect(entity?.entities?.[0]).toMatchObject({
      rel: ['item'],
      href: '/api/entity?rel=thread:release-1',
      class: ['work-thread', 'open'],
      properties: {
        rel: 'thread:release-1',
        identity: 'Ship safely',
      },
    });
  });

  it('projects only explicit membership, status pointers, dangling refs, and no messages', () => {
    const entity = project(snapshot(), 'thread:release-1', deps);

    expect(entity).toMatchObject({
      class: ['work-thread', 'open'],
      properties: {
        id: 'release-1',
        owner: 'user:mike',
        goal: { text: 'Ship safely', source: 'message:goal-1' },
        status: 'open',
        context: ['articles'],
        active: [
          { rel: 'post:known', status: 'published', dangling: false },
          { rel: 'delegation:publish', status: 'running', dangling: false },
          { rel: 'agent-run:missing', dangling: true },
        ],
        approval: [
          { rel: 'confirmation:approve-1', status: 'pending', dangling: false },
          { rel: 'draft:missing', dangling: true },
        ],
        'recent-events': [40, 42],
      },
    });
    expect(entity?.properties).not.toHaveProperty('messages');
    expect(JSON.stringify(entity?.properties)).not.toContain('Do not copy me');
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=thread:release-1' },
      { rel: ['context'], href: '/api/entity?rel=articles' },
      { rel: ['active'], href: '/api/entity?rel=post:known' },
      { rel: ['active'], href: '/api/entity?rel=delegation:publish' },
      { rel: ['active', 'dangling'], href: '/api/entity?rel=agent-run:missing' },
      { rel: ['approval'], href: '/api/entity?rel=confirmation:approve-1' },
      { rel: ['approval', 'dangling'], href: '/api/entity?rel=draft:missing' },
      { rel: ['event'], href: '/api/events?afterSeq=39' },
      { rel: ['event'], href: '/api/events?afterSeq=41' },
    ]);
    expect(JSON.stringify(entity)).not.toContain('post:not-a-member');
  });

  it('links event:1 to the baseHref-aware audit feed from afterSeq=0', () => {
    const withFirstEvent = snapshot();
    withFirstEvent.threads!['release-1']!.references.event = ['event:1'];
    withFirstEvent.threads!['release-1']!.recentEventSeqs = [1];

    const entity = project(withFirstEvent, 'thread:release-1', {
      ...deps,
      baseHref: 'https://ui4a.example',
    });
    expect(entity?.links).toContainEqual({
      rel: ['event'],
      href: 'https://ui4a.example/api/events?afterSeq=0',
    });
  });

  it.each([
    ['open', ['attach', 'detach', 'pause', 'complete', 'archive']],
    ['paused', ['attach', 'detach', 'resume', 'complete', 'archive']],
    ['completed', ['attach', 'detach', 'resume', 'archive']],
    ['archived', []],
  ] as const)(
    'projects the legal %s action subset with unblocked guard results',
    (status, names) => {
      const entity = project(snapshot(status), 'thread:release-1', deps);
      expect(entity?.actions.map((action) => action.name)).toEqual(names);
      expect(entity?.['guard-results']).toEqual(
        names.map((action) => ({ action, blocked: false, guards: [] })),
      );
    },
  );

  it('declares strict, non-collecting create/attach/detach action inputs for Phase D reuse', () => {
    expect(THREAD_CREATE_ACTION['collect-node-fields']).toBe(false);
    expect(THREAD_CREATE_ACTION.fields?.map((field) => field.name)).toEqual([
      'id',
      'goal',
      'goalSource',
    ]);
    for (const action of [THREAD_ATTACH_ACTION, THREAD_DETACH_ACTION]) {
      expect(action['collect-node-fields']).toBe(false);
      expect(action.fields).toEqual([
        expect.objectContaining({
          name: 'category',
          type: 'select',
          required: true,
          options: ['context', 'active', 'approval', 'event'],
        }),
        expect.objectContaining({ name: 'rel', required: true }),
      ]);
    }
    expect(threadActionsForStatus('archived')).toEqual([]);
  });

  it('returns undefined for an unknown exact thread without inferring membership', () => {
    expect(project(snapshot(), 'thread:not-created', deps)).toBeUndefined();
  });

  it('executes create and attach as one thread event with a bounded mechanical receipt', () => {
    const empty: EngineSnapshot = { instances: {}, collections: {}, threads: {} };
    const created = executeThreadCommand(
      {
        rel: 'threads',
        action: 'create',
        actor: 'agent',
        principal: 'user:mike',
        authorization: { sourceMessageId: 'message:goal-1', quote: 'Ship safely' },
        params: { id: 'release-1', goal: 'Ship safely', goalSource: 'message:goal-1' },
      },
      empty,
    );
    expect(created).toMatchObject({
      kind: 'accepted',
      entityRel: 'thread:release-1',
      event: {
        kind: 'thread-created',
        rel: 'thread:release-1',
        action: 'create',
        detail: {
          threadId: 'release-1',
          owner: 'user:mike',
          receipt: {
            declaration: { passed: true },
            guards: [{ name: 'thread-owner', pass: true }],
            schema: { passed: true },
            confirmation: { required: false, status: 'not-required' },
            authorization: { sourceMessageId: 'message:goal-1', quote: 'Ship safely' },
          },
        },
      },
    });
    if (created.kind !== 'accepted') return;
    expect(created.snapshot.threads?.['release-1']?.owner).toBe('user:mike');

    const attached = executeThreadCommand(
      {
        rel: 'thread:release-1',
        action: 'attach',
        actor: 'human',
        principal: 'user:mike',
        channel: 'chat-presence',
        params: { category: 'context', rel: 'articles' },
      },
      created.snapshot,
    );
    expect(attached).toMatchObject({
      kind: 'accepted',
      entityRel: 'thread:release-1',
      event: {
        kind: 'thread-reference-attached',
        detail: { source: 'presence' },
      },
    });
    if (attached.kind !== 'accepted') return;
    expect(attached.snapshot.threads?.['release-1']?.references.context).toEqual(['articles']);
  });

  it('rejects in declaration, owner guard, then strict schema order', () => {
    expect(
      executeThreadCommand(
        { rel: 'threads', action: 'archive', principal: 'user:mike', params: {} },
        snapshot(),
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    expect(
      executeThreadCommand(
        {
          rel: 'thread:release-1',
          action: 'attach',
          principal: 'user:other',
          params: { category: 'invalid', rel: 'not a rel', extra: true },
        },
        snapshot(),
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    expect(
      executeThreadCommand(
        {
          rel: 'thread:release-1',
          action: 'attach',
          principal: 'user:mike',
          params: { category: 'context', rel: 'articles', extra: true },
        },
        snapshot(),
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    expect(
      executeThreadCommand(
        {
          rel: 'threads',
          action: 'create',
          principal: 'user:mike',
          params: { id: 'release-2', goal: 'x'.repeat(2_049), goalSource: 'message:goal-2' },
        },
        snapshot(),
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
  });

  it.each([
    ['pause', 'thread-status-changed'],
    ['attach', 'thread-reference-attached'],
    ['detach', 'thread-reference-detached'],
  ] as const)('emits only the dedicated core event for %s', (action, eventKind) => {
    const params =
      action === 'pause'
        ? {}
        : { category: 'context', rel: action === 'attach' ? 'articles' : 'none' };
    const outcome = executeThreadCommand(
      { rel: 'thread:release-1', action, principal: 'user:mike', params },
      snapshot(),
    );
    expect(outcome).toMatchObject({ kind: 'accepted', event: { kind: eventKind } });
    if (outcome.kind === 'accepted') {
      expect(outcome.event.kind).not.toBe('action-executed');
      if (action === 'attach' || action === 'detach') {
        expect(outcome.event.detail).toMatchObject({ source: 'action' });
      }
    }
  });
});
