import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { createMetaRendererRegistry } from './registry';

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
      { id: 'application', priority: 100, classes: ['application-definition'] },
    ]);
    expect(registry.resolve(entity(['meta', 'application-definition']))).toBe('application');
    expect(registry.resolve(entity(['collection', 'meta/widgets']))).toBe('generic-collection');
    expect(registry.resolve(entity(['meta', 'widget']))).toBe('generic-detail');
  });

  it('fails closed when equal-priority registrations are ambiguous', () => {
    const registry = createMetaRendererRegistry([
      { id: 'one', priority: 100, classes: ['draft'] },
      { id: 'two', priority: 100, classes: ['draft'] },
    ]);
    expect(() => registry.resolve(entity(['meta', 'draft']))).toThrow(/ambiguous/i);
  });

  it('matches class tokens, never product rel or title names', () => {
    const registry = createMetaRendererRegistry([
      { id: 'draft', priority: 100, classes: ['draft'] },
    ]);
    expect(registry.resolve(entity(['meta', 'other']))).toBe('generic-detail');
  });

  it('allows a more-specific Draft renderer to outrank its agent-definition kind token', () => {
    const registry = createMetaRendererRegistry([
      { id: 'agent-definition', priority: 100, classes: ['agent-definition'] },
      { id: 'draft', priority: 200, classes: ['draft'] },
    ]);
    expect(registry.resolve(entity(['meta', 'draft', 'agent-definition', 'invalid']))).toBe(
      'draft',
    );
  });
});
