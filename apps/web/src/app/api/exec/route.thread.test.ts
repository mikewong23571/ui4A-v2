import { beforeEach, describe, expect, it } from 'vitest';

import { ensureEventsTable, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../engine/service';
import { POST } from './route';

const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');

function exec(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request('http://localhost:3100/api/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await pool.query('TRUNCATE events');
  resetEngineForTests();
});

describe('POST /api/exec Work Thread contract', () => {
  it('accepts create and returns the new exact thread without action-executed', async () => {
    const response = await exec({
      rel: 'threads',
      action: 'create',
      actor: 'agent',
      principal: 'user:mike',
      params: { id: 'release-1', goal: 'Ship safely', goalSource: 'message:goal-1' },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entity: {
        class: ['work-thread', 'open'],
        properties: { id: 'release-1', owner: 'user:mike' },
      },
    });
    const tail = await readLog(pool);
    expect(tail.at(-1)?.kind).toBe('thread-created');
    expect(tail.at(-1)?.rel).toBe('thread:release-1');
    expect(tail.some((event) => event.rel === 'threads' && event.kind === 'action-executed')).toBe(
      false,
    );
  });

  it.each([
    [
      'undeclared',
      { rel: 'threads', action: 'archive', actor: 'agent', principal: 'user:mike', params: {} },
      400,
    ],
    [
      'schema-invalid',
      {
        rel: 'threads',
        action: 'create',
        actor: 'agent',
        principal: 'user:mike',
        params: {
          id: 'release-1',
          goal: 'Ship safely',
          goalSource: 'message:goal-1',
          extra: true,
        },
      },
      422,
    ],
  ])('returns and persists %s rejection', async (layer, body, status) => {
    const response = await exec(body);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ layer });
    expect((await readLog(pool)).at(-1)).toMatchObject({
      kind: 'action-rejected',
      rel: body.rel,
      action: body.action,
      detail: { layer },
    });
  });

  it('returns owner guard before malformed params and persists the same rejection', async () => {
    await exec({
      rel: 'threads',
      action: 'create',
      actor: 'human',
      principal: 'user:mike',
      params: { id: 'release-1', goal: 'Ship safely', goalSource: 'message:goal-1' },
    });
    const response = await exec({
      rel: 'thread:release-1',
      action: 'attach',
      actor: 'agent',
      principal: 'user:other',
      params: { category: 'invalid', rel: 'not a rel', extra: true },
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ layer: 'guard-failed' });
    expect((await readLog(pool)).at(-1)).toMatchObject({
      kind: 'action-rejected',
      detail: { layer: 'guard-failed' },
    });
  });
});
