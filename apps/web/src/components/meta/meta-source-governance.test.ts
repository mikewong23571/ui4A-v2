import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('../../app/meta/page.tsx', import.meta.url), 'utf8');
const rendererSource = readFileSync(
  new URL('./renderers/meta-entity-renderer.tsx', import.meta.url),
  'utf8',
);
const clientSource = readFileSync(new URL('./meta-client.ts', import.meta.url), 'utf8');

describe('Meta renderer executable governance', () => {
  it('keeps dashboard discovery free of hardcoded surface inventory', () => {
    expect(pageSource).not.toContain('FACES');
    expect(pageSource).not.toMatch(/meta\/(applications|drafts|agent-definitions|flows)/);
  });

  it('routes specialized UX by Siren class instead of product rel/name', () => {
    expect(rendererSource).toContain("classes: ['application-definition']");
    expect(rendererSource).toContain("classes: ['agent-definition']");
    expect(rendererSource).toContain("classes: ['draft']");
    expect(rendererSource).not.toMatch(/meta\/(applications|drafts|agent-definitions)/);
  });

  it('browser Meta exec omits actor/principal and performs a fresh exact read first', () => {
    expect(clientSource).not.toContain('BIOS_CHANNEL');
    expect(clientSource).not.toMatch(/actor:\s*['"]human/);
    expect(clientSource).toContain('await fetchMetaEntity(input.rel, input.scope)');
    expect(clientSource).toContain("!action.name.includes('callback')");
  });
});
