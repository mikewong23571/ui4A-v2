import { describe, expect, it } from 'vitest';

import { seedGuardRegistry, type EngineSnapshot, type ThreadStatus } from '@ui4a/shared';

import { project } from '../contract/siren';
import {
  THREAD_ARCHIVE_ACTION,
  THREAD_ATTACH_ACTION,
  THREAD_COMPLETE_ACTION,
  THREAD_CREATE_ACTION,
  THREAD_DETACH_ACTION,
  THREAD_PAUSE_ACTION,
  THREAD_RESUME_ACTION,
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
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=threads', title: '我的工作线' },
    ]);
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

  it('marks unresolvable context references as auditable dangling links like every member class', () => {
    const withChatContext = snapshot();
    withChatContext.threads!['release-1']!.references.context = ['articles', 'message:turn-42'];

    const entity = project(withChatContext, 'thread:release-1', deps);

    expect(entity?.links).toContainEqual({ rel: ['context'], href: '/api/entity?rel=articles' });
    expect(entity?.links).toContainEqual({
      rel: ['context', 'dangling'],
      href: '/api/entity?rel=message:turn-42',
    });
  });

  it('context 成员身份解包 FieldValue(identity 优先,title 次之),不回退机器 rel(T35 F-27 回归)', () => {
    const withMembers = snapshot();
    withMembers.instances!['post:dual'] = {
      rel: 'post:dual',
      flow: 'post-status',
      node: 'published',
      fields: {
        identity: { value: '声明的身份', origin: 'intent' },
        title: { value: '标题身份', origin: 'intent' },
      },
    };
    withMembers.threads!['release-1']!.references.context = ['post:known', 'post:dual'];

    const entity = project(withMembers, 'thread:release-1', deps);

    expect(entity?.entities?.map((member) => member.properties.identity)).toEqual([
      'Do not copy me',
      '声明的身份',
    ]);
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

  it('declares task-language titles for every action and field (T33:人话归合同数据)', () => {
    expect(THREAD_CREATE_ACTION.title).toBe('创建工作线');
    expect(THREAD_CREATE_ACTION.fields?.map((field) => field.title)).toEqual([
      '工作线标识',
      '目标',
      '目标来源',
    ]);
    // T35 F-27(用户反馈):机制动词换任务语——"挂载/卸载引用"不可理解。
    expect(THREAD_ATTACH_ACTION.title).toBe('添加涉及对象');
    expect(THREAD_DETACH_ACTION.title).toBe('移出涉及对象');
    expect(
      THREAD_ATTACH_ACTION.fields?.find((field) => field.name === 'rel')?.description,
    ).toContain('合同路径');
    expect(THREAD_PAUSE_ACTION.title).toBe('暂停工作线');
    expect(THREAD_RESUME_ACTION.title).toBe('恢复工作线');
    expect(THREAD_COMPLETE_ACTION.title).toBe('完成工作线');
    expect(THREAD_ARCHIVE_ACTION.title).toBe('归档工作线');
  });

  it('projects a task-language resume line from the first active status pointer (T33)', () => {
    const entity = project(snapshot(), 'thread:release-1', deps);
    // active[0]=post:known(node published)→ 停在「published」;合同数据,零渲染器模板
    expect(entity?.properties).toMatchObject({ resume: '停在「published」' });
  });

  it('falls back to the thread status when no active reference exists (T33)', () => {
    const empty: EngineSnapshot = {
      ...snapshot(),
      threads: {
        'release-1': {
          ...snapshot().threads!['release-1']!,
          references: {
            context: [],
            active: [],
            approval: [],
            event: [],
          },
        },
      },
    };
    const entity = project(empty, 'thread:release-1', deps);
    // 回退线程自身状态时走任务语(F-21:机器名不进界面文案)。
    expect(entity?.properties).toMatchObject({ resume: '停在「进行中」' });
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

  it('judges duplicate creation as thread-id-available guard failure before schema judgment', () => {
    const create = (params: Record<string, unknown>) =>
      executeThreadCommand(
        { rel: 'threads', action: 'create', principal: 'user:mike', params },
        snapshot(),
      );

    // 基础组合:重复 id + 其余参数合法 → guard-failed(thread-id-available=false)。
    expect(create({ id: 'release-1', goal: 'Ship safely', goalSource: 'message:goal-1' })).toEqual(
      expect.objectContaining({
        kind: 'rejected',
        layer: 'guard-failed',
        reason: 'guard 不满足: thread-id-available=false',
        detail: [{ name: 'thread-id-available', pass: false }],
      }),
    );
    // 层序组合(D48 裁决 a):重复 id + 其余参数非法,schema 判定尚未执行,
    // 拒绝归 guard-failed 而非 schema-invalid——机械层序 declaration → guard → schema 成立。
    expect(create({ id: 'release-1' })).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      detail: [{ name: 'thread-id-available', pass: false }],
    });
    // 非字符串 id 安全处理:不做存在性判断,仍由 schema 层拒绝,不误报 guard-failed。
    expect(create({ id: 7 })).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    // 反向钉:id 可用时非法参数照旧 schema-invalid,guard 未吞并 schema 判定。
    expect(create({ id: 'brand-new-1' })).toMatchObject({
      kind: 'rejected',
      layer: 'schema-invalid',
    });
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
