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

    // T38:collection 维持集合类视图语义;pageable 与合同分页判定同源——
    // threads 是平台视图(无成员表/无 append),collection 在案但不可分页。
    expect(readers.currentSitemap().surfaces).toContainEqual({
      rel: 'threads',
      title: 'Work Threads',
      collection: true,
      pageable: false,
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

describe('Meta sitemap cognitive contract', () => {
  it('projects cognition as versioned surface data and leaves unknown exact children unclassified', () => {
    const snapshot: EngineSnapshot = {
      instances: {},
      collections: {},
      definitions: {
        future: {
          name: 'future',
          version: 1,
          status: 'active',
          definition: { name: 'future', initial: 'ready', nodes: [{ name: 'ready', actions: [] }] },
        },
      },
    };
    const readers = createSitemapReaders(
      () => snapshot,
      () => [],
    );
    const sitemap = readers.currentMetaSitemap();
    const byRel = new Map(sitemap.surfaces.map((surface) => [surface.rel, surface]));

    expect(byRel.get('meta/activations')?.presentation).toMatchObject({
      groupRole: 'responsibility',
      priority: 'high',
    });
    expect(byRel.get('meta/applications')?.presentation).toMatchObject({
      groupRole: 'definition',
    });
    expect(byRel.get('meta/self')?.presentation).toMatchObject({ groupRole: 'system' });
    expect(byRel.get('meta/flow:future')?.presentation).toBeUndefined();
    expect(readers.currentMetaSitemap()).toBe(sitemap);
  });
});
