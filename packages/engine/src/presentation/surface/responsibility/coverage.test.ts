import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '../../../contract/siren/index';
import type { SurfaceCatalog, SurfaceNode, SurfaceTree } from '../types';
import { validateResponsibilityCoverage } from './coverage';

const catalog: SurfaceCatalog = {
  id: 'semantic',
  version: '1',
  words: {
    row: { pattern: 'member-row', roles: ['identity'], bindings: {} },
    card: { pattern: 'member-card', roles: ['identity'], bindings: {} },
    link: { pattern: 'member-link', roles: ['identity'], bindings: {} },
    controls: { roles: ['actions'], bindings: { actions: { sources: ['actions'] } } },
    heading: { roles: ['identity'], bindings: { value: { sources: ['property'] } } },
  },
};

function entity(rel: string, responsible = false, members?: SirenEntity[]): SirenEntity {
  return {
    class: ['opaque'],
    properties: {
      rel,
      presentation: {
        version: 1,
        traits: responsible ? ['human-responsibility'] : [],
        ...(members === undefined ? {} : { groupRole: 'responsibility' }),
      },
    },
    actions: [{ name: 'choose', title: 'Choose', method: 'POST', href: '/exec', fields: {} }],
    links: [],
    ...(members === undefined ? {} : { entities: members }),
  };
}

function row(word = 'row'): SurfaceNode {
  return {
    id: 'row',
    kind: 'word',
    role: 'identity',
    word,
    dependencies: [],
    provenance: [],
    bindings: {
      rel: { kind: 'item', path: 'properties.rel' },
      actions: { kind: 'item', path: 'actions' },
      cognitive: { kind: 'item', path: 'properties.presentation' },
      members: { kind: 'item', path: 'entities' },
    },
  };
}

function surface(item = row(), exclude?: string[]): SurfaceTree {
  return {
    schemaVersion: 1,
    root: {
      kind: 'repeat',
      id: 'members',
      role: 'primary-content',
      dependencies: [],
      provenance: [],
      source: { kind: 'entities', subject: 'queue' },
      item,
      ...(exclude === undefined ? {} : { exclude }),
    },
  };
}

const source = entity('queue', true, [entity('decision:a', true), entity('ordinary')]);
const sources = [{ subject: 'queue', entity: source }];

describe('declared responsibility Surface coverage', () => {
  it('accepts a bound generic row and a decision card without application-name semantics', () => {
    expect(validateResponsibilityCoverage(surface(), sources, catalog).valid).toBe(true);
    expect(validateResponsibilityCoverage(surface(row('card')), sources, catalog).valid).toBe(true);
  });

  it('rejects omission, excluded members, navigation-only words and altered action bindings', () => {
    const noActions = row();
    if (noActions.kind !== 'word') throw new Error('word fixture');
    noActions.bindings.actions = { kind: 'item', path: 'properties.actions' };
    for (const candidate of [
      surface(row(), ['decision:a']),
      surface(row('link')),
      surface(noActions),
    ]) {
      expect(validateResponsibilityCoverage(candidate, sources, catalog)).toEqual({
        valid: false,
        missing: ['decision:a'],
      });
    }
    const omitted = surface();
    omitted.root = {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      children: [],
      dependencies: [],
      provenance: [],
    };
    expect(validateResponsibilityCoverage(omitted, sources, catalog).missing).toEqual([
      'decision:a',
    ]);
  });

  it('requires cognitive binding on semantic rows and never counts dependency references alone', () => {
    const item = row();
    if (item.kind !== 'word') throw new Error('word fixture');
    delete item.bindings.cognitive;
    item.dependencies = [
      { kind: 'entity', subject: 'decision:a', version: '1', paths: ['$actions'] },
    ];
    expect(validateResponsibilityCoverage(surface(item), sources, catalog).valid).toBe(false);
  });

  it('preserves nested responsibility links through row members and cognition bindings', () => {
    const group = entity('thread:any', true, [entity('confirmation:one', true)]);
    const nested = [{ subject: 'queue', entity: entity('queue', false, [group]) }];
    expect(validateResponsibilityCoverage(surface(), nested, catalog).valid).toBe(true);
    const item = row();
    if (item.kind !== 'word') throw new Error('word fixture');
    delete item.bindings.members;
    expect(validateResponsibilityCoverage(surface(item), nested, catalog).missing).toEqual([
      'confirmation:one',
    ]);
    // A group trait is not a responsibility to execute its lifecycle actions.
    expect(
      validateResponsibilityCoverage(
        surface(row('link')),
        [{ subject: 'queue', entity: entity('queue', false, [entity('thread:any', true, [])]) }],
        catalog,
      ).valid,
    ).toBe(true);
  });

  it.each([[], [entity('evidence:one')]])(
    'does not let member arrays erase a leaf responsibility without an explicit groupRole: %j',
    (members) => {
      const leaf = entity('decision:leaf', true, members);
      leaf.properties.presentation = { version: 1, traits: ['human-responsibility'] };
      const roots = [{ subject: 'queue', entity: entity('queue', false, [leaf]) }];
      expect(validateResponsibilityCoverage(surface(row('link')), roots, catalog).missing).toEqual([
        'decision:leaf',
      ]);
      expect(validateResponsibilityCoverage(surface(), roots, catalog).valid).toBe(true);
    },
  );

  it('allows a duplicate exclusion only when an exact region preserves that object and its actions', () => {
    const candidate = surface(row(), ['decision:a']);
    candidate.root = {
      kind: 'layout',
      id: 'root',
      role: 'primary-content',
      layout: 'stack',
      dependencies: [],
      provenance: [],
      children: [
        candidate.root,
        {
          kind: 'word',
          id: 'name',
          role: 'identity',
          word: 'heading',
          dependencies: [],
          provenance: [],
          bindings: {
            value: { kind: 'property', subject: 'decision:a', path: 'properties.identity' },
          },
        },
        {
          kind: 'word',
          id: 'actions',
          role: 'actions',
          word: 'controls',
          dependencies: [],
          provenance: [],
          bindings: { actions: { kind: 'actions', subject: 'decision:a' } },
        },
      ],
    };
    expect(validateResponsibilityCoverage(candidate, sources, catalog).valid).toBe(true);
  });

  it('checks only declared leaves from authorized roots and respects canonical source aliases', () => {
    const candidate = surface();
    const renamed = entity('canonical:queue', false, [entity('new-app:decision', true)]);
    expect(
      validateResponsibilityCoverage(candidate, [{ subject: 'queue', entity: renamed }], catalog)
        .valid,
    ).toBe(true);
    expect(validateResponsibilityCoverage(candidate, [], catalog).valid).toBe(true);
    const unknown = entity('ordinary');
    unknown.actions[0]!['requires-confirmation'] = 'high';
    unknown.properties.presentation = { version: 999, traits: ['human-responsibility'] };
    expect(
      validateResponsibilityCoverage(
        surface(row('link')),
        [{ subject: 'queue', entity: entity('queue', false, [unknown]) }],
        catalog,
      ).valid,
    ).toBe(true);
  });
});
