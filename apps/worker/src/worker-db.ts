import type { DeploymentEnvironment, ProductionDeploymentConfig } from '@ui4a/shared';

import type { DbExecutor } from '../../web/src/db/events';
import { getPool } from '../../web/src/db/pool';
import { getProductionPool } from '../../web/src/db/production-pool';
import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';

const DEFAULT_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a';

/** Select canonical production Pool only after preflight; preserve local/test URL compatibility. */
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
