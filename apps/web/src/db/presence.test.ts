import { beforeEach, describe, expect, it } from 'vitest';

import {
  appendPresenceChange,
  ensurePresenceTables,
  foldPresenceEvents,
  loadPresenceSnapshot,
  presenceContentVersion,
  rebuildPresenceProjection,
  type PresenceEventRow,
} from './presence';
import { getPool } from './pool';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const fixtureEvents: PresenceEventRow[] = [
  {
    seq: 2,
    principal: 'user:one',
    kind: 'presence-focus-changed',
    detail: { schemaVersion: 1, kind: 'focus', value: 'post:first-post' },
  },
  {
    seq: 1,
    principal: 'user:one',
    kind: 'presence-site-changed',
    detail: { schemaVersion: 1, kind: 'site', value: 'business' },
  },
  {
    seq: 3,
    principal: 'user:one',
    kind: 'presence-scope-changed',
    detail: { schemaVersion: 1, kind: 'scope', value: 'publishing' },
  },
];

describe('presence projection', () => {
  beforeEach(async () => {
    await ensurePresenceTables(pool);
    await pool.query('TRUNCATE events, presence_current');
  });

  it('folds each dimension independently and sorts by sequence', () => {
    const incremental = foldPresenceEvents(fixtureEvents);
    const replayed = foldPresenceEvents([...fixtureEvents].reverse());
    expect(incremental['user:one']).toEqual({
      principal: 'user:one',
      site: 'business',
      scope: 'publishing',
      thread: null,
      focus: 'post:first-post',
      updatedSeq: 3,
    });
    expect(presenceContentVersion(incremental)).toBe(presenceContentVersion(replayed));
  });

  it('keeps empty logs valid and supports clearing a dimension', () => {
    const folded = foldPresenceEvents([
      ...fixtureEvents,
      {
        seq: 4,
        principal: 'user:one',
        kind: 'presence-focus-changed',
        detail: { schemaVersion: 1, kind: 'focus', value: null },
      },
    ]);
    expect(foldPresenceEvents([])).toEqual({});
    expect(folded['user:one']?.focus).toBeNull();
    expect(folded['user:one']?.updatedSeq).toBe(4);
  });

  it('appends four change points, deduplicates repeats, and replays to the same hash', async () => {
    const identity = { principal: 'user:replay', actor: 'human' as const, channel: 'test' };
    for (const [kind, value] of [
      ['site', 'meta'],
      ['scope', 'publishing'],
      ['thread', 'thread:one'],
      ['focus', { selection: ['post:a', 'post:b'] }],
    ] as const) {
      await appendPresenceChange(
        pool,
        { schemaVersion: 1, kind, value, clientInstanceId: 'client:replay' },
        identity,
      );
    }
    const duplicate = await appendPresenceChange(
      pool,
      { schemaVersion: 1, kind: 'focus', value: { selection: ['post:a', 'post:b'] } },
      identity,
    );
    expect(duplicate.changed).toBe(false);
    const onlineHash = presenceContentVersion(await loadPresenceSnapshot(pool));
    await rebuildPresenceProjection(pool);
    expect(presenceContentVersion(await loadPresenceSnapshot(pool))).toBe(onlineHash);
  });
});
