import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';
import type { RenderSituation } from '@ui4a/shared';

import { buildSirenSituation, semanticHintsOf, subtreeKeysOf } from './situation';

function entity(rel: string, overrides: Partial<SirenEntity> = {}): SirenEntity {
  return {
    class: ['opaque'],
    properties: { rel },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` }],
    ...overrides,
  };
}

function situation(roots: string[], lens: RenderSituation['lens']): RenderSituation {
  return {
    schemaVersion: 1,
    roots: roots.map((rel) => ({ rel })),
    intent: 'inspect',
    lens,
    audience: { principal: 'local-user', policyScope: 'local-demo' },
    budget: { maxDepth: 3, maxNodes: 8 },
  };
}

describe('Siren Presentation Situation adapter', () => {
  it('keeps authorized entities private and emits a fact-free public graph', async () => {
    const rows = {
      articles: entity('articles', {
        class: ['collection'],
        properties: { rel: 'articles', count: 2 },
        entities: [
          entity('post:visible', { properties: { rel: 'post:visible', identity: 'Visible' } }),
          entity('post:secret', { properties: { rel: 'post:secret', identity: 'SECRET' } }),
        ],
      }),
      'post:visible': entity('post:visible', {
        properties: { rel: 'post:visible', identity: 'Visible' },
      }),
      'post:secret': entity('post:secret', {
        properties: { rel: 'post:secret', identity: 'SECRET' },
      }),
    };
    const result = await buildSirenSituation(situation(['articles'], { kind: 'members' }), {
      authorize: async ({ targetRel }) => targetRel !== 'post:secret',
      fetch: async (rel) => rows[rel as keyof typeof rows],
    });

    expect(JSON.stringify(result.graph)).not.toMatch(/SECRET|post:secret/);
    expect(result.entities.has('post:secret')).toBe(false);
    expect(result.entities.get('articles')?.entities?.map((item) => item.properties.rel)).toEqual([
      'post:visible',
    ]);
    expect(result.entities.get('articles')?.properties.count).toBe(1);
  });

  it('derives semantic hints from declaration paths without copying their values', () => {
    const post = entity('post:first', {
      properties: {
        rel: 'post:first',
        fields: { title: 'First', body: 'SECRET BODY' },
        presentation: {
          fields: [
            { path: 'properties.fields.title', title: 'Title', role: 'identity' },
            { path: 'properties.fields.body', title: 'Body', role: 'primary-content' },
          ],
        },
      },
    });

    const hints = semanticHintsOf(post);
    expect(hints).toEqual({
      'properties.fields.title': 'identity',
      'properties.fields.body': 'primary-content',
    });
    expect(JSON.stringify(hints)).not.toContain('SECRET BODY');
  });

  it('keeps collection and Flow shells stable while item/current-task keys change structurally', () => {
    const collectionA = entity('articles', {
      class: ['collection'],
      entities: [entity('post:a')],
    });
    const collectionB = { ...collectionA, entities: [entity('post:a'), entity('post:b')] };
    expect(subtreeKeysOf(collectionA, 'browse', 'definition-v1').shell).toBe(
      subtreeKeysOf(collectionB, 'browse', 'definition-v1').shell,
    );
    expect(subtreeKeysOf(collectionB, 'browse', 'definition-v1').children).toHaveLength(2);

    const flowA = entity('draft:1', {
      properties: { rel: 'draft:1', flow: 'drafting', node: 'basic' },
    });
    const flowB = entity('draft:1', {
      properties: { rel: 'draft:1', flow: 'drafting', node: 'content' },
    });
    expect(subtreeKeysOf(flowA, 'continue', 'definition-v1').shell).toBe(
      subtreeKeysOf(flowB, 'continue', 'definition-v1').shell,
    );
    expect(subtreeKeysOf(flowA, 'continue', 'definition-v1').current).not.toBe(
      subtreeKeysOf(flowB, 'continue', 'definition-v1').current,
    );
  });
});
