import { beforeEach, describe, expect, it } from 'vitest';

import { PRESENCE_MAX_EVENTS_PER_WINDOW } from '@ui4a/shared';

import { appendPresenceChange, ensurePresenceTables } from '@ui4a/db/presence';
import { getPool } from '@ui4a/db/pool';
import { resetEngineForTests } from '../../../engine/service';

import { POST } from './route';

// POST /api/presence 频率上限合同测试(T31 R2 ←T29 红线"频率上限入合同测试"
// 的 route 层):真实 handler + 真库。身份沿用本地 profile 的既有 header 方案
// (x-ui4a-principal,见 events/route.test.ts),不做 scope 口径断言(R10 范畴)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const LIMIT = PRESENCE_MAX_EVENTS_PER_WINDOW;

function post(principal: string, value: string): Request {
  return new Request('http://localhost:3100/api/presence', {
    method: 'POST',
    headers: { 'x-ui4a-principal': principal },
    body: JSON.stringify({ schemaVersion: 1, kind: 'thread', value }),
  });
}

async function fillBudget(principal: string): Promise<void> {
  for (let index = 0; index < LIMIT; index += 1) {
    await appendPresenceChange(
      pool,
      { schemaVersion: 1, kind: 'thread', value: `thread:case-${index}` },
      { principal, actor: 'human', channel: 'test' },
    );
  }
}

beforeEach(async () => {
  await ensurePresenceTables(pool);
  await pool.query('TRUNCATE events, presence_current');
  resetEngineForTests();
});

describe('POST /api/presence rate-limit contract', () => {
  it('returns 200 with the appendPresenceChange result shape below the budget', async () => {
    const response = await POST(post('rl-route-open', 'thread:first'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      changed: boolean;
      seq?: number;
      presence: { principal: string; thread: string | null };
    };
    expect(body.changed).toBe(true);
    expect(typeof body.seq).toBe('number');
    expect(body.presence).toMatchObject({ principal: 'rl-route-open', thread: 'thread:first' });
  });

  it(
    'maps an exhausted budget to HTTP 429 with code presence_rate_limited',
    { timeout: 60_000 },
    async () => {
      await fillBudget('rl-route-cap');
      const response = await POST(post('rl-route-cap', `thread:case-${LIMIT}`));
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: { code: 'presence_rate_limited' } });
    },
  );

  it('keeps the 429 scoped to the exhausted principal only', { timeout: 60_000 }, async () => {
    await fillBudget('rl-route-a');
    const unaffected = await POST(post('rl-route-b', 'thread:case-0'));
    expect(unaffected.status).toBe(200);
    const exhausted = await POST(post('rl-route-a', `thread:case-${LIMIT}`));
    expect(exhausted.status).toBe(429);
  });
});
