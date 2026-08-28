import { beforeEach, describe, expect, it } from 'vitest';

import { GENERIC_INTENT_POLICY_VERSION, type SirenEntity, type SurfaceNode } from '@ui4a/engine';
import type { CompositionRegionDeclaration } from '@ui4a/shared';

import { resetRecipeCoordinatorForTests } from './recipes-runtime';
import { authorizedRegionSlot, planWorkspaceComposition } from './runtime-composition';

function propertyPaths(node: SurfaceNode): string[] {
  if (node.kind === 'layout') return node.children.flatMap(propertyPaths);
  if (node.kind === 'slot') return propertyPaths(node.child);
  if (node.kind === 'repeat') return propertyPaths(node.item);
  if (node.kind !== 'word') return [];
  return Object.values(node.bindings).flatMap((binding) =>
    binding.kind === 'property' ? [binding.path] : [],
  );
}

beforeEach(() => resetRecipeCoordinatorForTests());

describe('runtime composition generic intent fallback', () => {
  it('passes each exact region intent for the same source and records policy dependency', () => {
    const source: SirenEntity = {
      class: ['opaque'],
      properties: {
        rel: 'record:alpha',
        node: 'active',
        fields: { title: 'Alpha', body: 'Body', alpha: 'A', zeta: 'Z' },
        presentation: {
          fields: [
            { path: 'properties.fields.title', role: 'identity' },
            { path: 'properties.fields.body', role: 'primary-content' },
            { path: 'properties.fields.alpha', role: 'metadata' },
            { path: 'properties.fields.zeta', role: 'metadata' },
          ],
        },
      },
      actions: [],
      links: [],
    };
    const declaration = {
      id: 'same-source',
      version: '1',
      regions: [
        {
          region: 'waiting-for-me',
          source: 'record:alpha',
          intent: 'Review work waiting for me',
          mode: 'rehydrate' as const,
        },
        {
          region: 'in-motion',
          source: 'record:alpha',
          intent: 'Track work currently in motion',
          mode: 'rehydrate' as const,
        },
        {
          region: 'work-lines',
          source: 'record:alpha',
          intent: 'Follow active work lines',
          mode: 'rehydrate' as const,
        },
      ],
    };
    const planned = planWorkspaceComposition({
      rels: ['record:alpha'],
      entities: [source],
      declaration,
      regions: declaration.regions.map((region) => ({ declaration: region, entity: source })),
    });
    if (planned.surface.root.kind !== 'layout') throw new Error('composition root must be layout');

    expect(propertyPaths(planned.surface.root.children[0]!)).toEqual([
      'properties.fields.title',
      'properties.node',
      'properties.fields.body',
      'properties.fields.alpha',
      'properties.fields.zeta',
    ]);
    expect(propertyPaths(planned.surface.root.children[1]!)).toEqual([
      'properties.fields.title',
      'properties.node',
      'properties.fields.alpha',
      'properties.fields.zeta',
    ]);
    expect(propertyPaths(planned.surface.root.children[2]!)).toEqual([
      'properties.fields.title',
      'properties.node',
      'properties.fields.alpha',
    ]);
    expect(planned.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'definition:generic-intent-policy',
          kind: 'definition',
          fingerprint: GENERIC_INTENT_POLICY_VERSION,
          mode: 'invalidate',
        }),
      ]),
    );
  });
});

describe('collection region membership fingerprint guard (T32 Q7)', () => {
  it('collection 类实体缺 entities 数组时显式拒绝并点名区域与原因,不靠内核兜底', () => {
    const malformed: SirenEntity = {
      class: ['collection'],
      properties: { rel: 'records', node: 'active' },
      actions: [],
      links: [],
    };
    const declaration = {
      id: 'broken-collection',
      version: '1',
      regions: [
        { region: 'waiting', source: 'records', intent: 'read', mode: 'rehydrate' as const },
      ],
    };
    expect(() =>
      planWorkspaceComposition({
        rels: ['records'],
        entities: [malformed],
        declaration,
        regions: declaration.regions.map((region) => ({
          declaration: region,
          entity: malformed,
        })),
      }),
    ).toThrowError(/waiting.*entities/u);
  });
});

