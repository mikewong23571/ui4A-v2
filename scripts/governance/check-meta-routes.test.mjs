import { describe, expect, it } from 'vitest';

import { inspectLegacyMetaRoutes } from './check-meta-routes.mjs';

describe('canonical Meta route standing governance', () => {
  it('rejects every retired friendly route from executable source and comments', () => {
    const source = [
      "navigate('/meta/self')",
      "navigate('/meta/flows?scope=governance')",
      "navigate('/meta/flow/example')",
      "navigate('/meta/activations')",
      "navigate('/meta/activation/a1')",
      "navigate('/meta/capabilities')",
      "navigate('/meta/capability/notify')",
    ].join('\n');

    expect(inspectLegacyMetaRoutes('fixture.ts', source).map(({ pattern }) => pattern)).toEqual([
      '/meta/self',
      '/meta/flows',
      '/meta/flow/',
      '/meta/activations',
      '/meta/activation/',
      '/meta/capabilities',
      '/meta/capability/',
    ]);
  });

  it('permits the Meta dashboard, canonical entity route, contract rels and Meta API', () => {
    const source = [
      "navigate('/meta')",
      "navigate('/meta/entity?rel=meta%2Fflows')",
      "const rel = 'meta/flows'",
      "fetch('/_meta/api/entity?rel=meta%2Fflows')",
      "const unrelated = '/meta/flowsheet'",
    ].join('\n');

    expect(inspectLegacyMetaRoutes('fixture.ts', source)).toEqual([]);
  });
});
