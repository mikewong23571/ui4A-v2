import { readFileSync } from 'node:fs';

import {
  preflightProductionDeploymentFromEnvironment,
  type DeploymentEnvironment,
  type DeploymentFileReader,
  type ProductionDeploymentConfig,
} from '@ui4a/shared';

/** Fail closed before connecting a production Worker; local Temporal dev defaults remain intact. */
export function runWorkerProductionDeploymentPreflight(
  environment: DeploymentEnvironment = process.env,
  readFile: DeploymentFileReader = (path) => readFileSync(path, 'utf8'),
): ProductionDeploymentConfig | undefined {
  return preflightProductionDeploymentFromEnvironment(environment, readFile);
}
