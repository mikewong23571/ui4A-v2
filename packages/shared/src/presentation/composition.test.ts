import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  COMPOSITION_MODES,
  MAX_COMPOSITION_ID_LENGTH,
  MAX_COMPOSITION_INTENT_LENGTH,
  MAX_COMPOSITION_REGIONS,
  MAX_COMPOSITION_SOURCE_LENGTH,
  MAX_COMPOSITION_VERSION_LENGTH,
  parseCompositionId,
  parseCompositionDeclaration,
  isCompositionRegionId,
  type CompositionDeclaration,
} from '../index';

const declaration = {
  id: 'my-work',
  version: '1',
  regions: [
    {
      region: 'waiting-for-me',
      source: 'inbox',
      intent: 'Show work waiting for my decision',
      mode: 'invalidate',
    },
    {
      region: 'work-lines',
      source: 'threads',
      intent: 'Show my active work threads',
      mode: 'rehydrate',
    },
  ],
} as const;

describe('composition declaration', () => {
  it('exports the declaration id parser for workspace adapters', () => {
    expect(parseCompositionId('my-work')).toBe('my-work');
    expect(() => parseCompositionId('Uppercase')).toThrow(/id/i);
    expect(() => parseCompositionId('a'.repeat(MAX_COMPOSITION_ID_LENGTH + 1))).toThrow(/id/i);
  });

  it('round-trips one platform-neutral, versioned declaration through the shared barrel', () => {
    const parsed = parseCompositionDeclaration(declaration);

    expect(parsed).toEqual(declaration);
    expect(parseCompositionDeclaration(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expectTypeOf(parsed).toEqualTypeOf<CompositionDeclaration>();
    expect(COMPOSITION_MODES).toEqual(['rehydrate', 'invalidate']);
  });

  it.each([
    [{ ...declaration, owner: 'user:mike' }, 'owner'],
    [{ ...declaration, sessionId: 'session:secret' }, 'sessionId'],
    [
      {
        ...declaration,
        regions: [{ ...declaration.regions[0], policyScope: 'application:publishing' }],
      },
      'policyScope',
    ],
    [
      {
        ...declaration,
        regions: [{ ...declaration.regions[0], session_key: 'session:secret' }],
      },
      'session_key',
    ],
  ])('rejects unknown or runtime identity field %s', (candidate, field) => {
    expect(() => parseCompositionDeclaration(candidate)).toThrow(String(field));
  });

  it.each([
    ['', 'id'],
    ['Uppercase', 'id'],
    ['-leading', 'id'],
    ['has space', 'id'],
    ['a'.repeat(MAX_COMPOSITION_ID_LENGTH + 1), 'id'],
  ])('rejects invalid or overlong declaration id %j', (id, field) => {
    expect(() => parseCompositionDeclaration({ ...declaration, id })).toThrow(field);
  });

  it('applies the same bounded identifier grammar to region names', () => {
    for (const region of [
      '',
      'Uppercase',
      '.leading',
      'has space',
      'a'.repeat(MAX_COMPOSITION_ID_LENGTH + 1),
    ]) {
      expect(() =>
        parseCompositionDeclaration({
          ...declaration,
          regions: [{ ...declaration.regions[0], region }],
        }),
      ).toThrow(/region/i);
    }
  });

  it('requires a non-empty, unique and bounded region list', () => {
    expect(() => parseCompositionDeclaration({ ...declaration, regions: [] })).toThrow(/region/i);
    expect(() =>
      parseCompositionDeclaration({
        ...declaration,
        regions: [declaration.regions[0], { ...declaration.regions[0] }],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      parseCompositionDeclaration({
        ...declaration,
        regions: Array.from({ length: MAX_COMPOSITION_REGIONS + 1 }, (_, index) => ({
          ...declaration.regions[0],
          region: `region-${index}`,
        })),
      }),
    ).toThrow(/region/i);
  });

  it.each([
    ['', 'non-empty'],
    ['   ', 'non-empty'],
    ['workspace:my-work', 'workspace'],
    ['https://example.test/inbox', 'rel'],
    ['mailto:owner@example.test', 'rel'],
    ['/api/entity', 'rel'],
    ['in box', 'rel'],
    ['inbox\nadmin', 'rel'],
    ['inbox?scope=admin', 'rel'],
    ['inbox#actions', 'rel'],
    ['a'.repeat(MAX_COMPOSITION_SOURCE_LENGTH + 1), 'character'],
  ])('rejects unsafe composition source %j', (source, reason) => {
    expect(() =>
      parseCompositionDeclaration({
        ...declaration,
        regions: [{ ...declaration.regions[0], source }],
      }),
    ).toThrow(reason);
  });

  it.each([
    ['', 'version'],
    ['   ', 'version'],
    ['v'.repeat(MAX_COMPOSITION_VERSION_LENGTH + 1), 'version'],
  ])('rejects empty or overlong version %j', (version, field) => {
    expect(() => parseCompositionDeclaration({ ...declaration, version })).toThrow(field);
  });

  it('bounds non-empty intent and closes invalidation mode', () => {
    for (const intent of ['', '   ', 'i'.repeat(MAX_COMPOSITION_INTENT_LENGTH + 1)]) {
      expect(() =>
        parseCompositionDeclaration({
          ...declaration,
          regions: [{ ...declaration.regions[0], intent }],
        }),
      ).toThrow(/intent/i);
    }
    expect(() =>
      parseCompositionDeclaration({
        ...declaration,
        regions: [{ ...declaration.regions[0], mode: 'refresh' }],
      }),
    ).toThrow(/mode/i);
  });

  it('accepts bounded identifier edges and canonical contract rel shapes', () => {
    expect(
      parseCompositionDeclaration({
        id: `a${'z'.repeat(MAX_COMPOSITION_ID_LENGTH - 1)}`,
        version: '2026.08.26',
        regions: [
          {
            region: `r${'z'.repeat(MAX_COMPOSITION_ID_LENGTH - 1)}`,
            source: 'meta/flow:article-drafting',
            intent: 'Inspect the active definition',
            mode: 'rehydrate',
          },
        ],
      }),
    ).toMatchObject({ version: '2026.08.26' });
  });
});

describe('shared region-id grammar is the single source for Recipe slot names (T31 R13)', () => {
  it.each([
    'waiting',
    'work-lines',
    'r1',
    'a.b_c-d',
    `a${'z'.repeat(MAX_COMPOSITION_ID_LENGTH - 1)}`,
  ])('accepts in-grammar region id %j', (value) => {
    expect(isCompositionRegionId(value)).toBe(true);
  });

  it.each([
    '',
    'Uppercase',
    '.leading',
    '-leading',
    'has space',
    `$${'a'}`,
    `a${'z'.repeat(MAX_COMPOSITION_ID_LENGTH)}`,
  ])('rejects off-grammar or overlong region id %j', (value) => {
    expect(isCompositionRegionId(value)).toBe(false);
    expect(() =>
      parseCompositionDeclaration({
        ...declaration,
        regions: [{ ...declaration.regions[0], region: value }],
      }),
    ).toThrow(/region/i);
  });
});

describe('composition region declared source shape (T31 R12)', () => {
  it('accepts an optional entity|collection shape and round-trips it', () => {
    const parsed = parseCompositionDeclaration({
      ...declaration,
      regions: [{ ...declaration.regions[0], shape: 'collection' }],
    });

    expect(parsed.regions[0]?.shape).toBe('collection');
    expect(parseCompositionDeclaration(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(parseCompositionDeclaration(declaration).regions[0]?.shape).toBeUndefined();
  });

  it.each([['Entity'], ['session'], ['collection '], [1], [null]])(
    'rejects a non-contract source shape %j',
    (shapeValue) => {
      expect(() =>
        parseCompositionDeclaration({
          ...declaration,
          regions: [{ ...declaration.regions[0], shape: shapeValue as never }],
        }),
      ).toThrow(/shape/i);
    },
  );

  it('still rejects unknown sibling fields next to shape', () => {
    expect(() =>
      parseCompositionDeclaration({
        ...declaration,
        regions: [
          { ...declaration.regions[0], shape: 'entity', provider: 'openai:gpt-x' } as never,
        ],
      }),
    ).toThrow(/provider/i);
  });
});
