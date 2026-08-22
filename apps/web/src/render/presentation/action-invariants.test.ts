import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { createSurfaceActionAdapter } from './action-adapter';

function member(rel: string): SirenEntity {
  return {
    class: ['flow-instance'],
    properties: { rel },
    actions: [
      {
        name: 'open',
        title: 'Open',
        method: 'POST',
        href: '/api/exec',
        fields: { type: 'object', properties: {} },
      },
    ],
    links: [],
    'guard-results': [{ action: 'open', blocked: false, guards: [] }],
  };
}

describe('Surface action source and persistence invariants', () => {
  it('binds collection member actions to rel rather than visual index after reordering', async () => {
    const members = [member('post:b'), member('post:a')].sort((left, right) =>
      String(left.properties.rel).localeCompare(String(right.properties.rel)),
    );
    const selected = members[1]!;
    const exec = vi.fn(async () => ({ ok: true as const, entity: selected }));
    const adapter = createSurfaceActionAdapter({ fetchEntity: async () => selected, exec });

    await adapter.submit({ subject: String(selected.properties.rel), action: 'open' });

    expect(exec).toHaveBeenCalledWith({ rel: 'post:b', action: 'open', params: undefined });
  });

  it('persisted Surface and Recipe production schemas contain no transient interaction state', () => {
    const sources = [
      readFileSync(
        new URL('../../../../../packages/engine/src/presentation/surface.ts', import.meta.url),
        'utf8',
      ),
      readFileSync(
        new URL('../../../../../packages/engine/src/presentation/recipe.ts', import.meta.url),
        'utf8',
      ),
    ].join('\n');

    for (const forbidden of ['enabled:', 'guardResult:', 'formData:', 'confirmationComplete:']) {
      expect(sources).not.toContain(forbidden);
    }
  });
});
