import { describe, expect, it } from 'vitest';

import type { ApplicationRenderRecipe } from '@ui4a/engine';

import { selectAndInstantiateRecipe } from './recipe-selection';

function recipe(
  slots: ApplicationRenderRecipe['slots'],
  subjectShape = 'composition:my-work@3[waiting:collection,moving:entity]',
): ApplicationRenderRecipe {
  return {
    id: 'recipe:test@1',
    version: 1,
    status: 'promoted',
    key: {
      application: 'default',
      applicationVersion: '1',
      scenario: 'my-work',
      subjectShape,
      intent: 'organize',
      catalogVersion: 'semantic-v1',
    },
    slots,
    surfaceTemplate: {
      schemaVersion: 1,
      root: {
        kind: 'layout',
        id: 'root',
        role: 'primary-content',
        layout: 'stack',
        dependencies: [],
        provenance: [],
        children: slots.map((slot) => ({
          kind: 'word' as const,
          id: slot.name,
          role: 'primary-content' as const,
          word: 'prose',
          bindings: {
            value: {
              kind: 'property' as const,
              subject: `$slot:${slot.name}`,
              path: 'properties.rel',
            },
          },
          dependencies: [],
          provenance: [],
        })),
      },
    },
    dependencies: [],
    provenance: { model: 'fixture', generatedAt: 'fixture' },
  };
}

describe('runtime Recipe selection', () => {
  const expected = [
    { name: 'waiting', kind: 'collection' as const, subject: 'inbox' },
    { name: 'moving', kind: 'entity' as const, subject: 'delegations' },
  ];

  it('selects and instantiates an exact ordered multi-slot shape', () => {
    const result = selectAndInstantiateRecipe(
      [
        recipe([{ name: 'waiting', kind: 'entity' }]),
        recipe([
          { name: 'waiting', kind: 'collection' },
          { name: 'moving', kind: 'entity' },
        ]),
      ],
      {
        subjectShape: 'composition:my-work@3[waiting:collection,moving:entity]',
        intent: 'organize',
        catalogVersion: 'semantic-v1',
        slots: expected,
      },
    );

    expect(result?.recipe.slots).toEqual(expected.map(({ name, kind }) => ({ name, kind })));
    expect(JSON.stringify(result?.surface)).not.toContain('$slot:');
  });

  it.each([
    [
      'wrong order',
      [
        { name: 'moving', kind: 'entity' as const },
        { name: 'waiting', kind: 'collection' as const },
      ],
    ],
    [
      'wrong kind',
      [
        { name: 'waiting', kind: 'entity' as const },
        { name: 'moving', kind: 'entity' as const },
      ],
    ],
  ])('does not select a Recipe with %s', (_label, slots) => {
    expect(
      selectAndInstantiateRecipe([recipe(slots)], {
        intent: 'organize',
        subjectShape: 'composition:my-work@3[waiting:collection,moving:entity]',
        catalogVersion: 'semantic-v1',
        slots: expected,
      }),
    ).toBeUndefined();
  });

  it('does not select the same slot shape from a different composition shape version', () => {
    expect(
      selectAndInstantiateRecipe(
        [
          recipe(
            expected.map(({ name, kind }) => ({ name, kind })),
            'composition:my-work@2[waiting:collection,moving:entity]',
          ),
        ],
        {
          subjectShape: 'composition:my-work@3[waiting:collection,moving:entity]',
          intent: 'organize',
          catalogVersion: 'semantic-v1',
          slots: expected,
        },
      ),
    ).toBeUndefined();
  });
});
