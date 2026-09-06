import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planGenericSurface, type SirenEntity, type UserSidecarAggregate } from '@ui4a/engine';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../authorized-entity', () => ({ getAuthorizedPresentationResult: mocks.read }));

import { PRESENTATION_SURFACE_CATALOG } from '../catalog';
import { storedResponsibilityCoverage } from './coverage';

const decision: SirenEntity = {
  class: ['opaque'],
  properties: { rel: 'review:a', presentation: { version: 1, traits: ['human-responsibility'] } },
  actions: [{ name: 'choose', title: 'Choose', method: 'POST', href: '/exec', fields: {} }],
  links: [],
};
const collection: SirenEntity = {
  class: ['collection'],
  properties: { rel: 'reviews' },
  actions: [],
  links: [],
  entities: [decision],
};
const trusted = { principal: 'alice', grantedApplications: ['some-app'] };
const declaration = {
  id: 'example',
  version: '1',
  regions: [
    { region: 'decisions', source: 'reviews', intent: 'review', mode: 'rehydrate' as const },
    { region: 'other', source: 'unavailable', intent: 'read', mode: 'rehydrate' as const },
  ],
};

function sidecar(): UserSidecarAggregate {
  return {
    id: 'sidecar:a',
    key: { principal: 'alice', subject: 'workspace:example', intent: 'read', deviceClass: 'any' },
    activeVersion: 1,
    maxVersion: 1,
    versions: {
      1: {
        version: 1,
        basedOnVersion: null,
        retention: 'cache',
        dependencies: [],
        changedPaths: [],
        provenance: { kind: 'generic-fallback', ref: 'fixture' },
        surface: planGenericSurface('reviews', collection, PRESENTATION_SURFACE_CATALOG, {
          entityVersion: '1',
          intent: 'review',
        }),
      },
    },
  };
}

beforeEach(() => {
  mocks.read.mockReset();
});

describe('stored responsibility coverage reads current authorized declared roots', () => {
  it('does not let an omitted region escape checking by deleting all stored references', async () => {
    const stored = sidecar();
    stored.versions[1]!.surface = planGenericSurface(
      'unrelated',
      {
        ...collection,
        properties: { rel: 'unrelated' },
        entities: [],
      },
      PRESENTATION_SURFACE_CATALOG,
      { entityVersion: '1', intent: 'read' },
    );
    mocks.read.mockImplementation(async (rel) =>
      rel === 'reviews'
        ? { kind: 'authorized', entity: collection }
        : { kind: 'audience-unreachable' },
    );

    await expect(
      storedResponsibilityCoverage(stored, trusted, async () => ({
        kind: 'composition',
        declaration,
      })),
    ).resolves.toBe(false);
    expect(mocks.read).toHaveBeenCalledWith('reviews', 'alice', ['some-app']);
    expect(mocks.read).toHaveBeenCalledWith('unavailable', 'alice', ['some-app']);
  });

  it('accepts covered authorized responsibility with partial unavailable roots', async () => {
    mocks.read.mockImplementation(async (rel) =>
      rel === 'reviews'
        ? { kind: 'authorized', entity: collection }
        : { kind: 'audience-unreachable' },
    );
    await expect(
      storedResponsibilityCoverage(sidecar(), trusted, async () => ({
        kind: 'composition',
        declaration,
      })),
    ).resolves.toBe(true);
  });

  it('checks the stored requested version, avoids reads across principal and fails closed on read errors', async () => {
    const stored = sidecar();
    await expect(
      storedResponsibilityCoverage(stored, { ...trusted, principal: 'bob' }),
    ).resolves.toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockRejectedValue(new Error('temporarily unavailable'));
    await expect(
      storedResponsibilityCoverage(stored, trusted, async () => ({
        kind: 'composition',
        declaration,
      })),
    ).resolves.toBe(false);
  });
});

it('checks collapsed active views and a proposed repaired view against the same fresh roots', async () => {
  const stored = sidecar();
  const active = stored.versions[1]!;
  active.view = { collapsedNodeIds: [active.surface.root.id], densityByNodeId: {} };
  mocks.read.mockResolvedValue({ kind: 'authorized', entity: collection });
  const resolve = async () => ({ kind: 'composition' as const, declaration });
  await expect(storedResponsibilityCoverage(stored, trusted, resolve)).resolves.toBe(false);
  await expect(
    storedResponsibilityCoverage(stored, trusted, resolve, {
      surface: active.surface,
      view: { collapsedNodeIds: [] },
    }),
  ).resolves.toBe(true);
  expect(active.view.collapsedNodeIds).toEqual([active.surface.root.id]);
});
