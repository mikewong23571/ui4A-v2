import { describe, expect, it } from 'vitest';

import type { GuardContext } from './guards';
import {
  actorIsHuman,
  isPending,
  isPublished,
  alwaysTrue,
  nodeIs,
  seedGuardRegistry,
  titleNotTaken,
  isDraft,
  isActive,
  nodeExists,
  nodeNotExists,
  toExists,
  guardsRegistered,
  effectKnown,
  actionNotExists,
  noLiveInstances,
} from './predicates';
import type { EngineSnapshot } from './state';
import type { FlowDefinition } from './definition';

function contextAt(node: string, actor?: 'human' | 'agent'): GuardContext {
  const snapshot: EngineSnapshot = {
    instances: {
      'comment:c1': { rel: 'comment:c1', flow: 'comment-moderation', node, fields: {} },
    },
    collections: {},
  };
  return {
    instance: snapshot.instances['comment:c1']!,
    snapshot,
    params: {},
    ...(actor !== undefined ? { actor } : {}),
  };
}

describe('种子谓词(纯函数,只读快照)', () => {
  it('is-pending:node=pending 为 true,其余 false', () => {
    expect(isPending(contextAt('pending'))).toBe(true);
    expect(isPending(contextAt('approved'))).toBe(false);
  });

  it('is-published:node=published 为 true,其余 false', () => {
    expect(isPublished(contextAt('published'))).toBe(true);
    expect(isPublished(contextAt('offline'))).toBe(false);
  });

  it('always-true 恒真(空 guard 动作的显式占位)', () => {
    expect(alwaysTrue(contextAt('anything'))).toBe(true);
  });

  it('nodeIs(name) 工厂:生成具名节点谓词', () => {
    const isOffline = nodeIs('offline');
    expect(isOffline(contextAt('offline'))).toBe(true);
    expect(isOffline(contextAt('pending'))).toBe(false);
  });

  it('title-not-taken:params.title 不与既有 post 标题重复(跨实例只读快照)', () => {
    const snapshot: EngineSnapshot = {
      instances: {
        'post:post-welcome': {
          rel: 'post:post-welcome',
          flow: 'post-status',
          node: 'published',
          fields: { title: { value: '欢迎来到 UI4A', origin: 'intent' } },
        },
        // 非文章实例的同名字段不算占用。
        'comment:c1': {
          rel: 'comment:c1',
          flow: 'comment-moderation',
          node: 'pending',
          fields: { title: { value: '欢迎来到 UI4A', origin: 'intent' } },
        },
        'article-drafting:main': {
          rel: 'article-drafting:main',
          flow: 'article-drafting',
          node: 'ready',
          fields: {},
        },
      },
      collections: {},
    };
    const context = (params: Record<string, unknown>): GuardContext => ({
      instance: snapshot.instances['article-drafting:main']!,
      snapshot,
      params,
    });

    expect(titleNotTaken(context({ title: '新文章' }))).toBe(true);
    expect(titleNotTaken(context({ title: '欢迎来到 UI4A' }))).toBe(false);
    expect(titleNotTaken(context({}))).toBe(true);
  });

  it('谓词求值不改上下文(纯)', () => {
    const context = contextAt('pending');
    const before = JSON.stringify(context);
    isPending(context);
    nodeIs('x')(context);
    expect(JSON.stringify(context)).toBe(before);
  });
});

describe('actor-is-human(铁律 5:审批不委托)', () => {
  it('actor=human → true;actor=agent → false(I4:agent 身份审批被拒)', () => {
    expect(actorIsHuman(contextAt('pending', 'human'))).toBe(true);
    expect(actorIsHuman(contextAt('pending', 'agent'))).toBe(false);
  });

  it('无 actor 上下文(投影求值)→ false(fail-closed,与未注册 guard 同口径)', () => {
    expect(actorIsHuman(contextAt('pending'))).toBe(false);
  });

  it('进入种子注册表(actor-is-human)', () => {
    expect(seedGuardRegistry['actor-is-human']).toBe(actorIsHuman);
  });
});

