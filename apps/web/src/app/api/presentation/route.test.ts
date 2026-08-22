import { beforeEach, describe, expect, it } from 'vitest';

import { completePresentationRequest } from '@ui4a/shared';

import { ensureEventsTable } from '../../../db/events';
import { getPool } from '../../../db/pool';
import { resetPresentationBrokerForTests } from '../../../engine/presentation/runtime';
import { resetEngineForTests } from '../../../engine/service';

import { POST } from './route';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
  resetPresentationBrokerForTests();
});

describe('POST /api/presentation', () => {
  it('accepts the same thin request for a direct-navigation origin', async () => {
    const body = completePresentationRequest(
      { subject: 'post:first-post', intent: 'read article', delivery: 'canvas' },
      { requestId: 'direct:1', principal: 'user:local', sourceMessageIds: [] },
    );
    const response = await POST(
      new Request('http://localhost/api/presentation', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestId: 'direct:1',
      status: 'fallback',
      surfaceUrl: '/canvas?focus=post%3Afirst-post',
    });
  });

  it('rejects Session data and planning payloads before Broker dispatch', async () => {
    for (const forbidden of ['sessionId', 'surface', 'component', 'bind', 'dependency']) {
      const response = await POST(
        new Request('http://localhost/api/presentation', {
          method: 'POST',
          body: JSON.stringify({
            schemaVersion: 1,
            requestId: `bad:${forbidden}`,
            principal: 'user:local',
            subject: 'articles',
            intent: 'browse',
            delivery: 'canvas',
            sourceMessageIds: [],
            [forbidden]: {},
          }),
        }),
      );
      expect(response.status, forbidden).toBe(400);
    }
  });
});
