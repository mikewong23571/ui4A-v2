/**
 * Platform-neutral, fail-closed production deployment contract (T22)。
 * 自 production-deployment-config.ts 按配置域拆分(types/primitives/auth/postgres/
 * temporal/runtime/config/runner/environment),公开面经本模块原样汇聚,行为不变。
 */
export * from './types';
export { parseProductionDeploymentConfig } from './config';
export { parseProductionRunnerDeploymentConfig } from './runner';
export {
  preflightProductionDeploymentFromEnvironment,
  preflightProductionRunnerFromEnvironment,
  productionDeploymentConfigFromHelmValues,
} from './environment';
