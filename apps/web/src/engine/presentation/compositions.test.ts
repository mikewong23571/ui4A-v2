import { describe, expect, it } from 'vitest';

import { getBuiltinComposition, resolveBuiltinCompositionSubject } from './compositions';

describe('built-in composition registry', () => {
  it('looks up the versioned my-work declaration with stable ordered regions', () => {
    expect(getBuiltinComposition('my-work')).toEqual({
      id: 'my-work',
      version: '2',
      regions: [
        {
          region: 'waiting-for-me',
          source: 'inbox',
          intent: 'Review work waiting for me',
          mode: 'invalidate',
          shape: 'collection',
        },
        {
          region: 'in-motion',
          source: 'delegations',
          intent: 'Track work currently in motion',
          mode: 'rehydrate',
          shape: 'collection',
        },
        {
          region: 'work-lines',
          source: 'threads',
          intent: 'Follow active work lines',
          mode: 'invalidate',
          shape: 'collection',
        },
      ],
    });
  });

  it('distinguishes ordinary rels from registered and rejected workspace subjects', () => {
    expect(resolveBuiltinCompositionSubject('inbox')).toEqual({ kind: 'not-workspace' });
    expect(resolveBuiltinCompositionSubject('thread:article-1')).toEqual({
      kind: 'not-workspace',
    });

    const resolved = resolveBuiltinCompositionSubject('workspace:my-work');
    expect(resolved.kind).toBe('composition');
    if (resolved.kind === 'composition') {
      expect(resolved.declaration.id).toBe('my-work');
    }
  });

  it.each([
    'workspace:unknown',
    'workspace:',
    'workspace:Uppercase',
    'workspace:has space',
    'workspace:-leading',
    `workspace:${'a'.repeat(65)}`,
  ])('rejects unknown or invalid workspace subject %j without rel fallback', (subject) => {
    expect(resolveBuiltinCompositionSubject(subject)).toEqual({ kind: 'rejected-workspace' });
  });

  it('returns no declaration for unknown or invalid direct ids', () => {
    expect(getBuiltinComposition('unknown')).toBeUndefined();
    expect(getBuiltinComposition('Uppercase')).toBeUndefined();
  });

  it('does not expose registry data to caller mutation', () => {
    const declaration = getBuiltinComposition('my-work');
    expect(declaration).toBeDefined();
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration?.regions)).toBe(true);
    expect(Object.isFrozen(declaration?.regions[0])).toBe(true);

    expect(() => {
      (declaration?.regions as unknown as Array<{ source: string }>)[0]!.source = 'changed';
    }).toThrow(TypeError);
    expect(getBuiltinComposition('my-work')?.regions[0]?.source).toBe('inbox');
  });
});
