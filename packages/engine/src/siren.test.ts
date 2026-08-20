import { describe, expect, it } from 'vitest';

import { seedGuardRegistry } from '@ui4a/shared';
import type { GuardRegistry } from '@ui4a/shared';

import {
  articleDraftingFlow,
  commentModerationFlow,
  flowRegistry,
  postStatusFlow,
  seedSnapshot,
} from './fixtures';
import { project } from './siren';

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