describe('region slot kind derives from the declared source shape (T31 R12)', () => {
  const collectionSource: SirenEntity = {
    class: ['collection'],
    properties: { rel: 'inbox', node: 'active' },
    actions: [],
    links: [],
  };
  // 与内置 my-work 的 inbox 区域同构:声明源是集合。
  const declaredRegion: CompositionRegionDeclaration & { shape: 'collection' } = {
    region: 'waiting-for-me',
    source: 'inbox',
    intent: 'Review work waiting for me',
    mode: 'rehydrate',
    shape: 'collection',
  };

  it('同一声明在可用与不可用两种状态下推导出一致的 kind,inbox 形状 → collection', () => {
    const unavailable = authorizedRegionSlot({ declaration: declaredRegion });
    const available = authorizedRegionSlot({
      declaration: declaredRegion,
      entity: collectionSource,
    });
    expect(unavailable).toMatchObject({ name: 'waiting-for-me', kind: 'collection' });
    expect(available.kind).toBe(unavailable.kind);
  });

  it('可用时以活合同类为准,声明过期提示不改写合同真相', () => {
    const staleDeclaration = { ...declaredRegion, shape: 'entity' as const };
    expect(
      authorizedRegionSlot({ declaration: staleDeclaration, entity: collectionSource }).kind,
    ).toBe('collection');
  });

  it('未声明形状的存量 wire 数据缺实体时保持单体缺省,不发明集合事实', () => {
    const legacyRegion: CompositionRegionDeclaration = {
      region: 'in-motion',
      source: 'delegations',
      intent: 'Track work currently in motion',
      mode: 'rehydrate',
    };
    expect(authorizedRegionSlot({ declaration: legacyRegion })).toMatchObject({
      name: 'in-motion',
      kind: 'entity',
    });
  });
});

describe('region 主体绑定按活合同规范 rel 规划(T37 flow 入口 region)', () => {
  it('flow 别名实体(rel=实例 rel)的 region 词条绑定规范 rel,不绑定声明源的漂移别名', () => {
    // 服务端 flow 别名(getEntity(flow:<name>) → 实例实体)返回的实体 rel 是
    // <name>:main;region 词条若仍绑定声明源 flow:<name>,region deref 会集体
    // 落空(Phase C 实测 5 条 deref-failed)。与单主体 planner
    // (planGenericPresentationSurface 的 boundSubject 口径)同一台机器。
    const wizard: SirenEntity = {
      class: ['flow-instance'],
      properties: {
        rel: 'article-drafting:main',
        node: 'drafting',
        fields: { title: '文章发布向导', identity: '发布向导' },
        presentation: {
          fields: [{ path: 'properties.fields.title', role: 'identity' }],
        },
      },
      actions: [{ name: 'advance', title: '推进', method: 'POST', href: '/api/exec', fields: {} }],
      links: [{ rel: ['self'], href: '/api/entity?rel=article-drafting%3Amain' }],
    };
    const declaration = {
      id: 'app-publishing',
      version: '1',
      regions: [
        {
          region: 'article-drafting',
          source: 'flow:article-drafting',
          intent: '发起 内容发布 的流程',
          mode: 'invalidate' as const,
          shape: 'entity' as const,
        },
      ],
    };
    const planned = planWorkspaceComposition({
      rels: ['flow:article-drafting'],
      entities: [wizard],
      declaration,
      regions: declaration.regions.map((region) => ({ declaration: region, entity: wizard })),
    });

    const subjects = new Set<string>();
    const visit = (node: SurfaceNode): void => {
      if (node.kind === 'layout') {
        node.children.forEach(visit);
        return;
      }
      if (node.kind === 'slot') {
        visit(node.child);
        return;
      }
      if (node.kind === 'repeat') {
        if (node.source.subject !== '$slot:subject') subjects.add(node.source.subject);
        visit(node.item);
        return;
      }
      if (node.kind === 'word') {
        for (const binding of Object.values(node.bindings)) {
          if (binding.kind !== 'item') subjects.add(binding.subject);
        }
      }
    };
    visit(planned.surface.root);
    expect(subjects).toContain('article-drafting:main');
    expect(subjects).not.toContain('flow:article-drafting');
  });
});
