import { describe, expect, it, vi } from 'vitest';

interface ProductionPoolModule {
  createProductionPool(
    config: unknown,
    dependencies: {
      readFile(path: string): string;
      createPool(options: Record<string, unknown>): unknown;
    },
  ): unknown;
}

const plannedModulePath = './production-pool';

async function plannedApi(): Promise<ProductionPoolModule> {
  return (await import(plannedModulePath)) as ProductionPoolModule;
}

function productionConfig(secret = '__runtime_database_secret__') {
  return {
    settings: {
      postgres: {
        host: 'postgres.ui4a.svc.cluster.local',
        port: 5432,
        database: 'ui4a',
        runtimeUser: 'ui4a_runtime',
        runtimePasswordRef: 'postgres-runtime-password',
        pool: { min: 2, max: 20, idleTimeoutMs: 30_000 },
        connectTimeoutMs: 10_000,
        tls: {
          mode: 'verify-full',
          caCertificatePath: '/run/secrets/database-ca.crt',
        },
      },
    },
    secrets: { 'postgres-runtime-password': secret },
  };
}

describe('T22 production PostgreSQL Pool adapter', () => {
  it('passes the runtime Secret only to a bounded verify-full Pool constructor', async () => {
    const { createProductionPool } = await plannedApi();
    const pool = { query: vi.fn() };
    const createPool = vi.fn(() => pool);
    const readFile = vi.fn(() => '__test_ca_pem__');

    expect(createProductionPool(productionConfig(), { createPool, readFile })).toBe(pool);
    expect(readFile).toHaveBeenCalledWith('/run/secrets/database-ca.crt');
    expect(createPool).toHaveBeenCalledWith({
      host: 'postgres.ui4a.svc.cluster.local',
      port: 5432,
      database: 'ui4a',
      user: 'ui4a_runtime',
      password: '__runtime_database_secret__',
      min: 2,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: {
        ca: '__test_ca_pem__',
        rejectUnauthorized: true,
        servername: 'postgres.ui4a.svc.cluster.local',
      },
    });
    expect(JSON.stringify({ host: productionConfig().settings.postgres.host })).not.toContain(
      '__runtime_database_secret__',
    );
  });

  it('fails closed before Pool construction when the referenced Secret is missing', async () => {
    const { createProductionPool } = await plannedApi();
    const config = productionConfig();
    delete (config.secrets as Record<string, string>)['postgres-runtime-password'];
    const createPool = vi.fn();

    expect(() =>
      createProductionPool(config, { createPool, readFile: () => '__test_ca_pem__' }),
    ).toThrow('PRODUCTION_DATABASE_CREDENTIAL_UNAVAILABLE');
    expect(createPool).not.toHaveBeenCalled();
  });

  it('normalizes CA and Pool factory failures without exposing Secret material', async () => {
    const { createProductionPool } = await plannedApi();
    const secret = '__must_not_escape_pool_error__';

    for (const dependencies of [
      {
        readFile: () => {
          throw new Error(`read failed ${secret}`);
        },
        createPool: vi.fn(),
        expected: 'PRODUCTION_DATABASE_CA_UNAVAILABLE',
      },
      {
        readFile: () => '__test_ca_pem__',
        createPool: vi.fn(() => {
          throw new Error(`constructor failed ${secret}`);
        }),
        expected: 'PRODUCTION_DATABASE_POOL_UNAVAILABLE',
      },
    ]) {
      let error: unknown;
      try {
        createProductionPool(productionConfig(secret), dependencies);
      } catch (caught) {
        error = caught;
      }
      expect(error).toEqual(expect.objectContaining({ message: dependencies.expected }));
      expect(String(error)).not.toContain(secret);
    }
  });
});
