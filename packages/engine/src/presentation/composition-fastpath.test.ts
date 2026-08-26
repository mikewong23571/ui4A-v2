import { describe, expect, it, vi } from 'vitest';

import {
  createRecipeRegistry,
  promoteRecipe,
  registerRecipeCandidate,
  type ApplicationRenderRecipeCandidate,
} from './recipe/recipe';
import { resolvePresentationFastpath } from './recipe/resolver';
import {
  applySidecarCommand,
  createPresentationSnapshot,
  dependencyDecision,
  type PresentationSnapshot,
  type SidecarDependency,
  type UserSidecarKey,
} from './sidecar';
import type { SurfaceCatalog, SurfaceTree } from './surface/index';

const catalog: SurfaceCatalog = {
  id: 'catalog:test',
  version: 'catalog-v1',
  words: {
    prose: {
      roles: ['primary-content'],
      bindings: { value: { sources: ['property'], required: true } },
    },
  },
};

const key: UserSidecarKey = {
  principal: 'user:mike',
  policyScope: 'scope:v1',
  subject: 'workspace:my-work',
  intent: 'organize',
  deviceClass: 'wide',
};

function surface(code: string): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'diagnostic',
      id: `root-${code}`,
      role: 'diagnostic',
      code,
      dependencies: [],
      provenance: [{ kind: 'generic-fallback', ref: code }],
    },
  };
}

const aggregateDependencies: SidecarDependency[] = [
  ...['inbox', 'delegations', 'threads'].flatMap((source) => [
    {
      id: `entity:${source}`,
      subtreeId: source,
      kind: 'entity-contract' as const,
      ref: source,
      pointers: ['properties', 'actions', 'links'],
      mode: 'invalidate' as const,
      fingerprint: `entity:${source}:v1`,
      optional: false,
    },
    {
      id: `members:${source}`,
      subtreeId: source,
      kind: 'collection-membership' as const,
      ref: source,
      pointers: ['$entities'],
      mode: 'rehydrate' as const,
      fingerprint: `members:${source}:v1`,
      optional: false,
    },
  ]),
  {
    id: 'definition:my-work',
    subtreeId: 'root',
    kind: 'definition',
    ref: 'composition:my-work@3',
    pointers: ['regions'],
    mode: 'invalidate',
    fingerprint: 'definition:v3',
    optional: false,
  },
  {
    id: 'catalog:semantic',
    subtreeId: 'root',
    kind: 'catalog',
    ref: catalog.id,
    pointers: ['words'],
    mode: 'invalidate',
    fingerprint: catalog.version,
    optional: false,
  },
  {
    id: 'policy:scope',
    subtreeId: 'root',
    kind: 'policy',
    ref: 'policy:presentation',
    pointers: ['scope'],
    mode: 'invalidate',
    fingerprint: 'policy:v1',
    optional: false,
  },
];

function instantiate(
  snapshot: PresentationSnapshot,
  id: string,
  retention: 'cache' | 'pinned',
  dependencies: SidecarDependency[] = aggregateDependencies,
): PresentationSnapshot {
  let next = applySidecarCommand(snapshot, {
    kind: 'instantiate',
    eventId: `event:${id}:instantiate`,
    commandId: `command:${id}:instantiate`,
    sidecarId: id,
    key,
    version: {
      surface: surface(id),
      dependencies,
      provenance: { kind: 'generic-fallback', ref: id },
      changedPaths: [],
    },
  }).snapshot;
  if (retention === 'pinned') {
    next = applySidecarCommand(next, {
      kind: 'pin',
      eventId: `event:${id}:pin`,
      commandId: `command:${id}:pin`,
      sidecarId: id,
      baseVersion: 1,
    }).snapshot;
  }
  return next;
}

