import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PRESENCE_CHANGE_KINDS,
  PRESENCE_SCHEMA_VERSION,
  parsePresenceChange,
  type PresenceChange,
} from './presence';

describe('presence change contract', () => {
  it('accepts exactly the four bounded change points', () => {
    expect(PRESENCE_CHANGE_KINDS).toEqual(['site', 'scope', 'thread', 'focus']);
    const changes = PRESENCE_CHANGE_KINDS.map((kind) =>
      parsePresenceChange({
        schemaVersion: PRESENCE_SCHEMA_VERSION,
        kind,
        value: kind === 'focus' ? 'post:first-post' : `${kind}:current`,
        clientInstanceId: 'client:one',
      }),
    );
    expect(changes).toHaveLength(4);
    expectTypeOf(changes[0]).toEqualTypeOf<PresenceChange>();
  });

  it.each([
    { schemaVersion: 1, kind: 'route', value: '/canvas' },
    { schemaVersion: 1, kind: 'site', value: { arbitrary: true } },
    { schemaVersion: 1, kind: 'site', value: 'x'.repeat(257) },
    { schemaVersion: 1, kind: 'focus', value: { selection: ['post:a', 'post:a'] } },
    { schemaVersion: 1, kind: 'site', value: 'workstation', principal: 'user:forged' },
  ])('rejects an unbounded or authority-bearing payload %#', (value) => {
    expect(() => parsePresenceChange(value)).toThrow();
  });

  it('allows an explicit clear', () => {
    expect(parsePresenceChange({ schemaVersion: 1, kind: 'thread', value: null })).toEqual({
      schemaVersion: 1,
      kind: 'thread',
      value: null,
    });
  });
});
