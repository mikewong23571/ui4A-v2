import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';
import type { EngineSnapshot, GuardRegistry } from '@ui4a/shared';

import { approveConfirmation } from '../execution/confirmation';
import { executeWithGates } from '../execution/execute';
import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
  seedSnapshot,
} from '../core/fixtures';
import { project } from './siren/index';

const deps = {
  flows: flowRegistry(articleDraftingFlow, postStatusFlow, commentModerationFlow),
  guards: seedGuardRegistry,
};

describe('project — 实例实体(四件组装:properties/actions/links/guard-results)', () => {
  it('实例实体:class/properties(节点+原始字段值)/links(self)', () => {
    const entity = project(seedSnapshot, 'post:post-welcome', deps);
    expect(entity).toMatchObject({
      class: ['flow-instance', 'post-status'],
      properties: {
        rel: 'post:post-welcome',
        flow: 'post-status',
        node: 'published',
        title: '已发布',
        fields: { title: 'Welcome to UI4A', category: 'tech' },
      },
    });
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=post:post-welcome' },
      { rel: ['collection'], href: '/api/entity?rel=articles' },
    ]);
  });

  it('从实例出生定义投影 identity/status 与不携带事实的字段呈现元数据', () => {
    const semanticV1 = {
      ...postStatusFlow,
      version: 1,
      fields: [
        {
          name: 'title',
          type: 'text' as const,
          title: '文章标题',
          presentation: { role: 'identity' as const },
        },
        {
          name: 'body',
          type: 'textarea' as const,
          title: '正文',
          presentation: { role: 'primary-content' as const },
          contentMediaType: 'text/plain',
        },
        {
          name: 'category',
          type: 'text' as const,
          title: '分类',
          presentation: { role: 'metadata' as const },
        },
      ],
    };
    const semanticV2 = { ...postStatusFlow, version: 2, fields: [] };
    const snapshot: EngineSnapshot = {
      ...seedSnapshot,
      instances: {
        ...seedSnapshot.instances,
        'post:post-welcome': {
          ...seedSnapshot.instances['post:post-welcome']!,
          bornVersion: 1,
        },
      },
    };

    const entity = project(snapshot, 'post:post-welcome', {
      flows: { 'post-status': semanticV2 },
      versions: { 'post-status': { 1: semanticV1, 2: semanticV2 } },
      guards: seedGuardRegistry,
    });

    expect(entity?.properties).toMatchObject({
      title: '已发布',
      identity: 'Welcome to UI4A',
      status: 'published',
      presentation: {
        fields: [
          {
            path: 'properties.fields.title',
            title: '文章标题',
            role: 'identity',
          },
          {
            path: 'properties.fields.body',
            title: '正文',
            role: 'primary-content',
            contentMediaType: 'text/plain',
          },
          {
            path: 'properties.fields.category',
            title: '分类',
            role: 'metadata',
          },
        ],
      },
    });
    expect(entity?.properties.presentation).not.toEqual(
      expect.objectContaining({
        title: 'Welcome to UI4A',
        category: 'tech',
      }),
    );
    expect(JSON.stringify(entity?.properties.presentation)).not.toContain('Welcome to UI4A');
    expect(JSON.stringify(entity?.properties.presentation)).not.toContain('tech');
  });

  it('无显式角色时按通用字段语义回退，不把节点 title 当身份', () => {
    const entity = project(seedSnapshot, 'post:post-welcome', deps);
    expect(entity?.properties.identity).toBe('Welcome to UI4A');
    expect(entity?.properties.identity).not.toBe(entity?.properties.title);
    expect(entity?.properties.status).toBe('published');
    expect(entity?.properties.presentation).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ path: 'properties.fields.title', role: 'identity' }),
        expect.objectContaining({ path: 'properties.fields.category', role: 'metadata' }),
      ]),
    });
  });

  it('无身份字段的开放 Flow 以 flow 标题作为稳定身份，不使用当前节点标题', () => {
    const entity = project(
      {
        ...seedSnapshot,
        instances: {
          ...seedSnapshot.instances,
          'article-drafting:main': {
            ...seedSnapshot.instances['article-drafting:main']!,
            fields: {},
          },
        },
      },
      'article-drafting:main',
      deps,
    );
    expect(entity?.properties.identity).toBe(articleDraftingFlow.title);
    expect(entity?.properties.identity).not.toBe(entity?.properties.title);
  });

  it('actions:name/title/method=POST/href=/api/exec,fields 为 JSON Schema(select 枚举)', () => {
    const entity = project(seedSnapshot, 'article-drafting:main', deps);
    const next = entity?.actions.find((action) => action.name === 'next');
    expect(next).toMatchObject({
      name: 'next',
      title: '下一步',
      method: 'POST',
      href: '/api/exec',
    });
    expect(next?.fields).toMatchObject({
      type: 'object',
      required: ['category'],
      properties: expect.objectContaining({
        category: { type: 'string', enum: ['tech', 'essay', 'review'] },
      }),
    });
  });

  it('requires-confirmation 原样透传(T2 仅类型字段)', () => {
    const entity = project(seedSnapshot, 'post:post-welcome', deps);
    expect(entity?.actions.find((a) => a.name === 'archive')).toMatchObject({
      'requires-confirmation': 'high',
    });
  });

  it('guard-results 逐项注入:当前节点每个 action 的每个 guard 都有求值结果', () => {
    const entity = project(seedSnapshot, 'comment:c1', deps);
    const results = entity?.['guard-results'] ?? [];
    expect(results.map((entry) => entry.action)).toEqual(['approve', 'reject', 'flag']);
    expect(results[0]).toEqual({
      action: 'approve',
      blocked: false,
      guards: [{ name: 'is-pending', pass: true }],
    });
  });

  it('guard 不满足 → blocked=true 且 reason 注明失败谓词(拒绝即教育)', () => {
    const unmet: GuardRegistry = { 'is-pending': () => false };
    const entity = project(seedSnapshot, 'comment:c1', { ...deps, guards: unmet });
    const approve = entity?.['guard-results']?.[0];
    expect(approve).toMatchObject({ action: 'approve', blocked: true });
    expect(approve?.reason).toContain('is-pending=false');
  });

  it('未注册 guard → fail-closed,reason 注明未注册', () => {
    const entity = project(seedSnapshot, 'comment:c1', { ...deps, guards: {} });
    const approve = entity?.['guard-results']?.[0];
    expect(approve?.blocked).toBe(true);
    expect(JSON.stringify(approve)).toContain('未注册');
  });

  it('未知 rel → undefined(Phase C 由 HTTP 层映射 404)', () => {
    expect(project(seedSnapshot, 'ghost:rel', deps)).toBeUndefined();
  });

  it('baseHref 注入绝对前缀;缺省相对路径', () => {
    const absolute = project(seedSnapshot, 'post:post-welcome', {
      ...deps,
      baseHref: 'http://localhost:3100',
    });
    expect(absolute?.actions[0]?.href).toBe('http://localhost:3100/api/exec');
    expect(absolute?.links[0]?.href).toBe('http://localhost:3100/api/entity?rel=post:post-welcome');
  });
});

