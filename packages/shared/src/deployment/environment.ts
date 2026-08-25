/**
 * 环境变量/Helm values 入口(自 production-deployment-config.ts 按配置域拆出,行为不变)。
 * 平台中立:文件读取经 DeploymentFileReader 注入,不直接触 Node API。
 */
import { parseProductionDeploymentConfig } from './config';
import { parseProductionRunnerDeploymentConfig } from './runner';
import { exactObject, fail, identifier, object, string } from './primitives';
import {
  PRODUCTION_DEPLOYMENT_ENV,
  type DeploymentEnvironment,
  type DeploymentFileReader,
  type ProductionDeploymentConfig,
  type ProductionRunnerSelection,
} from './types';

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    fail(label, 'must contain valid JSON');
  }
}

function readSource(
  environment: DeploymentEnvironment,
  inlineName: string,
  fileName: string,
  label: string,
  readFile: DeploymentFileReader,
): unknown {
  const inline = environment[inlineName];
  const file = environment[fileName];
  if (inline !== undefined && file !== undefined) {
    fail(label, `configure exactly one of ${inlineName} or ${fileName}`);
  }
  if (inline === undefined && file === undefined) {
    fail(label, `configure one of ${inlineName} or ${fileName}`);
  }
  if (inline !== undefined) return parseJson(inline, label);
  const path = string(file, fileName);
  let content: string;
  try {
    content = readFile(path);
  } catch {
    fail(label, `could not read configured file ${path}`);
  }
  return parseJson(content, label);
}

/**
 * Explicit production startup gate. `NODE_ENV` is intentionally ignored: Next builds set it too.
 * Undefined or `local` preserves the existing local demo behavior.
 */
export function preflightProductionDeploymentFromEnvironment(
  environment: DeploymentEnvironment,
  readFile: DeploymentFileReader = () => fail('deploymentConfig', 'file reader is required'),
): ProductionDeploymentConfig | undefined {
  const profile = environment[PRODUCTION_DEPLOYMENT_ENV.profile];
  if (profile === undefined || profile === '' || profile === 'local') return undefined;
  if (profile !== 'production') {
    fail(PRODUCTION_DEPLOYMENT_ENV.profile, 'must be local or production');
  }
  const settings = readSource(
    environment,
    PRODUCTION_DEPLOYMENT_ENV.settingsJson,
    PRODUCTION_DEPLOYMENT_ENV.settingsFile,
    'settings',
    readFile,
  );
  const secrets = readSource(
    environment,
    PRODUCTION_DEPLOYMENT_ENV.secretsJson,
    PRODUCTION_DEPLOYMENT_ENV.secretsFile,
    'secrets',
    readFile,
  );
  return parseProductionDeploymentConfig({ settings, secrets });
}

export function preflightProductionRunnerFromEnvironment(
  environment: DeploymentEnvironment,
  readFile: DeploymentFileReader = () => fail('deploymentConfig', 'file reader is required'),
): ProductionDeploymentConfig | undefined {
  const profile = environment[PRODUCTION_DEPLOYMENT_ENV.profile];
  if (profile === undefined || profile === '' || profile === 'local') return undefined;
  if (profile !== 'production') {
    fail(PRODUCTION_DEPLOYMENT_ENV.profile, 'must be local or production');
  }
  const profileId = environment.UI4A_RUNNER_PROFILE_ID;
  const runnerId = environment.UI4A_RUNNER_ID;
  if ((profileId === undefined) === (runnerId === undefined)) {
    fail('runner.selection', 'configure exactly one server-owned profile or runner id');
  }
  const settings = readSource(
    environment,
    PRODUCTION_DEPLOYMENT_ENV.settingsJson,
    PRODUCTION_DEPLOYMENT_ENV.settingsFile,
    'settings',
    readFile,
  );
  const secrets = readSource(
    environment,
    PRODUCTION_DEPLOYMENT_ENV.secretsJson,
    PRODUCTION_DEPLOYMENT_ENV.secretsFile,
    'secrets',
    readFile,
  );
  const selection: ProductionRunnerSelection =
    profileId === undefined
      ? { backend: 'host', runnerId: identifier(runnerId, 'UI4A_RUNNER_ID') }
      : { backend: 'kubernetes', profileId: identifier(profileId, 'UI4A_RUNNER_PROFILE_ID') };
  return parseProductionRunnerDeploymentConfig({ settings, secrets }, selection);
}

/** Normalize the Helm values projection used by the chart into the same canonical parser input. */
export function productionDeploymentConfigFromHelmValues(
  values: unknown,
): ProductionDeploymentConfig {
  const root = object(values, 'values');
  const ui4a = object(root.ui4a, 'values.ui4a');
  const deploymentConfig = exactObject(ui4a.deploymentConfig, 'values.ui4a.deploymentConfig', [
    'settings',
    'secrets',
  ]);
  return parseProductionDeploymentConfig(deploymentConfig);
}
