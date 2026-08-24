import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  getLocalPool: vi.fn(),
  getProductionPool: vi.fn(),
}));

vi.mock('../production-deployment-preflight', () => ({
  runWebProductionDeploymentPreflight: mocks.preflight,
}));
vi.mock('../db/pool', () => ({ getPool: mocks.getLocalPool }));
vi.mock('../db/production-pool', () => ({ getProductionPool: mocks.getProductionPool }));

import { getDb } from './service';

describe('T22 Web database production composition', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://local-only.invalid/ui4a');
    mocks.preflight.mockReset();
    mocks.getLocalPool.mockReset();
    mocks.getProductionPool.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('uses only canonical preflight settings and Secrets in production', () => {
    const config = { settings: { postgres: {} }, secrets: {} };
    const expected = { query: vi.fn() };
    mocks.preflight.mockReturnValue(config);
    mocks.getProductionPool.mockReturnValue(expected);

    expect(getDb()).toBe(expected);
    expect(mocks.getProductionPool).toHaveBeenCalledWith(config);
    expect(mocks.getLocalPool).not.toHaveBeenCalled();
  });

  it('preserves the existing DATABASE_URL local/test compatibility path', () => {
    const expected = { query: vi.fn() };
    mocks.preflight.mockReturnValue(undefined);
    mocks.getLocalPool.mockReturnValue(expected);

    expect(getDb()).toBe(expected);
    expect(mocks.getLocalPool).toHaveBeenCalledWith('postgres://local-only.invalid/ui4a');
    expect(mocks.getProductionPool).not.toHaveBeenCalled();
  });
});
