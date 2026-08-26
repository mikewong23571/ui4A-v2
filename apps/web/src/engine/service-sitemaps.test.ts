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

  it('makes every my-work composition source discoverable through the business sitemap', () => {
    const snapshot: EngineSnapshot = { instances: {}, collections: {}, threads: {} };
    const readers = createSitemapReaders(
      () => snapshot,
      () => [],
    );
    const declaration = getBuiltinComposition('my-work');

    expect(declaration).toBeDefined();
    const sitemapRels = new Set(readers.currentSitemap().surfaces.map((surface) => surface.rel));
    const missingSources =
      declaration?.regions
        .map((region) => region.source)
        .filter((source) => !sitemapRels.has(source)) ?? [];

    expect(missingSources).toEqual([]);
  });
});
