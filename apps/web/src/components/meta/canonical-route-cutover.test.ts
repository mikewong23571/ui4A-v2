import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const friendlyRoutePages = [
  '../../app/meta/self/page.tsx',
  '../../app/meta/flows/page.tsx',
  '../../app/meta/flow/[name]/page.tsx',
  '../../app/meta/activations/page.tsx',
  '../../app/meta/activation/[id]/page.tsx',
  '../../app/meta/capabilities/page.tsx',
  '../../app/meta/capability/[name]/page.tsx',
] as const;

describe('canonical Meta browser route cutover', () => {
  it('has no friendly route page beside /meta and /meta/entity', () => {
    const remnants = friendlyRoutePages.filter((relativePath) =>
      existsSync(new URL(relativePath, import.meta.url)),
    );

    expect(remnants).toEqual([]);
  });
});
