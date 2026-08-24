import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';

import { businessFlows } from '../domain/flows';
import { appendEvent, ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';

import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL!);

const agentArchive = {
  rel: 'post:post-welcome',
  action: 'archive',
  params: {},
  actor: 'agent' as const,
  principal: 'user:mike',
  channel: 'http',
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('single-Web committed-log cursor (Red)', () => {
  it('rebuilds in sequence order when a lower allocated seq commits after a higher Web seq', async () => {
    const engine = await getEngine(pool);
    await engine.exec(agentArchive);

    const worker = await pool.connect();
    let open = true;
    try {
      await worker.query('BEGIN');
      const low = await appendEvent(worker, {
        kind: 'notification-delivered',
        rel: 'confirmation:c1',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'notify',
        detail: {
          notificationId: 'notif:c1',
          confirmation: {
            id: 'c1',
            targetRel: 'post:post-welcome',
            targetAction: 'archive',
            proposedBy: { actor: 'agent', principal: 'user:mike' },
            reason: 'fixture',
          },
        },
      });

      const web = await engine.exec({
        rel: 'post:post-welcome',
        action: 'unpublish',
        params: {},
        actor: 'human',
        principal: 'user:mike',
      });
      expect(web.kind).toBe('accepted');
      const high = (await readLog(pool)).at(-1)!.seq;
      expect(low.seq).toBeLessThan(high);

      await worker.query('COMMIT');
      open = false;

      const online = await engine.readSnapshot();
      const replayed = fold(await readLog(pool), { flows: businessFlows });
      expect(online.confirmations?.['confirmation:c1']?.notified).toBe(true);
      expect(contentVersion(online)).toBe(contentVersion(replayed));
      expect((await readLog(pool)).map(({ seq }) => seq)).toEqual(
        [...(await readLog(pool)).map(({ seq }) => seq)].sort((left, right) => left - right),
      );
    } finally {
      if (open) await worker.query('ROLLBACK');
      worker.release();
    }
  });
});
