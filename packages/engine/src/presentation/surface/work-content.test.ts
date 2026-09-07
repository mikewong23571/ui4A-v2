import { describe, expect, it } from 'vitest';
import { parseCognitiveSemanticsDeclaration } from '@ui4a/shared';
import { planGenericSurface } from './generic';
import { validateResponsibilityCoverage } from './responsibility/coverage';
import type { SirenEntity } from '../../contract/siren/types';
import type { SurfaceCatalog } from './types';

const catalog = {
  id: 'work-context',
  version: '1',
  words: {
    heading: {
      roles: ['identity'],
      bindings: { value: { sources: ['property'], required: true } },
    },
    work: {
      roles: ['primary-content'],
      pattern: 'work-content',
      bindings: {
        entities: { sources: ['entities'], required: true },
        actions: { sources: ['actions'], required: true },
        links: { sources: ['links'], required: true },
      },
    },
  },
} as SurfaceCatalog;
const entity: SirenEntity = {
  class: ['unfamiliar-application'],
  properties: {
    rel: 'case:one',
    identity: 'Resolve an incident',
    presentation: {
      version: 1,
      traits: ['work-context'],
      groupRole: 'responsibility',
    },
  },
  actions: [],
  links: [],
  entities: [
    {
      class: [],
      properties: {
        rel: 'decision:one',
        identity: 'Authorize repair',
        presentation: {
          version: 1,
          traits: ['human-responsibility'],
        },
      },
      actions: [
        { name: 'approve', title: 'Approve', method: 'POST', href: '/api/exec', fields: {} },
      ],
      links: [],
    },
  ],
};

describe('work-context presentation', () => {
  it('declares supporting context without a business type or phase', () => {
    expect(
      parseCognitiveSemanticsDeclaration({ version: 1, traits: ['supporting-context'] }),
    ).toEqual({ version: 1, traits: ['supporting-context'] });
  });
  it('binds the work group once and preserves actionable responsibility coverage', () => {
    const surface = planGenericSurface('case:one', entity, catalog, {
      intent: 'read',
      entityVersion: '1',
      semanticHints: { 'properties.identity': 'identity' },
    });
    expect(JSON.stringify(surface)).toContain('"word":"work"');
    expect(JSON.stringify(surface)).not.toContain('Authorize repair');
    expect(
      validateResponsibilityCoverage(surface, [{ subject: 'case:one', entity }], catalog),
    ).toEqual({ valid: true, missing: [] });
  });
  it('does not manufacture a workspace for an undeclared entity', () => {
    const plain = { ...entity, properties: { rel: 'case:one', identity: 'Plain' } };
    const surface = planGenericSurface('case:one', plain, catalog, {
      intent: 'read',
      entityVersion: '1',
    });
    expect(JSON.stringify(surface)).not.toContain('"word":"work"');
  });
  it('uses an excluding repeat when an exact composition region already owns a member', () => {
    const surface = planGenericSurface('case:one', entity, catalog, {
      intent: 'read',
      entityVersion: '1',
      excludedMemberRels: ['decision:one'],
    });
    expect(JSON.stringify(surface)).not.toContain('"word":"work"');
    expect(JSON.stringify(surface)).toContain('"kind":"repeat"');
    expect(JSON.stringify(surface)).toContain('"exclude":["decision:one"]');
  });
});
