import { describe, expect, it } from 'vitest';
import type { SirenEntity } from '../../contract/siren/types';
import { planGenericSurface } from './generic';
import type { SurfaceCatalog } from './types';

const inputs: SurfaceCatalog['words'][string]['bindings'] = {
  label: { sources: ['item'], required: true },
  rel: { sources: ['item'], required: true },
  actions: { sources: ['item'] },
  status: { sources: ['item'] },
  cognitive: { sources: ['item'] },
  members: { sources: ['item'] },
};
const catalog: SurfaceCatalog = {
  id: 'test:posture',
  version: '1',
  words: {
    'member-row': { roles: ['identity'], pattern: 'member-row', bindings: inputs },
    'member-table': { roles: ['identity'], pattern: 'member-table', bindings: inputs },
  },
};
function collection(withActions: boolean): SirenEntity {
  return {
    class: ['collection'],
    properties: { rel: 'items' },
    actions: [],
    links: [],
    entities: [
      {
        class: ['item'],
        properties: {
          rel: 'item:one',
          identity: 'A useful task',
          presentation: { version: 1, traits: ['work-queue'] },
        },
        actions: withActions
          ? [
              {
                name: 'manage',
                title: 'Manage',
                method: 'POST',
                href: '/api/exec',
                fields: { type: 'object', properties: {} },
              },
            ]
          : [],
        links: [],
      },
    ],
  };
}
describe('member posture uses task semantics instead of action availability', () => {
  for (const withActions of [false, true]) {
    it(`uses a summary member with actions=${withActions}`, () => {
      const surface = planGenericSurface('items', collection(withActions), catalog, {
        intent: 'overview',
        entityVersion: '1',
      });
      expect(JSON.stringify(surface)).toContain('"word":"member-row"');
      expect(JSON.stringify(surface)).toContain('properties.presentation');
      expect(JSON.stringify(surface)).toContain('"path":"entities"');
    });
    it(`supports declared table comparison with actions=${withActions}`, () => {
      const surface = planGenericSurface('items', collection(withActions), catalog, {
        intent: 'compare',
        density: 'table',
        entityVersion: '1',
      });
      expect(JSON.stringify(surface)).toContain('"word":"member-table"');
    });
  }
});

it('uses the common declared status role rather than a raw state enum or node title', () => {
  const source = collection(true);
  source.entities![0]!.properties = {
    ...source.entities![0]!.properties,
    status: 'open',
    title: 'Do not substitute the title',
    stateLabel: 'Awaiting input',
    presentation: {
      version: 1,
      traits: ['work-queue'],
      fields: [{ path: 'properties.stateLabel', title: 'State', role: 'status' }],
    },
  };
  const surface = planGenericSurface('items', source, catalog, {
    intent: 'overview',
    entityVersion: '1',
  });
  expect(JSON.stringify(surface)).toContain(
    '"status":{"kind":"item","path":"properties.stateLabel"}',
  );
});
