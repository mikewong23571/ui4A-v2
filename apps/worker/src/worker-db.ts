import type { DeploymentEnvironment, ProductionDeploymentConfig } from '@ui4a/shared';

import type { DbExecutor } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { getProductionPool } from '@ui4a/db/production-pool';
import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';

const DEFAULT_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a';

/** Select canonical production Pool only after preflight; otherwise use the local/test DATABASE_URL pool. */
export function workerDb(
  environment: DeploymentEnvironment = process.env,
  productionConfig: ProductionDeploymentConfig | undefined = runWorkerProductionDeploymentPreflight(
    environment,
  ),
): DbExecutor {
  return productionConfig === undefined
    ? getPool(environment.DATABASE_URL ?? DEFAULT_DATABASE_URL)
    : getProductionPool(productionConfig);
}
