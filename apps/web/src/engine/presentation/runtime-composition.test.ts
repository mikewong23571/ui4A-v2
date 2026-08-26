import { beforeEach, describe, expect, it } from 'vitest';

import { GENERIC_INTENT_POLICY_VERSION, type SirenEntity, type SurfaceNode } from '@ui4a/engine';

import { resetRecipeCoordinatorForTests } from './recipes-runtime';
import { planWorkspaceComposition } from './runtime-composition';

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
      policyScope: 'publishing',
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
