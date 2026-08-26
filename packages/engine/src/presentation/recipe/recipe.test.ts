import { describe, expect, it } from 'vitest';

import type { SurfaceCatalog, SurfaceTree } from '../surface/index';
import {
  createRecipeRegistry,
  deterministicRecipeKey,
  instantiateRecipeSurface,
  promoteRecipe,
  registerRecipeCandidate,
  resolveRecipe,
  rollbackRecipePromotion,
  staleRecipesByDependencies,
  validateRecipeCandidate,
  type ApplicationRenderRecipeCandidate,
} from './recipe';

const catalog: SurfaceCatalog = {
  id: 'catalog:ui4a',
  version: 'cat-v1',
  words: {
    prose: {
      roles: ['identity', 'primary-content'],
      bindings: { value: { sources: ['property'], required: true } },
    },
  },
};

function surface(subject = '$slot:subject'): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'word',
      id: 'identity',
      role: 'identity',
      word: 'prose',
      bindings: { value: { kind: 'property', subject, path: 'properties.fields.title' } },
      dependencies: [
        { kind: 'entity', subject, version: '$runtime', paths: ['properties.fields.title'] },
        { kind: 'catalog', subject: catalog.id, version: catalog.version },
      ],
      provenance: [{ kind: 'presentation-agent', ref: 'generation:1', model: 'configured-model' }],
    },
  };
}

function candidate(): ApplicationRenderRecipeCandidate {
  return {
    key: {
      application: 'publishing',
      applicationVersion: '1',
      scenario: 'entity-inspect',
      subjectShape: 'flow-instance',
      intent: 'inspect',
      catalogVersion: catalog.version,
    },
    slots: [{ name: 'subject', kind: 'entity' }],
    surfaceTemplate: surface(),
    dependencies: [
      { kind: 'definition', subject: 'flow:post-status', version: '1' },
      { kind: 'catalog', subject: catalog.id, version: catalog.version },
    ],
    provenance: { model: 'configured-model', generatedAt: '2026-08-23T00:00:00.000Z' },
  };
}

function compositionCandidate(): ApplicationRenderRecipeCandidate {
  const next = candidate();
  next.key.subjectShape = 'composition:my-work@3[waiting:collection,moving:entity]';
  next.slots = [
    { name: 'waiting', kind: 'collection' },
    { name: 'moving', kind: 'entity' },
  ];
  next.surfaceTemplate = {
    schemaVersion: 1,
    root: {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      dependencies: [],
      provenance: [{ kind: 'presentation-agent', ref: 'composition:fixture' }],
      children: [
        { ...surface('$slot:waiting').root, id: 'waiting' },
        { ...surface('$slot:moving').root, id: 'moving' },
      ],
    },
  };
  return next;
}

