import { readFileSync } from 'node:fs';

import {
  preflightProductionDeploymentFromEnvironment,
  type DeploymentEnvironment,
  type DeploymentFileReader,
  type ProductionDeploymentConfig,
} from '@ui4a/shared';

/** Fail closed before a production Web server becomes ready; local demo remains unchanged. */
export function runWebProductionDeploymentPreflight(
  environment: DeploymentEnvironment = process.env,
  readFile: DeploymentFileReader = (path) => readFileSync(path, 'utf8'),
): ProductionDeploymentConfig | undefined {
  return preflightProductionDeploymentFromEnvironment(environment, readFile);
}