describe('project — 集合实体(entities[] 子实体直达)', () => {
  it('集合:properties.count、links.self、entities[] 成员子实体', () => {
    const entity = project(seedSnapshot, 'articles', deps);
    expect(entity).toMatchObject({
      class: ['collection', 'articles'],
      properties: { rel: 'articles', count: 2 },
      links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
    });
    expect(entity?.entities).toHaveLength(2);
  });

  it('子实体带 rel=["item"] 与直达 href(B2 经子实体链接直达 post:post-welcome)', () => {
    const entity = project(seedSnapshot, 'articles', deps);
    const welcome = entity?.entities?.[0];
    expect(welcome?.rel).toEqual(['item']);
    expect(welcome?.href).toBe('/api/entity?rel=post:post-welcome');
    expect(welcome?.properties).toMatchObject({
      rel: 'post:post-welcome',
      node: 'published',
      fields: { title: 'Welcome to UI4A' },
    });
  });

  it('子实体自带 actions 与 guard-results(agent 可直达即执行)', () => {
    const entity = project(seedSnapshot, 'articles', deps);
    const welcome = entity?.entities?.[0];
    expect(welcome?.actions.map((a) => a.name)).toEqual(['unpublish', 'archive']);
    expect(welcome?.['guard-results']?.every((entry) => Array.isArray(entry.guards))).toBe(true);
  });

  it('投影是纯函数:不改输入快照', () => {
    const before = JSON.stringify(seedSnapshot);
    project(seedSnapshot, 'articles', deps);
    project(seedSnapshot, 'comment:c1', deps);
    expect(JSON.stringify(seedSnapshot)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// confirmation 实体与 inbox 投影(T3:pending 确认的人类视图)
// ---------------------------------------------------------------------------

/** agent 挂起 archive → 带 pending c1 的快照。 */
function suspendedSnapshot(): EngineSnapshot {
  const outcome = executeWithGates(
    {
      rel: 'post:post-welcome',
      action: 'archive',
      params: {},
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
    },
    seedSnapshot,
    deps,
  );
  if (outcome.kind !== 'suspended') throw new Error(`前置失败:期望 suspended,得到 ${outcome.kind}`);
  return outcome.snapshot;
}

describe('project — confirmation 实体(spec 架构决定 2)', () => {
  it('properties 含目标 rel/action/params/提议者/信道/状态;links 含 self 与 target 直达', () => {
    const entity = project(suspendedSnapshot(), 'confirmation:c1', deps);
    expect(entity).toMatchObject({
      class: ['confirmation', 'pending'],
      properties: {
        id: 'c1',
        'target-rel': 'post:post-welcome',
        'target-action': 'archive',
        params: {},
        'proposed-by': { actor: 'agent', principal: 'user:mike' },
        channel: 'http',
        status: 'pending',
      },
    });
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=confirmation:c1' },
      { rel: ['target'], href: '/api/entity?rel=post:post-welcome' },
    ]);
  });

  it('actions:approve 与 reject;reject 的 reason 必填且 minLength=1(RJSF 直接渲染)', () => {
    const entity = project(suspendedSnapshot(), 'confirmation:c1', deps);
    const names = entity?.actions.map((action) => action.name);
    expect(names).toEqual(['approve', 'reject']);

    const reject = entity?.actions[1];
    expect(reject).toMatchObject({
      name: 'reject',
      title: '驳回',
      method: 'POST',
      href: '/api/exec',
    });
    expect(reject?.fields).toMatchObject({
      type: 'object',
      required: ['reason'],
      properties: { reason: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    });
    expect(entity?.actions[0]).toMatchObject({ name: 'approve', title: '批准' });
  });

  it('guard-results 注入 actor-is-human 求值(投影无 actor 上下文 → fail-closed)', () => {
    const entity = project(suspendedSnapshot(), 'confirmation:c1', deps);
    const results = entity?.['guard-results'] ?? [];
    expect(results.map((entry) => entry.action)).toEqual(['approve', 'reject']);
    for (const entry of results) {
      expect(entry.guards).toEqual([{ name: 'actor-is-human', pass: false }]);
      expect(entry.blocked).toBe(true);
      expect(entry.reason).toContain('actor-is-human');
    }
  });

  it('非 pending(approved)确认:actions 空、class 带 approved(审计视图,不再可审批)', () => {
    const approved = approveConfirmation(
      suspendedSnapshot(),
      'c1',
      { actor: 'human', principal: 'user:mike' },
      deps,
    );
    if (approved.kind !== 'confirmed') throw new Error('前置失败');

    const entity = project(approved.snapshot, 'confirmation:c1', deps);
    expect(entity).toMatchObject({
      class: ['confirmation', 'approved'],
      properties: { status: 'approved' },
    });
    expect(entity?.actions).toEqual([]);
    expect(entity?.['guard-results']).toEqual([]);
  });

  it('未知 confirmation rel → undefined(404 路径不受影响)', () => {
    expect(project(suspendedSnapshot(), 'confirmation:ghost', deps)).toBeUndefined();
  });
});

describe('project — inbox 集合(spec 架构决定 5)', () => {
  it('inbox = 全部 pending confirmations:子实体直达(href/rel=item/guard-results 注入)', () => {
    const entity = project(suspendedSnapshot(), 'inbox', deps);
    expect(entity).toMatchObject({
      class: ['collection', 'inbox'],
      properties: {
        rel: 'inbox',
        title: '在等我',
        count: 1,
        presentation: {
          fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
        },
      },
    });
    expect(entity?.links).toEqual([
      { rel: ['self'], href: '/api/entity?rel=inbox', title: '在等我' },
    ]);

    const item = entity?.entities?.[0];
    expect(item?.rel).toEqual(['item']);
    expect(item?.href).toBe('/api/entity?rel=confirmation:c1');
    expect(item?.properties).toMatchObject({
      'target-action': 'archive',
      'risk-level': 'high',
      'policy-reason': expect.stringContaining('需人类确认'),
      status: 'pending',
    });
    expect(item?.actions.map((action) => action.name)).toEqual(['approve', 'reject']);
    expect(item?.['guard-results']?.length).toBe(2);
  });

  it('approved/rejected 的确认不再进 inbox(只看 pending)', () => {
    const approved = approveConfirmation(
      suspendedSnapshot(),
      'c1',
      { actor: 'human', principal: 'user:mike' },
      deps,
    );
    if (approved.kind !== 'confirmed') throw new Error('前置失败');

    const entity = project(approved.snapshot, 'inbox', deps);
    expect(entity?.properties).toMatchObject({ rel: 'inbox', count: 0 });
    expect(entity?.entities).toEqual([]);
  });

  it('无确认时 inbox 仍可投影(空集合)', () => {
    const entity = project(seedSnapshot, 'inbox', deps);
    expect(entity).toMatchObject({
      class: ['collection', 'inbox'],
      properties: { rel: 'inbox', count: 0 },
    });
    expect(entity?.entities).toEqual([]);
  });

  it('delivered 计数:已送达(notified)的 pending 确认计入,未送达不计(T3 Phase C)', () => {
    const suspended = suspendedSnapshot();
    const c1 = suspended.confirmations?.['confirmation:c1'];
    if (c1 === undefined) throw new Error('前置失败:缺少 confirmation:c1');
    const notified: EngineSnapshot = {
      ...suspended,
      confirmations: { 'confirmation:c1': { ...c1, notified: true } },
    };

    const entity = project(notified, 'inbox', deps);
    expect(entity?.properties).toMatchObject({ rel: 'inbox', count: 1, delivered: 1 });
    expect(entity?.entities?.[0]?.properties).toMatchObject({ notified: true });

    // 未送达:delivered=0,子实体不带 notified 键。
    const plain = project(suspendedSnapshot(), 'inbox', deps);
    expect(plain?.properties).toMatchObject({ rel: 'inbox', count: 1, delivered: 0 });
    expect(plain?.entities?.[0]?.properties).not.toHaveProperty('notified');
  });

  it('确认实体投影:notified=true 时注入 properties(送达状态对人类可见)', () => {
    const suspended = suspendedSnapshot();
    const c1 = suspended.confirmations?.['confirmation:c1'];
    if (c1 === undefined) throw new Error('前置失败:缺少 confirmation:c1');
    const notified: EngineSnapshot = {
      ...suspended,
      confirmations: { 'confirmation:c1': { ...c1, notified: true } },
    };

    expect(project(notified, 'confirmation:c1', deps)?.properties).toMatchObject({
      status: 'pending',
      notified: true,
    });
  });
});
