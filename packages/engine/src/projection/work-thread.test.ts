import { describe, expect, it } from 'vitest';

import {
  COGNITIVE_SEMANTICS_EMPTY_MEANINGS,
  COGNITIVE_SEMANTICS_GROUP_ROLES,
  COGNITIVE_SEMANTICS_TRAITS,
  seedGuardRegistry,
  type EngineSnapshot,
  type ThreadStatus,
} from '@ui4a/shared';

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

it('labels a referenced object from its declared content field without type-specific names', () => {
  const state = snapshot();
  state.instances['post:known']!.fields = { summary: { value: '可辨认的材料', origin: 'default' } };
  const entity = project(state, 'thread:release-1', {
    guards: seedGuardRegistry,
    flows: {
      'post-status': {
        name: 'post-status',
        initial: 'published',
        nodes: [{ name: 'published', actions: [] }],
        fields: [{ name: 'summary', type: 'text', presentation: { role: 'primary-content' } }],
      },
    },
  });
  expect(
    entity?.entities?.find((member) => member.properties.rel === 'post:known')?.properties.identity,
  ).toBe('可辨认的材料');
});

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
      { rel: ['current'], href: '/api/entity?rel=threads-current', title: '继续工作' },
      { rel: ['history'], href: '/api/entity?rel=threads-history', title: '已结束的工作' },
    ]);
    expect(entity?.actions.map((action) => action.name)).toEqual(['create']);
    expect(entity?.actions[0]?.fields).toMatchObject({
      type: 'object',
      required: ['commandId', 'goal'],
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

  it('声明 ready-to-start 空态语义,「工作线」空区消费引导而非裸标题(F-04)', () => {
    const empty: EngineSnapshot = { instances: {}, collections: {}, threads: {} };
    const entity = project(empty, 'threads', deps);
    expect(entity?.properties).toMatchObject({
      presentation: { emptyMeaning: 'ready-to-start' },
    });
    expect(entity?.entities).toEqual([]);
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

    // T56 P1.2 联动升级(D78 决定 2):entities 现含全部角色成员卡(context →
    // active → approval,与 properties 引用序同构);F-27 意图保留——context 卡
    // 之外,active 卡同样解包声明字段(identity 优先,title 次之),机器 rel 只作
    // 兜底,不进可读身份。
    expect(entity?.entities?.map((member) => member.properties.identity)).toEqual([
      'Do not copy me',
      '声明的身份',
      'Do not copy me',
      'publish',
      'agent-run:missing',
      'archive · 由 agent 提议',
      'draft:missing',
    ]);
  });

  it('来源可读物优先:可解析的 source 投影任务语,不可解析则干净省略,裸标识只在 raw 层(F-08)', () => {
    // 可解析:source 指向实例 → 显示实例身份;原始 rel 不再进呈现字段。
    const resolvable = snapshot();
    resolvable.threads!['release-1']!.goal.source = 'post:known';
    const entity = project(resolvable, 'thread:release-1', deps);
    expect(entity?.properties).toMatchObject({
      goalSourceText: 'Do not copy me',
      presentation: {
        fields: [
          { path: 'properties.identity', title: '目标', role: 'identity' },
          { path: 'properties.statusText', title: '状态', role: 'status' },
        ],
      },
    });
    expect(JSON.stringify(entity?.properties?.presentation)).not.toContain(
      'properties.goal.source',
    );

    // 不可解析(message:* 等无合同事实的标识):无派生字段、无来源呈现字段,
    // 原始 goal.source 保留在属性层(raw 可达),不泄漏为可见文案。
    const unresolved = project(snapshot(), 'thread:release-1', deps);
    expect(unresolved?.properties).not.toHaveProperty('goalSourceText');
    expect(JSON.stringify(unresolved?.properties?.presentation)).not.toContain('目标来源');
    expect(unresolved?.properties).toMatchObject({ goal: { source: 'message:goal-1' } });
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
    expect(THREAD_CREATE_ACTION.fields?.map((field) => field.name)).toEqual(['commandId', 'goal']);
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
    expect(THREAD_CREATE_ACTION.fields?.map((field) => field.title)).toEqual(['提交标识', '目标']);
    // T35 F-27/T60 UX 评审:机制动词换任务语,实体面上的动作不复述实体名。
    expect(THREAD_ATTACH_ACTION.title).toBe('添加材料');
    expect(THREAD_DETACH_ACTION.title).toBe('移出');
    expect(
      THREAD_ATTACH_ACTION.fields?.find((field) => field.name === 'rel')?.description,
    ).toContain('合同路径');
    expect(THREAD_PAUSE_ACTION.title).toBe('暂停');
    expect(THREAD_RESUME_ACTION.title).toBe('恢复');
    expect(THREAD_COMPLETE_ACTION.title).toBe('完成');
    expect(THREAD_ARCHIVE_ACTION.title).toBe('归档');
  });

  it('projects a task-language resume line from the first active status pointer (T33)', () => {
    const entity = project(snapshot(), 'thread:release-1', deps);
    // active[0]=post:known(node published)→ 停在「published」;合同数据,零渲染器模板
    expect(entity?.properties).toMatchObject({ resume: '停在「published」' });
  });

  it('omits redundant resume when the declared status already describes an empty work line', () => {
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
    expect(entity?.properties).toMatchObject({ status: 'open', statusText: '进行中' });
    expect(entity?.properties).not.toHaveProperty('resume');
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
        params: { commandId: 'release-1', goal: 'Ship safely' },
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
          params: { commandId: 'release-2', goal: 'x'.repeat(2_049) },
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
    expect(create({ commandId: 'release-1', goal: 'Ship safely' })).toEqual(
      expect.objectContaining({
        kind: 'rejected',
        layer: 'guard-failed',
        reason: 'guard 不满足: thread-id-available=false',
        detail: [{ name: 'thread-id-available', pass: false }],
      }),
    );
    // 层序组合(D48 裁决 a):重复 id + 其余参数非法,schema 判定尚未执行,
    // 拒绝归 guard-failed 而非 schema-invalid——机械层序 declaration → guard → schema 成立。
    expect(create({ commandId: 'release-1' })).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      detail: [{ name: 'thread-id-available', pass: false }],
    });
    // 非字符串 id 安全处理:不做存在性判断,仍由 schema 层拒绝,不误报 guard-failed。
    expect(create({ commandId: 7 })).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });
    // 反向钉:id 可用时非法参数照旧 schema-invalid,guard 未吞并 schema 判定。
    expect(create({ commandId: 'brand-new-1' })).toMatchObject({
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

/** 结构化读取 thread-reference 成员卡(运行时对象断言,不引入未来类型)。 */
interface ThreadCardView {
  class: string[];
  properties: Record<string, unknown>;
  actions: Array<{ name: string }>;
  links: Array<{ rel: string[]; href: string }>;
}

function threadCards(entity: unknown): Map<string, ThreadCardView> {
  const cards = ((entity as { entities?: ThreadCardView[] } | undefined)?.entities ??
    []) as ThreadCardView[];
  return new Map(cards.map((card) => [card.properties.rel as string, card]));
}

function cardRels(entity: unknown): string[] {
  return [...threadCards(entity).keys()];
}

// T56 P1.1 Red:D78 决定 2(路线 A)钉死的目标读语义——实现前必须失败(断言失败,
// 而非类型/语法错误);P1.2 落码后转绿。
describe('Work Thread 角色读语义与认知声明(D78 路线 A 目标合同;Red)', () => {
  it('A1 角色成员卡:active/approval 产出与 context 同构的 thread-reference 卡,approval 卡携带被引确认的声明动作(D78 决定 2;US01)', () => {
    const entity = project(snapshot(), 'thread:release-1', deps);
    // 与 properties 引用序同构:context → active → approval 全部落卡(当前仅 context 落卡)。
    expect(cardRels(entity)).toEqual([
      'articles',
      'post:known',
      'delegation:publish',
      'agent-run:missing',
      'confirmation:approve-1',
      'draft:missing',
    ]);
    const cards = threadCards(entity);
    // 与 context 成员卡同构:class thread-reference + properties{rel,identity,status,category}
    //(category 取 THREAD_REFERENCE_CATEGORIES 封闭词表,是 D78 的「角色标注」)。
    expect(cards.get('articles')).toMatchObject({
      class: ['thread-reference'],
      properties: { rel: 'articles', identity: 'articles', category: 'context' },
    });
    expect(cards.get('post:known')).toMatchObject({
      class: ['thread-reference'],
      properties: {
        rel: 'post:known',
        identity: 'Do not copy me',
        status: 'published',
        category: 'active',
      },
      links: [{ rel: ['self'], href: '/api/entity?rel=post:known' }],
    });
    expect(cards.get('delegation:publish')).toMatchObject({
      class: ['thread-reference'],
      properties: {
        rel: 'delegation:publish',
        identity: 'publish',
        status: 'running',
        category: 'active',
      },
    });
    // 责任卡:身份行复用确认投影任务语;携带被引确认实体的声明动作(人机同权,
    // membersDeclareActions 纯结构判定 → generic 规划器自动选 member-card,D50)。
    const pendingCard = cards.get('confirmation:approve-1');
    expect(pendingCard).toMatchObject({
      class: ['thread-reference'],
      properties: {
        rel: 'confirmation:approve-1',
        identity: 'archive · 由 agent 提议',
        status: 'pending',
        category: 'approval',
      },
      links: [{ rel: ['self'], href: '/api/entity?rel=confirmation:approve-1' }],
    });
    const confirmationEntity = project(snapshot(), 'confirmation:approve-1', deps);
    expect(pendingCard?.actions.map((action) => action.name)).toEqual(
      confirmationEntity?.actions.map((action) => action.name),
    );
    expect(pendingCard?.actions.map((action) => action.name)).toEqual(['approve', 'reject']);
    // dangling 责任卡被引实体不存在 → 无动作组可声明。
    expect(cards.get('draft:missing')?.actions).toEqual([]);
  });

  it('A2 空/未知/终局:dangling 卡诚实标注「对象不存在」,合同状态原词携带不翻译(D78 决定 2;US03)', () => {
    const entity = project(snapshot(), 'thread:release-1', deps);
    const cards = threadCards(entity);
    // dangling 卡:class 带 dangling 限定,状态=既有「对象不存在」语义。
    expect(cards.get('agent-run:missing')).toMatchObject({
      class: ['thread-reference', 'dangling'],
      properties: { rel: 'agent-run:missing', status: '对象不存在', category: 'active' },
    });
    expect(cards.get('draft:missing')).toMatchObject({
      class: ['thread-reference', 'dangling'],
      properties: { status: '对象不存在', category: 'approval' },
    });
    // 终局合同状态原词:published 逐字携带,不翻译成任务语/新业务词。
    expect(cards.get('post:known')?.properties.status).toBe('published');
    // 未知状态字符串不推断:实例落在任意节点名,卡片原样携带合同字符串,不做词表外归类。
    const odd = snapshot();
    odd.instances!['post:odd'] = {
      rel: 'post:odd',
      flow: 'post-status',
      node: 'halfway-unknown',
      fields: {},
    };
    odd.threads!['release-1']!.references.active = ['post:odd'];
    const oddEntity = project(odd, 'thread:release-1', deps);
    expect(threadCards(oddEntity).get('post:odd')?.properties.status).toBe('halfway-unknown');
  });

  it('A3 归档仍有责任:archived 线责任卡仍在且可到达;无验收来源不得出现验收通过语义(D78 决定 2;US04)', () => {
    const entity = project(snapshot('archived'), 'thread:release-1', deps);
    // archived 合同动作组为空(既有不变量再验);线状态保持任务语「已归档」。
    expect(entity?.actions).toEqual([]);
    expect(entity?.properties).toMatchObject({ status: 'archived', statusText: '已归档' });
    // 责任成员卡不因归档消失,仍携带完整声明动作组与可达 self 链接。
    const pendingCard = threadCards(entity).get('confirmation:approve-1');
    expect(pendingCard).toMatchObject({
      class: ['thread-reference'],
      properties: { rel: 'confirmation:approve-1', status: 'pending', category: 'approval' },
    });
    expect(pendingCard?.actions.map((action) => action.name)).toEqual(['approve', 'reject']);
    expect(pendingCard?.links.some((link) => link.rel.includes('self'))).toBe(true);
    // 无验收来源:completed/archived 不得出现任何「验收通过/成果 PASS」语义字段。
    expect(Object.keys(entity?.properties ?? {}).join(' ')).not.toMatch(/acceptance|outcome|pass/i);
    expect(JSON.stringify(entity ?? null)).not.toContain('验收通过');
    expect(JSON.stringify(entity ?? null)).not.toContain('成果');
  });

  it('A4 认知声明:thread presentation 升级 version:1 封闭词表声明,空线 emptyMeaning 用「当前可见」口径(D78 决定 2;US01)', () => {
    const entity = project(snapshot(), 'thread:release-1', deps);
    const presentation = entity?.properties.presentation as Record<string, unknown>;
    // D54 单一落点:version:1 版本化认知声明(当前 presentation 仅含 fields)。
    expect(presentation.version).toBe(1);
    // traits 封闭词表;责任与进行中区域必须声明(US01 责任/材料区分的声明前提)。
    const traits = presentation.traits as readonly string[];
    expect(traits.length).toBeGreaterThan(0);
    for (const trait of traits) expect(COGNITIVE_SEMANTICS_TRAITS).toContain(trait);
    expect(traits).toContain('human-responsibility');
    expect(traits).toContain('work-queue');
    // groupRole 封闭词表:工作线是 principal 的责任组。
    expect(presentation.groupRole).toBe('responsibility');
    expect(COGNITIVE_SEMANTICS_GROUP_ROLES).toContain(presentation.groupRole);
    // 字段声明保持既有三个读字段(目标/生命周期/进行中);材料区由成员卡承载(A1)。
    expect(presentation.fields).toEqual(
      expect.arrayContaining([
        { path: 'properties.identity', title: '目标', role: 'identity' },
        { path: 'properties.statusText', title: '状态', role: 'status' },
      ]),
    );
    // 空线起步:emptyMeaning 声明起步引导(T40 先例词),不写「无进行中/无责任」
    // 全称否定——真空与裁剪同形时合同只出封闭词,文案口径在渲染层(D78 决定 3)。
    const blank: EngineSnapshot = {
      instances: {},
      collections: {},
      threads: {
        'blank-1': {
          id: 'blank-1',
          owner: 'user:mike',
          goal: { text: 'Blank thread', source: 'message:goal-1' },
          status: 'open',
          references: { context: [], active: [], approval: [], event: [] },
          recentEventSeqs: [],
        },
      },
    };
    const blankPresentation = project(blank, 'thread:blank-1', deps)?.properties
      .presentation as Record<string, unknown>;
    expect(blankPresentation.version).toBe(1);
    expect(blankPresentation.emptyMeaning).toBe('ready-to-start');
    expect(COGNITIVE_SEMANTICS_EMPTY_MEANINGS).toContain(blankPresentation.emptyMeaning);
    expect(JSON.stringify(blankPresentation)).not.toMatch(/无(进行中|责任)/);
  });
});