function compositionRecipe(): ApplicationRenderRecipeCandidate {
  const region = (name: string, subject: string): SurfaceTree['root'] => ({
    kind: 'slot',
    id: `slot-${name}`,
    role: 'primary-content',
    name,
    dependencies: [],
    provenance: [{ kind: 'presentation-agent', ref: 'recipe:test' }],
    child: {
      kind: 'word',
      id: `word-${name}`,
      role: 'primary-content',
      word: 'prose',
      bindings: {
        value: { kind: 'property', subject, path: 'properties.fields.title' },
      },
      dependencies: [
        { kind: 'entity', subject, version: '$runtime', paths: ['properties.fields.title'] },
        { kind: 'catalog', subject: catalog.id, version: catalog.version },
      ],
      provenance: [{ kind: 'presentation-agent', ref: 'recipe:test' }],
    },
  });
  return {
    key: {
      application: 'default',
      applicationVersion: '1',
      scenario: 'my-work',
      subjectShape:
        'composition:my-work@3[waiting:collection,moving:collection,threads:collection]',
      intent: 'organize',
      catalogVersion: catalog.version,
    },
    slots: [
      { name: 'waiting', kind: 'collection' },
      { name: 'moving', kind: 'collection' },
      { name: 'threads', kind: 'collection' },
    ],
    surfaceTemplate: {
      schemaVersion: 1,
      root: {
        kind: 'layout',
        id: 'root',
        role: 'primary-content',
        layout: 'stack',
        children: [
          region('waiting', '$slot:waiting'),
          region('moving', '$slot:moving'),
          region('threads', '$slot:threads'),
        ],
        dependencies: [],
        provenance: [{ kind: 'presentation-agent', ref: 'recipe:test' }],
      },
    },
    dependencies: [
      { kind: 'definition', subject: 'composition:my-work', version: '3' },
      { kind: 'catalog', subject: catalog.id, version: catalog.version },
    ],
    provenance: { model: 'configured-model', generatedAt: '2026-08-26T00:00:00.000Z' },
  };
}

