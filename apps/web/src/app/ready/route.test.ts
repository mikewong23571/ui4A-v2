import type { ReadinessResult } from '@ui4a/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getWebReadinessSnapshot: vi.fn() }));

vi.mock('../../readiness/readiness', () => ({
  getWebReadinessSnapshot: mocks.getWebReadinessSnapshot,
}));

import { GET } from './route';

function snapshot(status: 'ready' | 'not-ready'): ReadinessResult {
  const postgresReady = status === 'ready';
  return {
    schemaVersion: 1,
    component: 'ui4a-web',
    lifecycle: 'serving',
    status,
    health: postgresReady ? 'ok' : 'degraded',
    reasonCodes: postgresReady ? [] : ['postgres_unavailable'],
    dependencies: {
      postgres: postgresReady
        ? { required: true, status: 'ok' }
        : { required: true, status: 'error', reasonCode: 'postgres_unavailable' },
    },
  };
}

describe('GET /ready', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 only for a ready Web dependency snapshot', async () => {
    const expected = snapshot('ready');
    mocks.getWebReadinessSnapshot.mockResolvedValue(expected);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expected);
  });

  it('returns 503 with stable dependency evidence when Web is not ready', async () => {
    const expected = snapshot('not-ready');
    mocks.getWebReadinessSnapshot.mockResolvedValue(expected);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expected);
  });
});