describe('seedGuardRegistry(名字 → 谓词)', () => {
  it('包含种子谓词名', () => {
    expect(Object.keys(seedGuardRegistry)).toEqual(
      expect.arrayContaining(['is-pending', 'is-published', 'always-true', 'title-not-taken']),
    );
  });

  it('注册表条目可直接求值', () => {
    expect(seedGuardRegistry['is-pending']!(contextAt('pending'))).toBe(true);
    expect(seedGuardRegistry['is-published']!(contextAt('pending'))).toBe(false);
  });

  it('T4 meta 谓词名全部注册(A.3 编辑动词 guard 集)', () => {
    expect(Object.keys(seedGuardRegistry)).toEqual(
      expect.arrayContaining([
        'is-draft',
        'is-active',
        'node-exists',
        'node-not-exists',
        'to-exists',
        'guards-registered',
        'effect-known',
        'action-not-exists',
        'no-live-instances',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// meta 平面谓词(T4):上下文 = lifecycle 实例,工作副本从 definitions 表读。
// ---------------------------------------------------------------------------

const draftFlow: FlowDefinition = {
  name: 'post-status',
  initial: 'published',
  nodes: [
    { name: 'published', actions: [{ name: 'unpublish', title: '下线', to: 'offline' }] },
    { name: 'offline', actions: [] },
  ],
};

/** lifecycle 实例上下文(meta/flow:post-status,工作副本 = draftFlow)。 */
function metaContext(
  node: string,
  params: Record<string, unknown> = {},
  extra?: { liveInstances?: boolean; knownGuards?: ReadonlySet<string> },
): GuardContext {
  const snapshot: EngineSnapshot = {
    instances: {
      'meta/flow:post-status': {
        rel: 'meta/flow:post-status',
        flow: 'definition-lifecycle',
        node,
        fields: {},
      },
      ...(extra?.liveInstances
        ? { 'post:p1': { rel: 'post:p1', flow: 'post-status', node: 'published', fields: {} } }
        : {}),
    },
    collections: {},
    definitions: { 'post-status': { name: 'post-status', version: 1, status: 'draft', definition: draftFlow } },
  };
  return {
    instance: snapshot.instances['meta/flow:post-status']!,
    snapshot,
    params,
    ...(extra?.knownGuards !== undefined ? { knownGuards: extra.knownGuards } : {}),
  };
}

describe('meta 谓词(纯函数,只读快照)', () => {
  it('is-draft/is-active:lifecycle 实例按节点判定;业务实例恒 false', () => {
    expect(isDraft(metaContext('draft'))).toBe(true);
    expect(isDraft(metaContext('active'))).toBe(false);
    expect(isActive(metaContext('active'))).toBe(true);
    expect(isActive(contextAt('published'))).toBe(false); // 业务实例不带 definition-lifecycle flow
  });

  it('node-exists/node-not-exists:按工作副本;参数缺席 vacuous pass', () => {
    expect(nodeExists(metaContext('draft', { node: 'published' }))).toBe(true);
    expect(nodeExists(metaContext('draft', { node: 'ghost' }))).toBe(false);
    expect(nodeExists(metaContext('draft', {}))).toBe(true);
    expect(nodeNotExists(metaContext('draft', { name: 'fresh' }))).toBe(true);
    expect(nodeNotExists(metaContext('draft', { name: 'published' }))).toBe(false);
    // add-node 用 name,add-action 用 node——两者都识别。
    expect(nodeNotExists(metaContext('draft', { node: 'fresh' }))).toBe(true);
  });

  it('to-exists:to 指向工作副本节点;未声明 to = vacuous;畸形载荷 false', () => {
    expect(toExists(metaContext('draft', { action: { name: 'x', to: 'offline' } }))).toBe(true);
    expect(toExists(metaContext('draft', { action: { name: 'x', to: 'ghost' } }))).toBe(false);
    expect(toExists(metaContext('draft', { action: { name: 'x' } }))).toBe(true);
    expect(toExists(metaContext('draft', {}))).toBe(true);
    expect(toExists(metaContext('draft', { action: 'not-an-object' }))).toBe(false);
  });

  it('guards-registered:按 knownGuards 键集;未注册/缺上下文 false', () => {
    const known = new Set(['is-pending']);
    expect(guardsRegistered(metaContext('draft', { action: { guards: ['is-pending'] } }, { knownGuards: known }))).toBe(true);
    expect(guardsRegistered(metaContext('draft', { action: { guards: ['nope'] } }, { knownGuards: known }))).toBe(false);
    expect(guardsRegistered(metaContext('draft', { action: { guards: ['is-pending'] } }))).toBe(false);
    expect(guardsRegistered(metaContext('draft', {}))).toBe(true);
  });

  it('effect-known:类型词表;未声明效果 vacuous;未知类型 false', () => {
    expect(effectKnown(metaContext('draft', { action: { effect: [{ type: 'transition', to: 'offline' }] } }))).toBe(true);
    expect(effectKnown(metaContext('draft', { action: { effect: { type: 'set-field', field: 'x', value: 1 } } }))).toBe(true);
    expect(effectKnown(metaContext('draft', { action: { effect: [{ type: 'teleport' }] } }))).toBe(false);
    expect(effectKnown(metaContext('draft', { action: {} }))).toBe(true);
  });

  it('action-not-exists:目标节点上同名动作防重复;参数缺席 vacuous', () => {
    expect(actionNotExists(metaContext('draft', { node: 'published', action: { name: 'pin' } }))).toBe(true);
    expect(actionNotExists(metaContext('draft', { node: 'published', action: { name: 'unpublish' } }))).toBe(false);
    expect(actionNotExists(metaContext('draft', {}))).toBe(true);
  });

  it('no-live-instances:非 terminal 节点上的业务实例即"在途"', () => {
    expect(noLiveInstances(metaContext('active', {}, { liveInstances: true }))).toBe(false);
    expect(noLiveInstances(metaContext('active'))).toBe(true);
    // 在 terminal(offline 无出边)上的实例不算在途。
    const terminalOnly: GuardContext = {
      ...metaContext('active'),
      snapshot: {
        ...metaContext('active').snapshot,
        instances: {
          'meta/flow:post-status': metaContext('active').instance,
          'post:p1': { rel: 'post:p1', flow: 'post-status', node: 'offline', fields: {} },
        },
      },
    };
    expect(noLiveInstances(terminalOnly)).toBe(true);
  });
});
