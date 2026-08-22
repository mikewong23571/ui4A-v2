import { readFileSync } from 'node:fs';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { UserSidecarKey } from '@ui4a/engine';

import { listEvents, readLog } from './events';
import { getPool } from './pool';
import {
  appendSidecarCommand,
  ensurePresentationTables,
  findActiveSidecar,
  loadPresentationSnapshot,
  rebuildPresentationProjection,
} from './presentation';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const key: UserSidecarKey = {
  principal: 'user:mike',
  policyScope: 'scope:v1',
  subject: 'post:first',
  intent: 'read',
  deviceClass: 'wide',
};
const version = {
  surface: {
    schemaVersion: 1 as const,
    root: {
      kind: 'diagnostic' as const,
      id: 'root',
      role: 'diagnostic' as const,
      code: 'fixture',
      dependencies: [],
      provenance: [{ kind: 'generic-fallback' as const, ref: 'fixture' }],
    },
  },
  dependencies: [],
  provenance: { kind: 'generic-fallback' as const, ref: 'fixture' },
  changedPaths: [],
};

beforeEach(async () => {
  await ensurePresentationTables(pool);
  await pool.query('TRUNCATE events, presentation_user_sidecars');
});

afterAll(async () => {
  await pool.query('TRUNCATE events, presentation_user_sidecars');
});

describe('Presentation PostgreSQL projection', () => {
  it('contains no durable Session column/key and resolves the same row for every entry', async () => {
    const source = readFileSync(new URL('./presentation.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/sessionId|session_id/);
    await appendSidecarCommand(pool, {
      kind: 'instantiate',
      eventId: 'e1',
      commandId: 'c1',
      sidecarId: 'sidecar:1',
      key,
      version,
    });

    for (const entry of ['chat-a', 'chat-b', 'canvas', 'direct']) {
      expect(entry).toBeTruthy();
      await expect(findActiveSidecar(pool, key)).resolves.toMatchObject({
        id: 'sidecar:1',
        activeVersion: 1,
      });
    }
    await expect(
      findActiveSidecar(pool, { ...key, principal: 'user:other' }),
    ).resolves.toBeUndefined();
  });

  it('atomically deduplicates command retry and keeps Business log isolated', async () => {
    const command = {
      kind: 'instantiate' as const,
      eventId: 'e1',
      commandId: 'c1',
      sidecarId: 'sidecar:1',
      key,
      version,
    };
    const first = await appendSidecarCommand(pool, command);
    const retried = await appendSidecarCommand(pool, { ...command, eventId: 'e-retry' });

    expect(retried.aggregate).toEqual(first.aggregate);
    expect((await listEvents(pool)).filter(({ domain }) => domain === 'presentation')).toHaveLength(
      1,
    );
    expect(await readLog(pool)).toEqual([]);
  });

  it('rebuilds the disposable projection exactly from Presentation events', async () => {
    await appendSidecarCommand(pool, {
      kind: 'instantiate',
      eventId: 'e1',
      commandId: 'c1',
      sidecarId: 'sidecar:1',
      key,
      version,
    });
    await appendSidecarCommand(pool, {
      kind: 'pin',
      eventId: 'e2',
      commandId: 'c2',
      sidecarId: 'sidecar:1',
      baseVersion: 1,
    });
    const before = await loadPresentationSnapshot(pool);
    await pool.query('TRUNCATE presentation_user_sidecars');
    expect(await findActiveSidecar(pool, key)).toBeUndefined();

    await rebuildPresentationProjection(pool);

    expect(await loadPresentationSnapshot(pool)).toEqual(before);
    await expect(findActiveSidecar(pool, key)).resolves.toMatchObject({
      activeVersion: 2,
      versions: { 2: { retention: 'pinned' } },
    });
  });

  it('serializes concurrent first writes to one user-level aggregate', async () => {
    const commands = ['a', 'b'].map((suffix) =>
      appendSidecarCommand(pool, {
        kind: 'instantiate',
        eventId: `event:${suffix}`,
        commandId: `command:${suffix}`,
        sidecarId: 'sidecar:one-key',
        key,
        version,
      }),
    );
    const [left, right] = await Promise.all(commands);
    expect(left.aggregate.id).toBe('sidecar:one-key');
    expect(right.aggregate).toEqual(left.aggregate);
    expect(
      (await listEvents(pool)).filter(
        ({ domain, kind }) => domain === 'presentation' && kind === 'user-sidecar-instantiated',
      ),
    ).toHaveLength(1);
  });
});
