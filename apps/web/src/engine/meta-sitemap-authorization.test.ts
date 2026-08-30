import { describe, expect, it } from 'vitest';

import type { Sitemap } from '@ui4a/engine';

import { filterMetaSitemapForGrantedApplications } from './meta-sitemap-authorization';
import type { MetaSitemap } from './service-sitemaps';

const business: Pick<Sitemap, 'applications' | 'flows' | 'capabilities'> = {
  applications: [
    { rel: 'application:alpha', name: 'alpha', title: 'Alpha', intent: 'Alpha work', flows: [] },
    { rel: 'application:beta', name: 'beta', title: 'Beta', intent: 'Beta work', flows: [] },
  ],
  flows: [
    {
      name: 'alpha-flow',
      title: 'Alpha flow',
      app: 'alpha',
      initial: 'open',
      nodes: [],
      edges: [],
    },
    { name: 'beta-flow', title: 'Beta flow', app: 'beta', initial: 'open', nodes: [], edges: [] },
  ],
  capabilities: [
    {
      name: 'shared-capability',
      title: 'Shared capability',
      kind: 'effect',
      intent: 'Shared work',
      scope: { applications: ['alpha', 'beta'], flows: ['alpha-flow', 'beta-flow'] },
    },
    {
      name: 'beta-capability',
      title: 'Beta capability',
      kind: 'effect',
      intent: 'Beta work',
      scope: { applications: ['beta'], flows: ['beta-flow'] },
    },
  ],
};

const meta: MetaSitemap = {
  site: 'meta',
  version: 'unfiltered',
  surfaces: [
    { rel: 'meta/self', title: 'Lifecycle' },
    { rel: 'meta/flows', title: 'Flow catalog', collection: true },
    { rel: 'meta/future-catalog', title: 'Future catalog', collection: true },
    { rel: 'meta/application:alpha', title: 'Alpha' },
    { rel: 'meta/application:beta', title: 'Beta' },
    { rel: 'meta/application:unknown', title: 'Unknown', collection: true },
    { rel: 'meta/flow:alpha-flow', title: 'Alpha flow' },
    { rel: 'meta/flow:beta-flow', title: 'Beta flow' },
    { rel: 'meta/capability:shared-capability', title: 'Shared capability' },
    { rel: 'meta/capability:beta-capability', title: 'Beta capability' },
    { rel: 'meta/future-exact', title: 'Undeclared exact title' },
  ],
};

describe('credential Meta sitemap authorization', () => {
  it('keeps global catalogs and granted ownership while unknown exact surfaces fail closed', () => {
    const disclosed = filterMetaSitemapForGrantedApplications(meta, business, ['alpha']);

    expect(disclosed.surfaces.map((surface) => surface.rel)).toEqual([
      'meta/self',
      'meta/flows',
      'meta/future-catalog',
      'meta/application:alpha',
      'meta/flow:alpha-flow',
      'meta/capability:shared-capability',
    ]);
    expect(JSON.stringify(disclosed)).not.toContain('Undeclared exact title');
    expect(disclosed.version).not.toBe(meta.version);
  });
});
