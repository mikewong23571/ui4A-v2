import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';

import { deliverNotification } from '../../../worker/src/activities';
import { businessFlows } from '../domain/flows';
import { ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';

import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL!);

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('single-Web restart and replay integrity', () => {
  it('reboots a mixed command/worker/decision log without duplicate seed or stale judgment', async () => {
    const engine = await getEngine(pool);
    await engine.exec({ rel: 'comment:c1', action: 'approve', params: {}, actor: 'agent' });
    await engine.exec({ rel: 'comment:c1', action: 'reject', params: {}, actor: 'agent' });
    const suspended = await engine.exec({
      rel: 'post:post-welcome',
      action: 'archive',
      params: {},
      actor: 'agent',
      principal: 'user:mike',
    });
    expect(suspended.kind).toBe('suspended');
    await deliverNotification(pool, {
      id: 'c1',
      targetRel: 'post:post-welcome',
      targetAction: 'archive',
      proposedBy: { actor: 'agent', principal: 'user:mike' },
      reason: 'fixture',
    });
    await engine.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      params: {},
      actor: 'human',
      principal: 'user:approver',
    });

    const beforeSnapshot = await engine.readSnapshot();
    const beforeLog = await readLog(pool);
    const beforeHash = contentVersion(beforeSnapshot);
    const beforeSeedCounts = Object.fromEntries(
      ['seed', 'definition-seeded', 'application-seeded', 'capability-seeded'].map((kind) => [
        kind,
        beforeLog.filter((event) => event.kind === kind).length,
      ]),
    );
    expect(beforeHash).toBe(contentVersion(fold(beforeLog, { flows: businessFlows })));
    expect(beforeLog.map(({ seq }) => seq)).toEqual(
      [...beforeLog.map(({ seq }) => seq)].sort((left, right) => left - right),
    );

    resetEngineForTests();
    const restarted = await getEngine(pool);
    const afterSnapshot = await restarted.readSnapshot();
    const afterLog = await readLog(pool);
    expect(contentVersion(afterSnapshot)).toBe(beforeHash);
    expect(afterLog).toEqual(beforeLog);
    expect(
      Object.fromEntries(
        Object.keys(beforeSeedCounts).map((kind) => [
          kind,
          afterLog.filter((event) => event.kind === kind).length,
        ]),
      ),
    ).toEqual(beforeSeedCounts);
    expect(afterSnapshot.instances['comment:c1']?.node).toBe('approved');
    expect(afterSnapshot.instances['post:post-welcome']?.node).toBe('archived');
    expect(afterSnapshot.confirmations?.['confirmation:c1']).toMatchObject({
      status: 'approved',
      notified: true,
    });

    const stale = await restarted.exec({
      rel: 'confirmation:c1',
      action: 'approve',
      params: {},
      actor: 'human',
      principal: 'user:approver',
    });
    expect(stale).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
    expect(restarted.getSnapshot().instances['post:post-welcome']?.node).toBe('archived');
    const finalLog = await readLog(pool);
    expect(finalLog.at(-1)).toMatchObject({
      kind: 'action-rejected',
      rel: 'confirmation:c1',
      action: 'approve',
    });
    expect(finalLog.at(-1)!.seq).toBeGreaterThan(beforeLog.at(-1)!.seq);
  });
});
