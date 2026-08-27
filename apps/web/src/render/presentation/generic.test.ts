import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GENERIC_INTENT_POLICY,
  planGenericSurface,
  selectGenericFieldCandidates,
  type SirenEntity,
  type SurfaceNode,
} from '@ui4a/engine';

import { PRESENTATION_SURFACE_CATALOG } from '../../engine/presentation/catalog';
import { semanticHintsOf } from '../../engine/presentation/situation';
import { hydratePresentationSurface, planGenericPresentationSurface } from './generic';

function propertyIdentityPaths(node: SurfaceNode): string[] {
  if (node.kind === 'layout') return node.children.flatMap(propertyIdentityPaths);
  if (node.kind === 'slot') return propertyIdentityPaths(node.child);
  if (node.kind === 'repeat') return propertyIdentityPaths(node.item);
  if (node.kind !== 'word' || node.role !== 'identity') return [];
  return Object.values(node.bindings).flatMap((binding) =>
    binding.kind === 'property' ? [binding.path] : [],
  );
}

function stringValues(value: unknown): Set<string> {
  const result = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      result.add(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (typeof candidate === 'object' && candidate !== null) {
      Object.values(candidate as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return result;
}

const post: SirenEntity = {
  class: ['flow-instance'],
  properties: {
    rel: 'post:first-post',
    node: 'published',
    title: '已发布',
    identity: '第一篇',
    status: 'published',
    fields: { title: '第一篇', body: '完整正文', category: 'essay' },
    presentation: {
      fields: [
        { path: 'properties.fields.title', title: '文章标题', role: 'identity' },
        { path: 'properties.fields.body', title: '正文', role: 'primary-content' },
        { path: 'properties.fields.category', title: '分类', role: 'metadata' },
      ],
    },
  },
  actions: [],
  links: [],
};

describe('generic Presentation runtime plan', () => {
  it('hydrates identity/body/status/metadata while keeping facts out of A2UI components', () => {
    const plan = planGenericPresentationSurface('post:first-post', post, 'definition-v1', 'review');
    const components = JSON.stringify(plan.bundle.messages[2]);
    const data = JSON.stringify(plan.bundle.messages[1]);

    expect(plan.bundle.issues).toEqual([]);
    expect(components).not.toContain('完整正文');
    expect(components).not.toContain('第一篇');
    expect(data).toContain('完整正文');
    expect(data).toContain('第一篇');
    expect(data).toContain('published');
    expect(data).toContain('essay');
    expect(data).not.toContain('已发布');
  });

  it('binds a Flow alias request to the canonical entity rel returned by Siren', () => {
    const flow = {
      ...post,
      properties: { ...post.properties, rel: 'article-drafting:main' },
    };
    const plan = planGenericPresentationSurface(
      'flow:article-drafting',
      flow,
      'definition-v1',
      'read',
    );
    expect(plan.bundle.issues).toEqual([]);
    expect(JSON.stringify(plan.surface)).toContain('article-drafting:main');
    expect(JSON.stringify(plan.surface)).not.toContain('$slot');
  });

  it('hydrate 按注视 subject 别名单根依赖实体,绑定不因规范 rel 漂移集体失败(T35 F-03)', () => {
    // 服务端 runtime.plan 以请求 subject(flow:article-drafting)与别名后的
    // 实例实体规划 surface;hydrate 拿到的单根依赖实体 rel 是实例 rel。
    // 绑定 deref 不得因规范 rel 漂移而集体落空。
    const aliasedEntity: SirenEntity = {
      ...post,
      properties: { ...post.properties, rel: 'article-drafting:main' },
    };
    const planned = planGenericSurface(
      'flow:article-drafting',
      aliasedEntity,
      PRESENTATION_SURFACE_CATALOG,
      {
        entityVersion: 'definition-v1',
        intent: 'read',
        semanticHints: semanticHintsOf(aliasedEntity),
        provenanceRef: 'request:test',
      },
    );
    const plan = hydratePresentationSurface('flow:article-drafting', planned, [aliasedEntity]);
    expect(plan.bundle.issues).toEqual([]);
  });

  it('uses a collection-declared human title as identity while retaining the canonical rel', () => {
    const collection: SirenEntity = {
      class: ['collection', 'threads'],
      properties: {
        rel: 'threads',
        title: '我的工作线',
        count: 0,
        presentation: {
          fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
        },
      },
      actions: [],
      links: [{ rel: ['self'], href: '/api/entity?rel=threads' }],
      entities: [],
    };

    const plan = planGenericPresentationSurface('threads', collection, 'definition-v1', 'read');
    expect(plan.bundle.issues).toEqual([]);
    expect(JSON.stringify(plan.surface)).toContain('properties.title');
    expect(propertyIdentityPaths(plan.surface.root)).toEqual(['properties.title']);
    expect(JSON.stringify(plan.bundle.messages[1])).toContain('我的工作线');
    expect(collection.properties.rel).toBe('threads');
  });

  it('keeps compiled components binding-only for random selected intent subsets', () => {
    const roles = ['identity', 'status', 'primary-content', 'metadata', 'relation'] as const;
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: roles.length,
          maxLength: roles.length,
        }),
        fc.constantFrom('read', 'overview', 'review', 'track', 'unknown free-form'),
        (values, intent) => {
          const fields = Object.fromEntries(
            roles.map((role, index) => [`field${index}`, `FACT_${index}_${values[index]}`]),
          );
          const hints = roles.map((role, index) => ({
            path: `properties.fields.field${index}`,
            title: `Field ${index}`,
            role,
          }));
          const entity: SirenEntity = {
            class: ['opaque'],
            properties: {
              rel: 'record:property',
              node: 'active',
              fields,
              presentation: { fields: hints },
            },
            actions: [{ name: 'act', title: 'Act', method: 'POST', href: '/api/exec', fields: {} }],
            links: [{ rel: ['self'], href: '/api/entity?rel=record%3Aproperty' }],
            entities: [],
          };

          const plan = planGenericPresentationSurface(
            'record:property',
            entity,
            'definition-v1',
            intent,
          );
          const components = JSON.stringify(plan.bundle.messages[2]);
          const dataValues = stringValues(plan.bundle.messages[1]);
          for (const value of Object.values(fields)) expect(components).not.toContain(value);

          const selectedPaths = new Set(
            selectGenericFieldCandidates(intent, hints, GENERIC_INTENT_POLICY).map(
              ({ path }) => path,
            ),
          );
          hints.forEach(({ path }, index) => {
            const value = fields[`field${index}`]!;
            expect(dataValues.has(value)).toBe(selectedPaths.has(path));
          });
          expect(JSON.stringify(plan.surface)).not.toMatch(/FACT_/);
          expect(JSON.stringify(plan.surface)).toContain('"kind":"actions"');
          expect(JSON.stringify(plan.surface)).toContain('"kind":"links"');
          expect(JSON.stringify(plan.surface)).toContain('"kind":"entities"');
        },
      ),
      { numRuns: 80 },
    );
  });
});
