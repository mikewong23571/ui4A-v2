import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable, readLog } from '../../db/events';
import { getPool } from '../../db/pool';
import { getEngine, resetEngineForTests } from '../service';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('Work Thread service exec', () => {
  it('serially appends only dedicated thread events and returns the exact projection', async () => {
    const engine = await getEngine(pool);
    const before = (await readLog(pool)).length;
    const created = await engine.exec({
      rel: 'threads',
      action: 'create',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'http',
      params: { id: 'release-1', goal: 'Ship safely', goalSource: 'message:goal-1' },
    });
    expect(created).toMatchObject({
      kind: 'accepted',
      entity: {
        class: ['work-thread', 'open'],
        properties: { id: 'release-1', owner: 'user:mike' },
      },
    });
    const createEvents = (await readLog(pool)).slice(before);
    expect(createEvents.map((event) => event.kind)).toEqual(['thread-created']);
    expect(createEvents[0]?.detail).toMatchObject({
      receipt: {
        declaration: { passed: true },
        schema: { passed: true },
        confirmation: { required: false, status: 'not-required' },
      },
    });

    const attached = await engine.exec({
      rel: 'thread:release-1',
      action: 'attach',
      actor: 'human',
      principal: 'user:mike',
      channel: 'http',
      params: { category: 'context', rel: 'articles' },
    });
    expect(attached).toMatchObject({
      kind: 'accepted',
      entity: { properties: { context: ['articles'] } },
    });
    expect((await readLog(pool)).at(-1)?.kind).toBe('thread-reference-attached');
  });

  it('persists undeclared, owner-guard, and strict-schema rejections through one audit path', async () => {
    const engine = await getEngine(pool);
    const undeclared = await engine.exec({
      rel: 'threads',
      action: 'archive',
      principal: 'user:mike',
      params: {},
    });
    expect(undeclared).toMatchObject({ kind: 'rejected', layer: 'undeclared' });

    const schema = await engine.exec({
      rel: 'threads',
      action: 'create',
      principal: 'user:mike',
      params: {
        id: 'release-1',
        goal: 'Ship safely',
        goalSource: 'message:goal-1',
        extra: true,
      },
    });
    expect(schema).toMatchObject({ kind: 'rejected', layer: 'schema-invalid' });

    await engine.exec({
      rel: 'threads',
      action: 'create',
      principal: 'user:mike',
      params: { id: 'release-1', goal: 'Ship safely', goalSource: 'message:goal-1' },
    });
    const guard = await engine.exec({
      rel: 'thread:release-1',
      action: 'attach',
      principal: 'user:other',
      params: { category: 'invalid', rel: 'not a rel', extra: true },
    });
    expect(guard).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });

    const rejected = (await readLog(pool)).filter((event) => event.kind === 'action-rejected');
    expect(rejected.slice(-3).map((event) => (event.detail as { layer: string }).layer)).toEqual([
      'undeclared',
      'schema-invalid',
      'guard-failed',
    ]);
  });
});
