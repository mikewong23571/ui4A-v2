import { readFileSync } from 'node:fs';

import type { ProductionDeploymentConfig } from '@ui4a/shared';
import { Pool, type PoolConfig } from 'pg';

export interface ProductionPoolDependencies<PoolType> {
  readFile(path: string): string;
  createPool(options: PoolConfig): PoolType;
}

const defaultDependencies: ProductionPoolDependencies<Pool> = {
  readFile: (path) => readFileSync(path, 'utf8'),
  createPool: (options) => new Pool(options),
};

/** Construct one bounded runtime-role Pool; error surfaces never include Secret or CA material. */
export function createProductionPool<PoolType = Pool>(
  config: ProductionDeploymentConfig,
  dependencies: ProductionPoolDependencies<PoolType> = defaultDependencies as ProductionPoolDependencies<PoolType>,
): PoolType {
  const { postgres } = config.settings;
  const password = config.secrets[postgres.runtimePasswordRef];
  if (password === undefined || password === '') {
    throw new Error('PRODUCTION_DATABASE_CREDENTIAL_UNAVAILABLE');
  }

  let ca: string;
  try {
    ca = dependencies.readFile(postgres.tls.caCertificatePath);
  } catch {
    throw new Error('PRODUCTION_DATABASE_CA_UNAVAILABLE');
  }
  if (ca === '') throw new Error('PRODUCTION_DATABASE_CA_UNAVAILABLE');

  try {
    return dependencies.createPool({
      host: postgres.host,
      port: postgres.port,
      database: postgres.database,
      user: postgres.runtimeUser,
      password,
      min: postgres.pool.min,
      max: postgres.pool.max,
      idleTimeoutMillis: postgres.pool.idleTimeoutMs,
      connectionTimeoutMillis: postgres.connectTimeoutMs,
      ssl: {
        ca,
        rejectUnauthorized: true,
        servername: postgres.host,
      },
    });
  } catch {
    throw new Error('PRODUCTION_DATABASE_POOL_UNAVAILABLE');
  }
}

let productionPool: Pool | undefined;

/** Process singleton used only after canonical production preflight has succeeded. */
export function getProductionPool(config: ProductionDeploymentConfig): Pool {
  if (productionPool === undefined) {
    const created = createProductionPool<Pool>(config);
    created.on('error', () => {});
    productionPool = created;
  }
  return productionPool;
}

export async function closeProductionPool(): Promise<void> {
  const pool = productionPool;
  productionPool = undefined;
  if (pool !== undefined) await pool.end();
}