describe('composition Sidecar/Recipe fastpath', () => {
  it('uses the exact workspace key and preserves pinned before cache priority', async () => {
    let snapshot = instantiate(createPresentationSnapshot(), 'cache', 'cache');
    snapshot = instantiate(snapshot, 'pinned', 'pinned');
    const authorize = vi.fn(async () => true);
    const result = await resolvePresentationFastpath(
      {
        key: { ...key },
        dependencies: aggregateDependencies,
        presentation: snapshot,
        registry: createRecipeRegistry(),
      },
      { authorize, now: () => 1, generic: vi.fn(), plan: vi.fn() },
    );

    expect(result).toMatchObject({
      status: 'ready',
      hitPath: 'user-pinned',
      sidecar: { id: 'pinned', version: 2 },
    });
    expect(authorize).toHaveBeenCalledExactlyOnceWith(key);
  });

  it('rehydrates membership-only drift but invalidation wins for mixed region drift stably', () => {
    const membershipDrift = aggregateDependencies.map((dependency) =>
      dependency.id === 'members:threads'
        ? { ...dependency, fingerprint: 'members:threads:v2' }
        : dependency,
    );
    expect(dependencyDecision(aggregateDependencies, membershipDrift)).toMatchObject({
      valid: true,
      replanned: [],
      rehydrated: ['threads'],
    });

    const mixedDrift = membershipDrift.map((dependency) =>
      dependency.id === 'entity:threads'
        ? { ...dependency, fingerprint: 'entity:threads:v2' }
        : dependency,
    );
    const forward = dependencyDecision(aggregateDependencies, mixedDrift);
    const reverse = dependencyDecision([...aggregateDependencies].reverse(), mixedDrift);
    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({
      valid: false,
      replanned: ['threads'],
      rehydrated: [],
    });
    expect(forward.reused).not.toContain('threads');
  });

  it.each(['entity:inbox', 'definition:my-work', 'catalog:semantic', 'policy:scope'])(
    'invalidates when %s drifts and replans when a required aggregate dependency is missing',
    (id) => {
      const drifted = aggregateDependencies.map((dependency) =>
        dependency.id === id
          ? { ...dependency, fingerprint: `${dependency.fingerprint}:next` }
          : dependency,
      );
      expect(dependencyDecision(aggregateDependencies, drifted).valid).toBe(false);
      expect(
        dependencyDecision(
          aggregateDependencies,
          aggregateDependencies.filter((dependency) => dependency.id !== id),
        ).valid,
      ).toBe(false);
    },
  );

  it('filters stale workspace aggregates and applies pin/revert/evict through the shared fold', async () => {
    let snapshot = instantiate(createPresentationSnapshot(), 'workspace', 'cache');
    snapshot = applySidecarCommand(snapshot, {
      kind: 'pin',
      eventId: 'event:pin',
      commandId: 'command:pin',
      sidecarId: 'workspace',
      baseVersion: 1,
    }).snapshot;
    expect(() =>
      applySidecarCommand(snapshot, {
        kind: 'evict',
        eventId: 'event:evict',
        commandId: 'command:evict',
        sidecarId: 'workspace',
        activeVersion: 2,
      }),
    ).toThrow(/pinned/i);
    snapshot = applySidecarCommand(snapshot, {
      kind: 'stale',
      eventId: 'event:stale',
      commandId: 'command:stale',
      sidecarId: 'workspace',
      activeVersion: 2,
      dependencyIds: ['definition:my-work'],
      reason: 'definition-changed',
    }).snapshot;

    const generic = vi.fn(async () => ({
      surface: surface('generic'),
      dependencies: aggregateDependencies,
    }));
    const staleResult = await resolvePresentationFastpath(
      {
        key,
        dependencies: aggregateDependencies,
        presentation: snapshot,
        registry: createRecipeRegistry(),
      },
      { authorize: async () => true, now: () => 1, generic, plan: vi.fn() },
    );
    expect(staleResult).toMatchObject({ hitPath: 'generic' });

    snapshot = applySidecarCommand(snapshot, {
      kind: 'revert',
      eventId: 'event:revert',
      commandId: 'command:revert',
      sidecarId: 'workspace',
      activeVersion: 2,
      targetVersion: 1,
    }).snapshot;
    expect(snapshot.sidecars.workspace).toMatchObject({ activeVersion: 1, stale: undefined });
  });

  it('resolves promoted then candidate Recipes only for the exact multi-slot subject shape', async () => {
    const candidate = compositionRecipe();
    const first = registerRecipeCandidate(
      createRecipeRegistry(),
      candidate,
      catalog,
      'candidate:1',
    );
    const promoted = promoteRecipe(first.registry, first.recipe.id, 'human');
    const second = registerRecipeCandidate(promoted, candidate, catalog, 'candidate:2');
    const base = {
      key,
      dependencies: aggregateDependencies,
      presentation: createPresentationSnapshot(),
      registry: second.registry,
      recipeDependencies: candidate.dependencies,
    };
    const runtime = {
      authorize: async () => true,
      now: () => 1,
      generic: vi.fn(async () => ({
        surface: surface('generic'),
        dependencies: aggregateDependencies,
      })),
      plan: vi.fn(),
    };

    await expect(
      resolvePresentationFastpath({ ...base, recipeKey: candidate.key }, runtime),
    ).resolves.toMatchObject({
      hitPath: 'promoted-recipe',
    });
    await expect(
      resolvePresentationFastpath(
        {
          ...base,
          recipeKey: {
            ...candidate.key,
            subjectShape: candidate.key.subjectShape.replace('@3', '@4'),
          },
        },
        runtime,
      ),
    ).resolves.toMatchObject({ hitPath: 'generic' });

    const candidateOnly = { ...base, registry: first.registry };
    await expect(
      resolvePresentationFastpath({ ...candidateOnly, recipeKey: candidate.key }, runtime),
    ).resolves.toMatchObject({ hitPath: 'candidate-recipe' });
  });
});
