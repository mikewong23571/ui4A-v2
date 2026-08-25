/**
 * activity 注册组合根:workflow 经 proxyActivities 按名调用。
 *
 * 按职责拆到 ./activities/ 子模块(notify / capability-artifacts / delegation /
 * agent-coding|writing|authoring / agent-registry);本文件保留 production runtime
 * transport 装配与 Agent Run 生命周期 activity 入口,公开签名不变。
 */
import type { ProductionDeploymentConfig } from '@ui4a/shared';

import type {
  AgentExecuteActivityArgs,
  AgentFinalizeInput,
  AgentRunWorkflowArgs,
} from './agents/host/contracts';
import {
  createHttpRunnerExecutionPortForCompiledTransport,
  createProductionAgentRunActivities,
} from './runtime-backends/production-wiring';
import { createInClusterKubernetesRuntimeTransportFromEnvironment } from './runtime-backends/kubernetes/runtime-transport';
import { productionAgentActivityConfig } from './activities/production-config';
import {
  runtimeSpecializationPorts,
  specializationBindingForTask,
} from './activities/agent-registry';
import type { AgentCollectActivityArgs, AgentVerifyActivityArgs } from './activities/agent-shared';

export { workerDb } from './worker-db';
export {
  deliverNotification,
  notify,
  type NotificationDeliveredDetail,
  type NotifyActivities,
} from './activities/notify';
export {
  materializeCapabilityArtifact,
  type CapabilityArtifactInput,
} from './activities/capability-artifacts';
export {
  agentStep,
  agentStepWithProductionAuth,
  finishDelegation,
  loadSitemap,
  loadSitemapWithProductionAuth,
  ProductionAgentActivityAuthenticationError,
  startDelegation,
  type DelegationActivities,
  type ProductionAgentActivityDeps,
} from './activities/delegation';
export {
  recordAgentRunResolution,
  recordAgentRunSuspension,
  specializationAdapterForTask,
} from './activities/agent-registry';
export type { AgentSpecializationAdapter } from './activities/agent-shared';

function hostRunnerOrigins(environment: NodeJS.ProcessEnv): Record<string, string> {
  const source = environment.UI4A_HOST_RUNNER_ORIGINS;
  if (source === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('production_host_runner_origins_invalid');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('production_host_runner_origins_invalid');
  }
  const origins = value as Record<string, unknown>;
  if (
    Object.keys(origins).length === 0 ||
    Object.values(origins).some((origin) => typeof origin !== 'string' || origin === '')
  ) {
    throw new Error('production_host_runner_origins_invalid');
  }
  return origins as Record<string, string>;
}

function productionAgentRunActivities(config: ProductionDeploymentConfig) {
  const runnerArtifactImage = process.env.UI4A_RUNNER_IMAGE;
  if (runnerArtifactImage === undefined || runnerArtifactImage === '') {
    throw new Error('production_runner_image_missing');
  }
  const origins = hostRunnerOrigins(process.env);
  const transport = createHttpRunnerExecutionPortForCompiledTransport({
    fetchImpl: fetch,
    timeoutMs: 30_000,
    endpoint(envelope) {
      const profile = config.settings.runtime.profiles.find(
        (candidate) => candidate.id === envelope.execution.profileId,
      );
      if (
        profile === undefined ||
        profile.backend !== 'host' ||
        profile.runnerId !== envelope.execution.runnerId
      ) {
        throw new Error('runtime_profile_selection_invalid');
      }
      const origin = origins[profile.runnerId];
      if (origin === undefined) throw new Error('runtime_backend_unavailable:trusted-host');
      const token = config.secrets[profile.runnerTokenRef];
      if (token === undefined || token === '') {
        throw new Error('runtime_backend_unavailable:trusted-host');
      }
      return { origin, authorizationHeader: `Bearer ${token}` };
    },
  });
  const kubernetesTransport =
    config.settings.deploymentMode === 'kubernetes'
      ? createInClusterKubernetesRuntimeTransportFromEnvironment(
          process.env,
          Object.values(config.secrets),
        )
      : undefined;
  return createProductionAgentRunActivities({
    runtime: config.settings.runtime,
    runnerArtifactImage,
    transports: {
      'trusted-host': transport,
      ...(kubernetesTransport === undefined ? {} : { 'kubernetes-job': kubernetesTransport }),
    },
    specializations: runtimeSpecializationPorts(config),
  });
}

/** Select the birth-pinned specialization; task parameters cannot choose a Provider adapter. */
export async function prepareAgentRun(args: AgentRunWorkflowArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).prepareAgentRun(args);
  return specializationBindingForTask(args).prepare(args);
}

export async function executeAgentRun(args: AgentExecuteActivityArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).executeAgentRun(args);
  return specializationBindingForTask(args.context).execute(args);
}

export async function collectAgentRun(args: AgentCollectActivityArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).collectAgentRun(args);
  return specializationBindingForTask(args.context).collect(args);
}

export async function verifyAgentRun(args: AgentVerifyActivityArgs) {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).verifyAgentRun(args);
  return specializationBindingForTask(args.context).verify(args);
}

export async function finalizeAgentRun(input: AgentFinalizeInput): Promise<void> {
  const config = productionAgentActivityConfig();
  if (config !== undefined) return productionAgentRunActivities(config).finalizeAgentRun(input);
  return specializationBindingForTask(input.context).finalize(input);
}
