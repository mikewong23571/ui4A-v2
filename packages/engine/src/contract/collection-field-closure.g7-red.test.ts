import { describe, expect, it } from 'vitest';

import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';

import { flowRegistry } from '../core/fixtures';
import type { FlowDefinition } from '../core/types';
import { project } from './siren';
import { deriveSitemap } from './sitemap';

const collectionRel = 'future-catalog-7f3';

const catalogOwner: FlowDefinition = {
  name: 'future-catalog-owner',
  title: 'Future catalog owner',
  app: 'community',
  initial: 'listed',
  collections: [{ collection: collectionRel }],
  fields: [
    {
      name: 'title',
      title: 'Declared title',
      type: 'text',
      presentation: { role: 'identity', overview: true },
    },
    {
      name: 'summary',
      title: 'Declared summary',
      type: 'text',
      presentation: { role: 'primary-content', overview: true },
    },
  ],
  nodes: [{ name: 'listed', actions: [] }],
};

const unrelatedFlow: FlowDefinition = {
  name: 'unrelated-runtime-flow',
  title: 'Unrelated runtime Flow',
  app: 'publishing',
  initial: 'ready',
  fields: [
    {
      name: 'secret',
      title: 'Unrelated secret',
      type: 'text',
      presentation: { role: 'metadata', overview: true },
    },
  ],
  nodes: [{ name: 'ready', actions: [] }],
};

const expectedOwnerFields = [
  {
    path: 'properties.fields.title',
    title: 'Declared title',
    role: 'identity',
    overview: true,
  },
  {
    path: 'properties.fields.summary',
    title: 'Declared summary',
    role: 'primary-content',
    overview: true,
  },
];

describe('T39 G7 Red: collection field projection closes over its declared owner', () => {
  it('publishes owner field presentation on the collection Surface for arbitrary future rels', () => {
    const sitemap = deriveSitemap([catalogOwner, unrelatedFlow]);
    const surface = sitemap.surfaces.find(({ rel }) => rel === collectionRel);

    expect(surface).toBeDefined();
    expect(surface?.app).toBe('community');
    expect(surface?.presentation?.fields).toEqual(expectedOwnerFields);
  });

  it('uses only owner-declared presentation for embedded members, excluding other Flow and runtime fields', () => {
    const memberRel = 'future-item:one';
    const snapshot: EngineSnapshot = {
      instances: {
        [memberRel]: {
          rel: memberRel,
          flow: unrelatedFlow.name,
          node: 'ready',
          fields: {
            title: { value: 'Current title', origin: 'intent' },
            summary: { value: 'Current summary', origin: 'intent' },
            secret: { value: 'must not become a column', origin: 'intent' },
            runtimeOnly: { value: 'also not a column', origin: 'intent' },
          },
        },
      },
      collections: { [collectionRel]: [memberRel] },
    };

    const entity = project(snapshot, collectionRel, {
      flows: flowRegistry(catalogOwner, unrelatedFlow),
      guards: seedGuardRegistry,
    });
    const presentation = entity?.entities?.[0]?.properties.presentation as
      { fields?: unknown[] } | undefined;

    expect(presentation?.fields).toEqual(expectedOwnerFields);
    expect(JSON.stringify(presentation)).not.toContain('secret');
    expect(JSON.stringify(presentation)).not.toContain('runtimeOnly');
  });
});
