import { describe, expect, it } from 'vitest';

import { project, type SirenEntity } from '@ui4a/engine';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';

import { planGenericPresentationSurface } from './generic';

function collection(entities: SirenEntity[]): SirenEntity {
  return {
    class: ['collection', 'future-items'],
    properties: {
      rel: 'future-items',
      title: '未来事项',
      count: entities.length,
      presentation: {
        version: 1,
        traits: ['work-queue'],
        emptyMeaning: 'ready-to-start',
        fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
      },
    },
    actions: [],
    links: [],
    'guard-results': [],
    entities,
  };
}

describe('generic collection empty meaning', () => {
  it('prefers authorized identity/title bindings over an opaque canonical rel', () => {
    const entity: SirenEntity = {
      class: ['flow-instance'],
      properties: {
        rel: 'future-capture:main',
        title: '准备捕捉',
        identity: '捕捉未来线索',
      },
      actions: [],
      links: [],
      'guard-results': [],
    };
    const planned = planGenericPresentationSurface('flow:future-capture', entity, 'v1', 'read');
    expect(JSON.stringify(planned.surface)).toContain('properties.identity');
    expect(JSON.stringify(planned.surface)).not.toContain('"path":"properties.rel"');
  });

  it('plans a binding-only empty-state only for the empty collection', () => {
    const empty = planGenericPresentationSurface('future-items', collection([]), 'v1', 'read');
    expect(JSON.stringify(empty.surface)).toContain('empty-state');
    expect(JSON.stringify(empty.surface)).toContain('properties.presentation.emptyMeaning');
    expect(JSON.stringify(empty.surface)).not.toContain('这里还没有内容');

    const member: SirenEntity = {
      class: ['future-item'],
      properties: { rel: 'future-item:1', title: '第一项' },
      actions: [],
      links: [],
      'guard-results': [],
    };
    const populated = planGenericPresentationSurface(
      'future-items',
      collection([member]),
      'v2',
      'read',
    );
    expect(JSON.stringify(populated.surface)).not.toContain('empty-state');
  });

  it('plans an empty-state word for the three real home projections, bound to each declared meaning (F-04)', () => {
    const empty: EngineSnapshot = { instances: {}, collections: {}, threads: {} };
    const deps = { flows: {}, guards: seedGuardRegistry };
    const cases = [
      ['inbox', 'no-current-responsibility'],
      ['delegations', 'nothing-in-motion'],
      ['threads', 'ready-to-start'],
    ] as const;
    for (const [rel, meaning] of cases) {
      const entity = project(empty, rel, deps);
      expect(entity).toBeDefined();
      const planned = planGenericPresentationSurface(rel, entity!, 'definition-v1', 'read');
      expect(JSON.stringify(planned.surface)).toContain('empty-state');
      expect(JSON.stringify(planned.surface)).toContain('properties.presentation.emptyMeaning');
    }
  });
});
