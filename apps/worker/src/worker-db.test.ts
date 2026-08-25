import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  getLocalPool: vi.fn(),
  getProductionPool: vi.fn(),
}));

vi.mock('./production-deployment-preflight', () => ({
  runWorkerProductionDeploymentPreflight: mocks.preflight,
}));
vi.mock('../../web/src/db/pool', () => ({ getPool: mocks.getLocalPool }));
vi.mock('../../web/src/db/production-pool', () => ({
  getProductionPool: mocks.getProductionPool,
}));

interface WorkerDbModule {
  workerDb(environment?: Readonly<Record<string, string | undefined>>): unknown;
}

const plannedModulePath = './worker-db';

async function plannedApi(): Promise<WorkerDbModule> {
  return (await import(plannedModulePath)) as WorkerDbModule;
}

describe('T22 Worker database production composition', () => {
  beforeEach(() => {
    mocks.preflight.mockReset();
    mocks.getLocalPool.mockReset();
    mocks.getProductionPool.mockReset();
  });

  it('ignores DATABASE_URL and localhost fallback after production preflight', async () => {
    const { workerDb } = await plannedApi();
    const config = { settings: { postgres: {} }, secrets: {} };
    const expected = { query: vi.fn() };
    mocks.preflight.mockReturnValue(config);
    mocks.getProductionPool.mockReturnValue(expected);

    expect(
      workerDb({
        UI4A_DEPLOYMENT_PROFILE: 'production',
        DATABASE_URL: 'postgres://must-not-be-used.invalid/ui4a',
      }),
    ).toBe(expected);
    expect(mocks.getProductionPool).toHaveBeenCalledWith(config);
    expect(mocks.getLocalPool).not.toHaveBeenCalled();
  });

  it('preserves local/test DATABASE_URL pool selection', async () => {
    const { workerDb } = await plannedApi();
    const expected = { query: vi.fn() };
    mocks.preflight.mockReturnValue(undefined);
    mocks.getLocalPool.mockReturnValue(expected);

    expect(workerDb({ DATABASE_URL: 'postgres://local-only.invalid/ui4a' })).toBe(expected);
    expect(mocks.getLocalPool).toHaveBeenCalledWith('postgres://local-only.invalid/ui4a');
    expect(mocks.getProductionPool).not.toHaveBeenCalled();
  });
});
