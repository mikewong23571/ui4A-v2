import { describe, expect, it, vi } from 'vitest';

import { createRecipeRegistry, registerRecipeCandidate } from './recipe';
import {
  applySidecarCommand,
  createPresentationSnapshot,
  type SidecarDependency,
  type UserSidecarKey,
} from '../sidecar';
import type { SurfaceCatalog, SurfaceTree } from '../surface/index';
import { resolvePresentationFastpath } from './resolver';

const catalog: SurfaceCatalog = {
  id: 'catalog:test',
  version: 'v1',
  words: {},
};
const surface: SurfaceTree = {
  schemaVersion: 1,
  root: {
    kind: 'diagnostic',
    id: 'root',
    role: 'diagnostic',
    code: 'fixture',
    dependencies: [],
    provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
  },
};
const key: UserSidecarKey = {
  principal: 'user:mike',
  policyScope: 'scope:v1',
  subject: 'post:first',
  intent: 'read',
  deviceClass: 'wide',
};
const dependencies: SidecarDependency[] = [
  {
    id: 'entity',
    subtreeId: 'content',
    kind: 'entity-contract',
    ref: 'post:first',
    pointers: ['properties.fields.body'],
    mode: 'invalidate',
    fingerprint: 'v1',
    optional: false,
  },
];

function snapshot(retention: 'cache' | 'pinned') {
  let result = applySidecarCommand(createPresentationSnapshot(), {
    kind: 'instantiate',
    eventId: 'e1',
    commandId: 'c1',
    sidecarId: 'sidecar:1',
    key,
    version: {
      surface,
      dependencies,
      provenance: { kind: 'generic-fallback', ref: 'fixture' },
      changedPaths: [],
    },
  }).snapshot;
  if (retention === 'pinned') {
    result = applySidecarCommand(result, {
      kind: 'pin',
      eventId: 'e2',
      commandId: 'c2',
      sidecarId: 'sidecar:1',
      baseVersion: 1,
    }).snapshot;
  }
  return result;
}

describe('Presentation fastpath resolver', () => {
  it('returns an exact user pinned/cache hit with zero LLM calls under 500ms', async () => {
    let time = 100;
    const result = await resolvePresentationFastpath(
      { key, dependencies, presentation: snapshot('pinned'), registry: createRecipeRegistry() },
      {
        authorize: async () => true,
        now: () => (time += 10),
        generic: vi.fn(),
        plan: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      status: 'ready',
      hitPath: 'user-pinned',
      sidecar: { id: 'sidecar:1', version: 2 },
      chatLlmCalls: 0,
      presentationLlmCalls: 0,
      firstUsableMs: 10,
      dependency: { valid: true },
    });
  });

  it('uses promoted/candidate Recipe before generic and instantiates one user cache', async () => {
    const recipeCandidate = {
      key: {
        application: 'publishing',
        applicationVersion: '1',
        scenario: 'inspect',
        subjectShape: 'entity',
        intent: 'read',
        catalogVersion: catalog.version,
      },
      slots: [{ name: 'subject', kind: 'entity' as const }],
      surfaceTemplate: surface,
      dependencies: [{ kind: 'catalog' as const, subject: catalog.id, version: catalog.version }],
      provenance: { model: 'model', generatedAt: 'now' },
    };
    const registered = registerRecipeCandidate(
      createRecipeRegistry(),
      recipeCandidate,
      catalog,
      'g1',
    );
    const instantiate = vi.fn(async () => ({
      id: 'sidecar:recipe',
      version: 1,
    }));
    const result = await resolvePresentationFastpath(
      {
        key,
        dependencies,
        presentation: createPresentationSnapshot(),
        registry: registered.registry,
        recipeKey: recipeCandidate.key,
        recipeDependencies: recipeCandidate.dependencies,
      },
      {
        authorize: async () => true,
        now: () => 1,
        instantiateRecipe: instantiate,
        generic: vi.fn(),
        plan: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      hitPath: 'candidate-recipe',
      presentationLlmCalls: 0,
      sidecar: { id: 'sidecar:recipe', version: 1 },
    });
    expect(instantiate).toHaveBeenCalledTimes(1);
  });

  it('uses generic without LLM and honestly fails when only new planning is unavailable', async () => {
    const generic = vi.fn(async () => ({ surface, dependencies }));
    const genericResult = await resolvePresentationFastpath(
      {
        key,
        dependencies,
        presentation: createPresentationSnapshot(),
        registry: createRecipeRegistry(),
      },
      { authorize: async () => true, now: () => 1, generic, plan: vi.fn() },
    );
    expect(genericResult).toMatchObject({ hitPath: 'generic', presentationLlmCalls: 0 });

    const failed = await resolvePresentationFastpath(
      {
        key,
        dependencies,
        presentation: createPresentationSnapshot(),
        registry: createRecipeRegistry(),
      },
      {
        authorize: async () => true,
        now: () => 1,
        generic: async () => undefined,
        plan: async () => {
          throw new Error('offline');
        },
      },
    );
    expect(failed).toMatchObject({
      status: 'failed',
      hitPath: 'planner',
      presentationLlmCalls: 1,
      reasonCode: 'planning-failed',
    });
  });

  it('never reuses an incompatible user Sidecar and reports replanned subtree ids', async () => {
    const plan = vi.fn(async () => ({ surface, dependencies }));
    const result = await resolvePresentationFastpath(
      {
        key,
        dependencies: [{ ...dependencies[0]!, fingerprint: 'v2' }],
        presentation: snapshot('cache'),
        registry: createRecipeRegistry(),
      },
      { authorize: async () => true, now: () => 1, generic: async () => undefined, plan },
    );
    expect(result).toMatchObject({
      hitPath: 'planner',
      dependency: { valid: false, replanned: ['content'] },
      presentationLlmCalls: 1,
    });
    expect(plan).toHaveBeenCalledTimes(1);
  });
});
