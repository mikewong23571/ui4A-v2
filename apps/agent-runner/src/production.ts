import { createHash, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { isAbsolute } from 'node:path';

import { Codex, type CodexOptions } from '@openai/codex-sdk';
import {
  preflightProductionRunnerFromEnvironment,
  type HostProductionRuntimeProfile,
  type KubernetesProductionRuntimeProfile,
  type ProductionDeploymentConfig,
  type ProductionDeploymentMode,
  type ProductionRuntimeProfile,
} from '@ui4a/shared';

import {
  createRunnerDeliveryProcessor,
  scheduleRunnerTimeout,
  type RunnerDelivery,
  type RunnerDeliveryProcessor,
} from './process.js';
import {
  executeCodex,
  matchingProfile,
  parseCompiledRequest,
  record,
  type RunnerCodexSdk,
} from './production-codex.js';
import {
  startResponsesLoopbackAdapter,
  type ResponsesLoopbackAdapterOptions,
} from './responses-loopback-adapter.js';
import {
  runDaemon,
  type RunnerBackendReadinessProvider,
  type RunnerDaemonOptions,
  type RunnerDeliveryAuthorizer,
} from './runtime.js';

export type { RunnerCodexSdk, RunnerCodexThread } from './production-codex.js';

const imagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._/:~-]*@sha256:[0-9a-f]{64}$/;
const bearerTokenPattern = /^[A-Za-z0-9._~+/-]+=*$/;

export interface ProductionRunnerComposition {
  deploymentMode: ProductionDeploymentMode;
  processor: RunnerDeliveryProcessor;
  authorizeDelivery: RunnerDeliveryAuthorizer;
  backendReadiness: RunnerBackendReadinessProvider;
}

export interface ProductionRunnerDependencies {
  loadConfiguration?: (environment: NodeJS.ProcessEnv) => ProductionDeploymentConfig | undefined;
  createClient?: (options: CodexOptions) => RunnerCodexSdk;
  scheduleTimeout?: typeof scheduleRunnerTimeout;
  startResponsesAdapter?: (
    options: ResponsesLoopbackAdapterOptions,
  ) => ReturnType<typeof startResponsesLoopbackAdapter>;
}

function fail(): never {
  throw new Error('runner_production_config_invalid');
}

function defaultLoadConfiguration(
  environment: NodeJS.ProcessEnv,
): ProductionDeploymentConfig | undefined {
  return preflightProductionRunnerFromEnvironment(environment, (path) =>
    readFileSync(path, 'utf8'),
  );
}

function bearerAuthorizer(token: string): RunnerDeliveryAuthorizer {
  if (!bearerTokenPattern.test(token)) fail();
  const expected = createHash('sha256').update(`Bearer ${token}`, 'utf8').digest();
  return async (request: IncomingMessage): Promise<boolean> => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') return false;
    const actual = createHash('sha256').update(authorization, 'utf8').digest();
    return timingSafeEqual(actual, expected);
  };
}

