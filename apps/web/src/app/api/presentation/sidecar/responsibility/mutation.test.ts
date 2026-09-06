import { beforeEach, expect, it, vi } from 'vitest';
import { planGenericSurface, type SirenEntity, type UserSidecarAggregate } from '@ui4a/engine';
import { PRESENTATION_SURFACE_CATALOG } from '../../../../../engine/presentation/catalog';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  append: vi.fn(),
  event: vi.fn(),
  entity: vi.fn(),
}));
vi.mock('@ui4a/db/presentation', () => ({
  getSidecarById: mocks.read,
  appendSidecarCommand: mocks.append,
}));
vi.mock('@ui4a/db/events', () => ({ appendEvent: mocks.event }));
vi.mock('../../../../../engine/service', () => ({ getDb: () => ({}) }));
vi.mock('../../../../../auth/request-identity', () => ({ requestIdentityProfile: () => 'local' }));
vi.mock('../../../../../engine/presentation/sidecar-authorization', () => ({
  authorizeStoredSidecar: async () => ({ ok: true }),
  hasUnavailableRegion: () => false,
}));
vi.mock('../../../../../engine/presentation/authorized-entity', () => ({
  getAuthorizedPresentationResult: mocks.entity,
  getAuthorizedPresentationEntity: async () => undefined,
}));
import { GET, POST } from '../route';

const queue: SirenEntity = {
  class: ['collection'],
  properties: { rel: 'queue' },
  actions: [],
  links: [],
  entities: [
    {
      class: [],
      properties: {
        rel: 'decision:a',
        identity: 'A decision',
        presentation: { version: 1, traits: ['human-responsibility'] },
      },
      actions: [
        {
          name: 'choose',
          title: 'Choose',
          method: 'POST',
          href: '/api/exec',
          fields: { type: 'object', properties: {} },
        },
      ],
      links: [],
    },
  ],
};
let sidecar: UserSidecarAggregate;
beforeEach(() => {
  vi.clearAllMocks();
  sidecar = {
    id: 'sidecar:a',
    key: { principal: 'local-user', subject: 'queue', intent: 'read', deviceClass: 'any' },
    activeVersion: 1,
    maxVersion: 1,
    versions: {
      1: {
        version: 1,
        basedOnVersion: null,
        retention: 'cache',
        dependencies: [],
        changedPaths: [],
        provenance: { kind: 'generic-fallback', ref: 'test' },
        surface: planGenericSurface('queue', queue, PRESENTATION_SURFACE_CATALOG, {
          entityVersion: '1',
          intent: 'read',
        }),
      },
    },
  };
  mocks.read.mockImplementation(async () => sidecar);
  mocks.entity.mockResolvedValue({ kind: 'authorized', entity: queue });
  mocks.append.mockImplementation(async (_db, command) => {
    sidecar = {
      ...sidecar,
      activeVersion: 2,
      maxVersion: 2,
      versions: {
        ...sidecar.versions,
        2: { ...sidecar.versions[1], ...command.version, version: 2 },
      },
    };
    return { aggregate: sidecar };
  });
});
const post = (action: string, extra: Record<string, unknown> = {}) =>
  POST(
    new Request('http://localhost/api/presentation/sidecar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sidecarId: 'sidecar:a', actor: 'human', action, ...extra }),
    }),
  );

it('rejects collapsing the responsibility root before appending, but accepts a visible density change', async () => {
  const root = sidecar.versions[1]!.surface.root.id;
  const before = JSON.stringify(sidecar);
  const hidden = await post('patch', {
    interactionId: 'hide',
    operations: [{ kind: 'collapse', nodeId: root, collapsed: true }],
  });
  expect(hidden.status).toBe(409);
  expect(await hidden.json()).toMatchObject({
    error: { code: 'presentation-responsibility-stale' },
  });
  expect(mocks.append).not.toHaveBeenCalled();
  expect(JSON.stringify(sidecar)).toBe(before);
  const compact = await post('patch', {
    interactionId: 'compact',
    operations: [{ kind: 'density', nodeId: root, density: 'compact' }],
  });
  expect(compact.status).toBe(200);
  expect(mocks.append).toHaveBeenCalledTimes(1);
});
it('allows collapse when fresh authorized source has no duties', async () => {
  mocks.entity.mockResolvedValue({ kind: 'authorized', entity: { ...queue, entities: [] } });
  const response = await post('patch', {
    interactionId: 'hide-empty',
    operations: [
      { kind: 'collapse', nodeId: sidecar.versions[1]!.surface.root.id, collapsed: true },
    ],
  });
  expect(response.status).toBe(200);
  expect(mocks.append).toHaveBeenCalledTimes(1);
});
it('rejects a cached hidden duty on GET and allows a patch that restores it', async () => {
  const root = sidecar.versions[1]!.surface.root.id;
  sidecar.versions[1]!.view = { collapsedNodeIds: [root], densityByNodeId: {} };
  expect(
    (await GET(new Request('http://localhost/api/presentation/sidecar?sidecarId=sidecar:a')))
      .status,
  ).toBe(409);
  const restore = await post('patch', {
    interactionId: 'show',
    operations: [{ kind: 'collapse', nodeId: root, collapsed: false }],
  });
  expect(restore.status).toBe(200);
});
it.each(['promotion-preview', 'promote', 'pin'])(
  'rejects %s of an active view hiding responsibility',
  async (action) => {
    sidecar.versions[1]!.view = {
      collapsedNodeIds: [sidecar.versions[1]!.surface.root.id],
      densityByNodeId: {},
    };
    const response = await post(action);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'presentation-responsibility-stale' },
    });
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
  },
);
it('checks the revert target view rather than the currently visible version', async () => {
  const original = sidecar.versions[1]!;
  sidecar.versions[2] = {
    ...original,
    version: 2,
    basedOnVersion: 1,
    view: { collapsedNodeIds: [original.surface.root.id], densityByNodeId: {} },
  };
  sidecar.maxVersion = 2;
  const response = await post('revert', { targetVersion: 2 });
  expect(response.status).toBe(409);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(sidecar.activeVersion).toBe(1);
});
