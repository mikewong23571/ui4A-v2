import type { ReadinessResult } from '@ui4a/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getWebReadinessSnapshot: vi.fn() }));

vi.mock('../../../readiness/readiness', () => ({
  getWebReadinessSnapshot: mocks.getWebReadinessSnapshot,
}));

vi.mock('../../../db/pool', () => ({
  getPool: () => ({
    query: async () => {
      throw new Error('legacy health route must not reach a real database');
    },
  }),
}));

import { GET } from './route';

function snapshot(input: {
  readiness: 'ready' | 'not-ready';
  postgres: 'ok' | 'error';
  optionalFailure?: boolean;
}): ReadinessResult {
  const optionalFailure = input.optionalFailure === true;
  const postgresReady = input.postgres === 'ok';
  const reasonCodes = [
    ...(postgresReady ? [] : ['postgres_unavailable']),
    ...(optionalFailure ? ['temporal_unavailable'] : []),
  ].sort();
  return {
    schemaVersion: 1,
    component: 'ui4a-web',
    lifecycle: 'serving',
    status: input.readiness,
    health: reasonCodes.length === 0 ? 'ok' : 'degraded',
    reasonCodes,
    dependencies: {
      postgres: postgresReady
        ? { required: true, status: 'ok' }
        : { required: true, status: 'error', reasonCode: 'postgres_unavailable' },
      temporal: optionalFailure
        ? { required: false, status: 'error', reasonCode: 'temporal_unavailable' }
        : { required: false, status: 'ok' },
    },
  };
}

describe('GET /api/health', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['ready and healthy', snapshot({ readiness: 'ready', postgres: 'ok' }), 'ok', 'ok'],
    [
      'ready but optionally degraded',
      snapshot({ readiness: 'ready', postgres: 'ok', optionalFailure: true }),
      'degraded',
      'ok',
    ],
    ['not ready', snapshot({ readiness: 'not-ready', postgres: 'error' }), 'degraded', 'error'],
  ] as const)(
    'returns diagnostic HTTP 200 when Web is %s',
    async (_case, readiness, status, db) => {
      mocks.getWebReadinessSnapshot.mockResolvedValue(readiness);

      const response = await GET();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ...readiness,
        readiness: readiness.status,
        status,
        db,
      });
    },
  );
});
