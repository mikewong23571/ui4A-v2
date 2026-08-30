import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import {
  createMetaRendererRegistry,
  KNOWN_META_ENTITY_SHAPES,
  META_RENDERER_REGISTRATIONS,
} from './registry';

const entity = (classes: string[]): SirenEntity => ({
  class: classes,
  properties: {},
  actions: [],
  links: [],
  'guard-results': [],
});

describe('Meta renderer registry', () => {
  it('selects a specialized renderer by Siren class and otherwise uses safe generic fallbacks', () => {
    const registry = createMetaRendererRegistry([
      { id: 'application', classes: ['application-definition'] },
    ]);
    expect(registry.resolve(entity(['meta', 'application-definition']))).toBe('application');
    expect(registry.resolve(entity(['collection', 'meta/widgets']))).toBe('generic-collection');
    expect(registry.resolve(entity(['meta', 'widget']))).toBe('generic-detail');
  });

  it('fails closed whenever multiple registrations match', () => {
    const registry = createMetaRendererRegistry([
      { id: 'draft', classes: ['draft'] },
      { id: 'agent-definition', classes: ['agent-definition'] },
    ]);
    expect(() => registry.resolve(entity(['meta', 'draft', 'agent-definition']))).toThrow(
      /ambiguous/i,
    );
  });

  it('matches class tokens, never product rel or title names', () => {
    const registry = createMetaRendererRegistry([{ id: 'draft', classes: ['draft'] }]);
    expect(registry.resolve(entity(['meta', 'other']))).toBe('generic-detail');
  });

  it('explicitly covers every known Meta Siren shape without registration precedence', () => {
    const registry = createMetaRendererRegistry(META_RENDERER_REGISTRATIONS);
    for (const shape of KNOWN_META_ENTITY_SHAPES) {
      expect(registry.resolve(entity([...shape.classes])), shape.name).toBe(shape.renderer);
    }
  });
});