describe('Application Recipe validation and registry', () => {
  it('accepts a parameterized binding-only candidate and gives it a deterministic key', () => {
    const next = candidate();
    expect(validateRecipeCandidate(next, catalog)).toEqual({ valid: true, errors: [] });
    expect(deterministicRecipeKey(next.key)).toBe(deterministicRecipeKey({ ...next.key }));
  });

  it.each([
    ['principal', 'user:secret'],
    ['sessionId', 'session:secret'],
    ['liveValue', 'private body'],
  ])('rejects forbidden or factual candidate payload %s', (key, value) => {
    const next = candidate() as unknown as Record<string, unknown>;
    next[key] = value;
    expect(validateRecipeCandidate(next, catalog)).toMatchObject({ valid: false });
  });

  it('rejects unbound subjects and unknown catalog words', () => {
    const unbound = candidate();
    unbound.surfaceTemplate = surface('post:live-value');
    expect(validateRecipeCandidate(unbound, catalog)).toMatchObject({ valid: false });

    const unknown = candidate();
    if (unknown.surfaceTemplate.root.kind !== 'word') throw new Error('fixture');
    unknown.surfaceTemplate.root.word = 'not-registered';
    expect(validateRecipeCandidate(unknown, catalog)).toMatchObject({ valid: false });
  });

  it('deduplicates generation commands and preserves immutable candidate versions', () => {
    const initial = createRecipeRegistry();
    const first = registerRecipeCandidate(initial, candidate(), catalog, 'generate:1');
    const retried = registerRecipeCandidate(first.registry, candidate(), catalog, 'generate:1');
    const second = registerRecipeCandidate(first.registry, candidate(), catalog, 'generate:2');

    expect(retried.recipe).toEqual(first.recipe);
    expect(second.recipe.version).toBe(2);
    expect(first.recipe.version).toBe(1);
    expect(first.registry.recipes[first.recipe.id]).toEqual(first.recipe);
  });

  it('requires human promotion, prefers promoted over candidate, and rolls back by pointer', () => {
    const first = registerRecipeCandidate(createRecipeRegistry(), candidate(), catalog, 'g:1');
    expect(() => promoteRecipe(first.registry, first.recipe.id, 'agent')).toThrow(/human/i);
    const promoted1 = promoteRecipe(first.registry, first.recipe.id, 'human');
    expect(resolveRecipe(promoted1, first.recipe.key, candidate().dependencies)?.status).toBe(
      'promoted',
    );

    const second = registerRecipeCandidate(promoted1, candidate(), catalog, 'g:2');
    const promoted2 = promoteRecipe(second.registry, second.recipe.id, 'human');
    const rolledBack = rollbackRecipePromotion(
      promoted2,
      second.recipe.key,
      first.recipe.version,
      'human',
    );
    expect(resolveRecipe(rolledBack, first.recipe.key, candidate().dependencies)?.version).toBe(1);
    expect(promoted2.recipes[second.recipe.id]?.status).toBe('promoted');
  });

  it('keeps compatible old recipes serving and immediately stops incompatible dependencies', () => {
    const registered = registerRecipeCandidate(createRecipeRegistry(), candidate(), catalog, 'g:1');
    const promoted = promoteRecipe(registered.registry, registered.recipe.id, 'human');
    expect(resolveRecipe(promoted, registered.recipe.key, candidate().dependencies)).toBeDefined();

    const changed = staleRecipesByDependencies(promoted, [
      { kind: 'definition', subject: 'flow:post-status', version: '2', compatible: false },
    ]);
    expect(resolveRecipe(changed, registered.recipe.key, candidate().dependencies)).toBeUndefined();
    expect(changed.recipes[registered.recipe.id]?.status).toBe('stale');

    const compatible = staleRecipesByDependencies(promoted, [
      { kind: 'definition', subject: 'flow:post-status', version: '2', compatible: true },
    ]);
    expect(
      resolveRecipe(compatible, registered.recipe.key, candidate().dependencies),
    ).toBeDefined();
  });

  it('instantiates declared subject slots without copying factual values into the Recipe', () => {
    const registered = registerRecipeCandidate(createRecipeRegistry(), candidate(), catalog, 'g:1');
    const instantiated = instantiateRecipeSurface(registered.recipe, [
      { name: 'subject', kind: 'entity', subject: 'post:first-post' },
    ]);
    expect(instantiated.root).toMatchObject({
      kind: 'word',
      bindings: { value: { subject: 'post:first-post' } },
      dependencies: expect.arrayContaining([
        expect.objectContaining({ subject: 'post:first-post' }),
      ]),
    });
    expect(JSON.stringify(instantiated)).not.toContain('private body');
    expect(() =>
      instantiateRecipeSurface(registered.recipe, [
        { name: 'subject', kind: 'entity', subject: 'post:first-post' },
        { name: 'extra', kind: 'entity', subject: 'x' },
      ]),
    ).toThrow(/shape/i);
  });

  it('registers and instantiates a complete ordered multi-slot composition shape', () => {
    const next = compositionCandidate();
    const registered = registerRecipeCandidate(createRecipeRegistry(), next, catalog, 'multi:1');
    const instantiated = instantiateRecipeSurface(registered.recipe, [
      { name: 'waiting', kind: 'collection', subject: 'inbox' },
      { name: 'moving', kind: 'entity', subject: 'delegations' },
    ]);

    expect(JSON.stringify(instantiated)).not.toContain('$slot:');
    expect(JSON.stringify(instantiated)).toContain('inbox');
    expect(JSON.stringify(instantiated)).toContain('delegations');
  });

  it.each([
    [
      'wrong order',
      [
        { name: 'moving', kind: 'entity' as const, subject: 'delegations' },
        { name: 'waiting', kind: 'collection' as const, subject: 'inbox' },
      ],
    ],
    [
      'wrong kind',
      [
        { name: 'waiting', kind: 'entity' as const, subject: 'inbox' },
        { name: 'moving', kind: 'entity' as const, subject: 'delegations' },
      ],
    ],
  ])('rejects instantiation with %s', (_label, slots) => {
    const registered = registerRecipeCandidate(
      createRecipeRegistry(),
      compositionCandidate(),
      catalog,
      'multi:shape',
    );
    expect(() => instantiateRecipeSurface(registered.recipe, slots)).toThrow(/shape/i);
  });

  it('rejects candidates whose declared slots are incomplete or out of template order', () => {
    const missing = compositionCandidate();
    missing.slots = [{ name: 'waiting', kind: 'collection' }];
    expect(validateRecipeCandidate(missing, catalog)).toMatchObject({ valid: false });

    const reversed = compositionCandidate();
    reversed.slots = [...reversed.slots].reverse();
    expect(validateRecipeCandidate(reversed, catalog)).toMatchObject({ valid: false });
  });
});
