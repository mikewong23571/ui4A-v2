import type { ProductionDeploymentConfig } from '@ui4a/shared';

import { runWorkerProductionDeploymentPreflight } from '../production-deployment-preflight';

/** Production activity 配置入口:非 production 部署返回 undefined,缺配置即失败。 */
export function productionAgentActivityConfig(): ProductionDeploymentConfig | undefined {
  if (process.env.UI4A_DEPLOYMENT_PROFILE !== 'production') return undefined;
  const config = runWorkerProductionDeploymentPreflight(process.env);
  if (config === undefined) throw new Error('production_agent_activity_config_missing');
  return config;
}
