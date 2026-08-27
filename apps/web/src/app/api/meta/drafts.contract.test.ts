import { beforeEach, describe, expect, it } from 'vitest';

import { ensureDraftTables } from '../../../db/drafts';
import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { GET as getEntity } from './entity/route';
import { POST as exec } from './exec/route';

const pool = getPool(process.env.DATABASE_URL!);
const headers = {
  'content-type': 'application/json',
  'x-ui4a-principal': 'user:mike',
  'x-ui4a-policy-scope': 'publishing',
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
});

describe('Draft meta HTTP contract', () => {
  it('creates an invalid system-owned Draft and exact read is owner scoped', async () => {
    const response = await exec(
      new Request('http://localhost:3100/_meta/api/exec', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rel: 'meta/drafts',
          action: 'create',
          actor: 'agent',
          principal: 'user:mike',
          channel: 'cli',
          params: {
            kind: 'flow-definition',
            target: 'post-status',
            policyScope: 'publishing',
            commandId: 'http:create',
            payload: { name: 'post-status' },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entity: { properties: { rel: string; status: string } };
    };
    expect(body.entity.properties.status).toBe('invalid');

    const exact = await getEntity(
      new Request(
        `http://localhost:3100/_meta/api/entity?rel=${encodeURIComponent(body.entity.properties.rel)}&policyScope=publishing`,
        { headers },
      ),
    );
    expect(exact.status).toBe(200);

    const hidden = await getEntity(
      new Request(
        `http://localhost:3100/_meta/api/entity?rel=${encodeURIComponent(body.entity.properties.rel)}&policyScope=publishing`,
        { headers: { ...headers, 'x-ui4a-principal': 'user:other' } },
      ),
    );
    expect(hidden.status).toBe(404);
  });
});