/** Build the only production delivery composition; local mode deliberately remains unavailable. */
export function createProductionRunnerComposition(
  environment: NodeJS.ProcessEnv,
  dependencies: ProductionRunnerDependencies = {},
): ProductionRunnerComposition | undefined {
  const mode = environment.UI4A_DEPLOYMENT_PROFILE;
  if (mode === undefined || mode === '' || mode === 'local') return undefined;
  if (mode !== 'production') fail();
  let configuration: ProductionDeploymentConfig | undefined;
  try {
    configuration = (dependencies.loadConfiguration ?? defaultLoadConfiguration)(environment);
  } catch {
    fail();
  }
  const runnerImage = environment.UI4A_RUNNER_IMAGE;
  if (configuration === undefined || runnerImage === undefined || !imagePattern.test(runnerImage)) {
    fail();
  }
  const deploymentMode = configuration.settings.deploymentMode;
  let profiles: ProductionRuntimeProfile[];
  let authorizeDelivery: RunnerDeliveryAuthorizer;
  let deliveryAvailable: boolean;
  if (deploymentMode === 'compose') {
    const runnerId = environment.UI4A_RUNNER_ID;
    if (runnerId === undefined || runnerId === '') fail();
    profiles = configuration.settings.runtime.profiles.filter(
      (profile): profile is HostProductionRuntimeProfile =>
        profile.backend === 'host' && profile.runnerId === runnerId,
    );
    if (profiles.length === 0) fail();
    const runnerTokenRefs = new Set(
      profiles.map((profile) => (profile as HostProductionRuntimeProfile).runnerTokenRef),
    );
    if (runnerTokenRefs.size !== 1) fail();
    const runnerTokenRef = [...runnerTokenRefs][0]!;
    const runnerToken = configuration.secrets[runnerTokenRef];
    if (runnerToken === undefined || runnerToken === '') fail();
    authorizeDelivery = bearerAuthorizer(runnerToken);
    deliveryAvailable = true;
  } else if (deploymentMode === 'kubernetes') {
    const profileId = environment.UI4A_RUNNER_PROFILE_ID;
    if (profileId === undefined || profileId === '') fail();
    profiles = configuration.settings.runtime.profiles.filter(
      (profile): profile is KubernetesProductionRuntimeProfile =>
        profile.backend === 'kubernetes' &&
        profile.id === profileId &&
        profile.image === runnerImage,
    );
    // Kubernetes delivery is a sealed file in a one-shot Job. The long-running Deployment stays
    // fail-closed because no HTTP Runner bearer-token contract exists for this backend.
    authorizeDelivery = async () => false;
    deliveryAvailable = false;
  } else {
    fail();
  }
  if (profiles.length === 0) fail();
  const allowedSecretRefs = new Set<string>([configuration.settings.llm.apiKeyRef]);
  for (const profile of profiles) {
    for (const ref of profile.credentialRefs) allowedSecretRefs.add(ref);
    if (profile.backend === 'host') allowedSecretRefs.add(profile.runnerTokenRef);
  }
  if (
    Object.keys(configuration.secrets).some((ref) => !allowedSecretRefs.has(ref)) ||
    [...allowedSecretRefs].some((ref) => configuration?.secrets[ref] === undefined)
  ) {
    fail();
  }
  const apiKey = configuration.secrets[configuration.settings.llm.apiKeyRef];
  if (apiKey === undefined || apiKey === '') {
    fail();
  }
  for (const profile of profiles) {
    if (
      !profile.credentialRefs.includes(configuration.settings.llm.apiKeyRef) ||
      profile.credentialRefs.some((ref) => {
        const secret = configuration?.secrets[ref];
        return secret === undefined || secret === '';
      })
    ) {
      fail();
    }
  }

  const createClient =
    dependencies.createClient ?? ((options: CodexOptions): RunnerCodexSdk => new Codex(options));
  const commonProcessor = createRunnerDeliveryProcessor({
    async resolveSecrets(refs) {
      return Object.fromEntries(refs.map((ref) => [ref, configuration!.secrets[ref]!]));
    },
    async executor(delivery, context) {
      const profile = matchingProfile(delivery, profiles, runnerImage);
      const request = parseCompiledRequest(delivery);
      return executeCodex({
        delivery,
        request,
        profile,
        signal: context.signal,
        configuration: configuration!,
        resolvedSecrets: context.secrets,
        createClient,
        startResponsesAdapter: dependencies.startResponsesAdapter ?? startResponsesLoopbackAdapter,
      });
    },
    scheduleTimeout: dependencies.scheduleTimeout ?? scheduleRunnerTimeout,
  });
  const processor: RunnerDeliveryProcessor = {
    async execute(value, options) {
      try {
        const candidate = record(value);
        const request = record(candidate.request);
        const execution = record(candidate.execution);
        const delivery = value as RunnerDelivery;
        if (
          request.specialization === undefined ||
          execution.profileId === undefined ||
          !profiles.some(
            (profile) =>
              profile.id === execution.profileId &&
              profile.specialization === request.specialization,
          )
        ) {
          throw new Error('runner_execution_failed');
        }
        matchingProfile(delivery, profiles, runnerImage);
        parseCompiledRequest(delivery);
      } catch {
        throw new Error('runner_execution_failed');
      }
      return commonProcessor.execute(value, options);
    },
  };
  return {
    deploymentMode,
    processor,
    authorizeDelivery,
    backendReadiness: () => ({ registered: true, deliveryAvailable }),
  };
}

export interface ProductionRunnerOneshotAdapter {
  processor: RunnerDeliveryProcessor;
  readDelivery(environment: NodeJS.ProcessEnv): Promise<unknown>;
  signal?: AbortSignal;
}

function validateDeliveryFile(path: string): void {
  if (!isAbsolute(path)) throw new Error('runner_delivery_source_invalid');
  let facts;
  try {
    facts = lstatSync(path);
  } catch {
    throw new Error('runner_delivery_source_invalid');
  }
  if (!facts.isFile() || facts.isSymbolicLink() || facts.size < 1 || facts.size > 1024 * 1024) {
    throw new Error('runner_delivery_source_invalid');
  }
}

/** Default Kubernetes Job entry: one bounded sealed delivery file, same processor and executor. */
export function createProductionRunnerOneshotAdapter(
  environment: NodeJS.ProcessEnv,
  dependencies: ProductionRunnerDependencies = {},
): ProductionRunnerOneshotAdapter | undefined {
  const mode = environment.UI4A_DEPLOYMENT_PROFILE;
  if (mode === undefined || mode === '' || mode === 'local') return undefined;
  const path = environment.UI4A_RUNNER_DELIVERY_FILE;
  if (path === undefined || path === '') throw new Error('runner_delivery_source_invalid');
  validateDeliveryFile(path);
  const composition = createProductionRunnerComposition(environment, dependencies);
  if (composition?.deploymentMode !== 'kubernetes') {
    throw new Error('runner_delivery_source_invalid');
  }
  return {
    processor: composition.processor,
    async readDelivery() {
      validateDeliveryFile(path);
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
      } catch {
        throw new Error('runner_delivery_source_invalid');
      }
    },
  };
}

export interface ProductionDaemonDependencies extends ProductionRunnerDependencies {
  compose?: (environment: NodeJS.ProcessEnv) => ProductionRunnerComposition | undefined;
  runDaemon?: (environment: NodeJS.ProcessEnv, options?: RunnerDaemonOptions) => Promise<void>;
}

/** Default daemon entry used by main: production wires delivery, local remains honest 503. */
export async function runProductionDaemon(
  environment: NodeJS.ProcessEnv,
  dependencies: ProductionDaemonDependencies = {},
): Promise<void> {
  const composition =
    dependencies.compose?.(environment) ??
    createProductionRunnerComposition(environment, dependencies);
  const daemon = dependencies.runDaemon ?? runDaemon;
  if (composition === undefined) {
    await daemon(environment);
    return;
  }
  await daemon(environment, {
    deliveryProcessor: composition.processor,
    authorizeDelivery: composition.authorizeDelivery,
    backendReadiness: composition.backendReadiness,
  });
}
