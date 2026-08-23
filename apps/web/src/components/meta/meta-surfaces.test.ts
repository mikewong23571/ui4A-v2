import { describe, expect, it } from 'vitest';

import {
  browserHrefForMetaRel,
  projectMetaSurfaceDescriptors,
  relFromMetaApiHref,
  type MetaSitemapDocument,
} from './meta-surfaces';

const sitemap: MetaSitemapDocument = {
  protocolVersion: '1',
  version: 'abc123',
  site: 'meta',
  effectiveScope: 'publishing',
  authorizedScopes: ['publishing', 'governance'],
  authorizationMode: 'self-reported-local-demo',
  surfaces: [
    { rel: 'meta/self', title: 'Lifecycle' },
    { rel: 'meta/flows', title: 'Flows', collection: true },
    { rel: 'meta/flow:post-status', title: 'Post status' },
    { rel: 'meta/widgets', title: 'Widgets', collection: true },
  ],
};

describe('Meta sitemap surface projection', () => {
  it('projects top-level collections/self without a product rel inventory', () => {
    expect(projectMetaSurfaceDescriptors(sitemap)).toEqual([
      expect.objectContaining({ rel: 'meta/self', kind: 'self' }),
      expect.objectContaining({ rel: 'meta/flows', kind: 'collection' }),
      expect.objectContaining({ rel: 'meta/widgets', kind: 'collection' }),
    ]);
  });

  it('automatically routes a future surface through the canonical generic browser route', () => {
    expect(projectMetaSurfaceDescriptors(sitemap).at(-1)?.href).toBe(
      '/meta/entity?rel=meta%2Fwidgets&scope=publishing',
    );
  });

  it('round-trips encoded API hrefs without accepting cross-origin URLs', () => {
    expect(relFromMetaApiHref('/_meta/api/entity?rel=meta%2Fflow%3Apost-status')).toBe(
      'meta/flow:post-status',
    );
    expect(relFromMetaApiHref('https://evil.example/_meta/api/entity?rel=meta%2Fflows')).toBeNull();
    expect(browserHrefForMetaRel('draft:a/b', 'governance')).toBe(
      '/meta/entity?rel=draft%3Aa%2Fb&scope=governance',
    );
  });
});
