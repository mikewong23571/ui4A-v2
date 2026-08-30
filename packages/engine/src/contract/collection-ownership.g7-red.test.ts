import { describe, expect, it } from 'vitest';

import type { FlowDefinition } from '../core/types';
import { deriveSitemap } from './sitemap';

function ownerFlow(input: {
  name: string;
  app: string;
  collection?: string;
  append?: string;
}): FlowDefinition {
  return {
    name: input.name,
    title: input.name,
    app: input.app,
    initial: 'ready',
    ...(input.collection === undefined
      ? {}
      : { collections: [{ collection: input.collection }] }),
    nodes: [
      {
        name: 'ready',
        actions:
          input.append === undefined
            ? []
            : [
                {
                  name: 'publish',
                  title: 'Publish',
                  effect: {
                    type: 'append',
                    collection: input.append,
                    flow: input.name,
                    initial: 'ready',
                  },
                },
              ],
      },
    ],
  };
}

function collectionSurface(flows: readonly FlowDefinition[], rel: string) {
  return deriveSitemap(flows, {
    extraSurfaces: [{ rel, title: 'Future queue', collection: true, pageable: true }],
  }).surfaces.filter((surface) => surface.rel === rel);
}

describe('T39 G7 Red: collection ownership is declaration-first and fail closed', () => {
  it('uses the explicit Flow.collections owner while extraSurfaces only enriches discovery data', () => {
    const rel = 'future-review-7f3';
    const surfaces = collectionSurface(
      [ownerFlow({ name: 'future-review', app: 'community', collection: rel })],
      rel,
    );

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]).toMatchObject({
      rel,
      title: 'Future queue',
      collection: true,
      pageable: true,
      app: 'community',
    });
  });

  it('does not let an extraSurface override a provable declaration owner', () => {
    const rel = 'future-review-override-7f3';
    const sitemap = deriveSitemap(
      [ownerFlow({ name: 'future-review', app: 'community', collection: rel })],
      {
        extraSurfaces: [
          {
            rel,
            title: 'Future queue',
            collection: true,
            pageable: true,
            app: 'publishing',
          },
        ],
      },
    );

    expect(sitemap.surfaces.filter((surface) => surface.rel === rel)).toEqual([
      expect.objectContaining({ rel, app: 'community' }),
    ]);
  });

  it('keeps an extra-only collection Application-neutral when no owner can be proven', () => {
    const rel = 'future-orphan-7f3';
    const [surface] = collectionSurface([], rel);

    expect(surface).toBeDefined();
    expect(surface).not.toHaveProperty('app');
  });

  it('uses append ownership only when no Flow.collections declaration exists', () => {
    const rel = 'future-produced-7f3';
    const sitemap = deriveSitemap([
      ownerFlow({ name: 'future-producer', app: 'publishing', append: rel }),
    ]);

    expect(sitemap.surfaces.filter((surface) => surface.rel === rel)).toEqual([
      expect.objectContaining({ rel, collection: true, pageable: true, app: 'publishing' }),
    ]);
  });

  it('rejects multiple explicit owners with every Application and Flow in the error', () => {
    const rel = 'future-conflict-7f3';
    const derive = () =>
      deriveSitemap([
        ownerFlow({ name: 'community-review', app: 'community', collection: rel }),
        ownerFlow({ name: 'governance-review', app: 'governance', collection: rel }),
      ]);

    expect(derive).toThrow(/future-conflict-7f3/);
    expect(derive).toThrow(/community-review/);
    expect(derive).toThrow(/community/);
    expect(derive).toThrow(/governance-review/);
    expect(derive).toThrow(/governance/);
  });

  it('rejects an append owner that conflicts with the explicit declaration owner', () => {
    const rel = 'future-append-conflict-7f3';
    const derive = () =>
      deriveSitemap([
        ownerFlow({ name: 'community-review', app: 'community', collection: rel }),
        ownerFlow({ name: 'publishing-producer', app: 'publishing', append: rel }),
      ]);

    expect(derive).toThrow(/future-append-conflict-7f3/);
    expect(derive).toThrow(/community-review/);
    expect(derive).toThrow(/publishing-producer/);
    expect(derive).toThrow(/community/);
    expect(derive).toThrow(/publishing/);
  });

  it('includes exact collection ownership declarations in the sitemap content fingerprint', () => {
    const baseline = ownerFlow({
      name: 'future-review',
      app: 'community',
      collection: 'future-review-a-7f3',
    });
    const changed: FlowDefinition = {
      ...baseline,
      collections: [{ collection: 'future-review-b-7f3' }],
    };

    expect(deriveSitemap([changed]).version).not.toBe(deriveSitemap([baseline]).version);
  });
});
