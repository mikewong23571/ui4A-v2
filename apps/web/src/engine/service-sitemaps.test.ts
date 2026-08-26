import { describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '@ui4a/shared';

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
});
