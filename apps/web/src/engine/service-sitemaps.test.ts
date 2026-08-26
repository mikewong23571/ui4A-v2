import { describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '@ui4a/shared';

import { getBuiltinComposition } from './presentation/compositions';
import { createSitemapReaders } from './service-sitemaps';

describe('business sitemap principal surfaces', () => {
  it('declares threads as an Application-neutral principal collection', () => {
    const snapshot: EngineSnapshot = { instances: {}, collections: {}, threads: {} };
    const readers = createSitemapReaders(
      () => snapshot,
      () => [],
    );

    expect(readers.currentSitemap().surfaces).toContainEqual({
      rel: 'threads',
      title: 'Work Threads',
      collection: true,
      scope: 'principal',
      memberRelPrefix: 'thread:',
    });
  });

  it('makes every my-work composition source a principal business surface', () => {
    const snapshot: EngineSnapshot = { instances: {}, collections: {}, threads: {} };
    const readers = createSitemapReaders(
      () => snapshot,
      () => [],
    );
    const declaration = getBuiltinComposition('my-work');

    expect(declaration).toBeDefined();
    const surfaces = new Map(
      readers.currentSitemap().surfaces.map((surface) => [surface.rel, surface]),
    );
    const sourceSurfaces = declaration?.regions.map((region) => surfaces.get(region.source));

    expect(sourceSurfaces).toHaveLength(3);
    expect(sourceSurfaces).not.toContain(undefined);
    expect(sourceSurfaces?.map((surface) => surface?.scope)).toEqual([
      'principal',
      'principal',
      'principal',
    ]);
  });
});
