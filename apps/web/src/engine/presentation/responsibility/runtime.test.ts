import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planGenericSurface, type SirenEntity, type SurfaceTree } from '@ui4a/engine';
import { completePresentationRequest } from '@ui4a/shared';

const mocks = vi.hoisted(() => ({
  createBroker: vi.fn<(dependencies: unknown) => { present: ReturnType<typeof vi.fn> }>(() => ({
    present: vi.fn(),
  })),
  active: vi.fn(),
  append: vi.fn(),
  recipe: vi.fn(),
}));
vi.mock('../broker', () => ({ createWebPresentationBroker: mocks.createBroker }));
vi.mock('../../service', () => ({ getDb: () => ({}) }));
vi.mock('@ui4a/db/events', () => ({ listEvents: async () => [], appendEvent: vi.fn() }));
vi.mock('@ui4a/db/presentation', () => ({
  findActiveSidecar: mocks.active,
  appendSidecarCommand: mocks.append,
  loadPresentationSnapshot: async () => ({ sidecars: {} }),
}));
vi.mock('../recipe-selection', () => ({ selectAndInstantiateRecipe: mocks.recipe }));
vi.mock('../recipes-runtime', () => ({
  currentRecipeCoordinator: () => ({ registry: () => ({ recipes: {} }) }),
}));

import { getPresentationBroker, resetPresentationBrokerForTests } from '../runtime';
import { planWorkspaceComposition } from '../runtime-composition';
import { PRESENTATION_SURFACE_CATALOG } from '../catalog';
import { hasResponsibilityCoverage } from './coverage';

const decision: SirenEntity = {
  class: ['opaque'],
  properties: { rel: 'decision:a', presentation: { version: 1, traits: ['human-responsibility'] } },
  actions: [{ name: 'choose', title: 'Choose', method: 'POST', href: '/exec', fields: {} }],
  links: [],
};
const entity: SirenEntity = {
  class: ['collection', 'reviews'],
  properties: { rel: 'reviews' },
  actions: [],
  links: [],
  entities: [decision],
};
const situation = { rels: ['reviews'], entities: [entity] };
const request = completePresentationRequest(
  { subject: 'reviews', intent: 'read', delivery: 'canvas' },
  {
    requestId: 'request:a',
    principal: 'alice',
    sourceMessageIds: [],
  },
);
const omitted = () =>
  planGenericSurface(
    'reviews',
    {
      class: entity.class,
      properties: entity.properties,
      actions: [],
      links: [],
    },
    PRESENTATION_SURFACE_CATALOG,
    { entityVersion: '1', intent: 'read' },
  );

type RuntimeHooks = {
  resolve: (request: unknown, root: unknown) => Promise<{ kind: string }>;
  plan: (request: unknown, root: unknown) => Promise<{ kind: string }>;
};

function hooks(): RuntimeHooks {
  getPresentationBroker();
  return mocks.createBroker.mock.calls[0]![0] as RuntimeHooks;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPresentationBrokerForTests();
  mocks.active.mockResolvedValue(undefined);
  mocks.recipe.mockReturnValue(undefined);
  mocks.append.mockResolvedValue({ aggregate: { activeVersion: 1 } });
});

describe('production responsibility reuse boundaries', () => {
  it('rejects an incomplete Recipe hit and persists the generic plan through the existing path', async () => {
    mocks.recipe.mockReturnValue({ recipe: { id: 'recipe:a', version: 1 }, surface: omitted() });
    const runtime = hooks();
    await expect(runtime.resolve(request, situation)).resolves.toEqual({ kind: 'miss' });
    expect(mocks.append).not.toHaveBeenCalled();
    await expect(runtime.plan(request, situation)).resolves.toMatchObject({ kind: 'ready' });
    const command = mocks.append.mock.calls[0]![1] as { version: { surface: SurfaceTree } };
    expect(hasResponsibilityCoverage(command.version.surface, situation)).toBe(true);
  });

  it('stales an incomplete stored Sidecar before any cached response is served', async () => {
    mocks.active.mockResolvedValue({
      id: 'sidecar:a',
      activeVersion: 2,
      versions: {
        2: { surface: omitted(), dependencies: [] },
      },
    });
    await expect(hooks().resolve(request, situation)).resolves.toEqual({ kind: 'miss' });
    expect(mocks.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'stale',
        sidecarId: 'sidecar:a',
        activeVersion: 2,
      }),
    );
  });

  it('drops an incomplete per-region Recipe and retains responsibility in the composed generic Surface', () => {
    mocks.recipe.mockReturnValue({ recipe: { id: 'recipe:a' }, surface: omitted() });
    const region = {
      region: 'work',
      source: 'reviews',
      intent: 'read',
      mode: 'rehydrate' as const,
    };
    const planned = planWorkspaceComposition({
      ...situation,
      declaration: { id: 'example', version: '1', regions: [region] },
      regions: [{ declaration: region, entity }],
    });
    expect(hasResponsibilityCoverage(planned.surface, situation)).toBe(true);
  });
});

it('invalidates a previously usable collapsed Sidecar when fresh responsibility must be shown', async () => {
  const runtime = hooks();
  await runtime.plan(request, situation);
  const command = mocks.append.mock.calls[0]![1] as {
    version: { surface: SurfaceTree; dependencies: unknown[] };
  };
  mocks.append.mockClear();
  mocks.active.mockResolvedValue({
    id: 'sidecar:a',
    activeVersion: 1,
    versions: {
      1: {
        ...command.version,
        view: { collapsedNodeIds: [command.version.surface.root.id], densityByNodeId: {} },
      },
    },
  });
  await expect(runtime.resolve(request, situation)).resolves.toEqual({ kind: 'miss' });
  expect(mocks.append).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ kind: 'stale', sidecarId: 'sidecar:a' }),
  );
});
