import { createHash, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { isAbsolute } from 'node:path';

import { Codex, type CodexOptions, type ThreadOptions } from '@openai/codex-sdk';
import {
  preflightProductionDeploymentFromEnvironment,
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
  runDaemon,
  type RunnerBackendReadinessProvider,
  type RunnerDaemonOptions,
  type RunnerDeliveryAuthorizer,
} from './runtime.js';

const imagePattern = /^[a-zA-Z0-9][a-zA-Z0-9._/:~-]*@sha256:[0-9a-f]{64}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const bearerTokenPattern = /^[A-Za-z0-9._~+/-]+=*$/;
const compiledFields = [
  'schemaVersion',
  'compiledHash',
  'messages',
  'outputSchema',
  'sandboxMode',
] as const;

interface CompiledCodexRequest {
  schemaVersion: 1;
  compiledHash: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  outputSchema: unknown;
  sandboxMode: 'read-only' | 'workspace-write';
}

export interface RunnerCodexThread {
  readonly id: string | null;
  runStreamed(
    input: string,
    options?: { outputSchema?: unknown; signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<unknown> }>;
}

export interface RunnerCodexSdk {
  startThread(options?: ThreadOptions): RunnerCodexThread;
}

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
}

function fail(): never {
  throw new Error('runner_production_config_invalid');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('runner_execution_failed');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === 'string') return secrets.some((secret) => value.includes(secret));
  if (Array.isArray(value)) return value.some((child) => containsSecret(child, secrets));
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).some((child) =>
    containsSecret(child, secrets),
  );
}

function parseCompiledRequest(delivery: RunnerDelivery): CompiledCodexRequest {
  if (delivery.request.task.contractRef !== 'generic-codex-transport@1') {
    throw new Error('runner_execution_failed');
  }
  const candidate = record(delivery.request.task.payload);
  if (
    !exactKeys(candidate, compiledFields) ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.compiledHash !== 'string' ||
    !digestPattern.test(candidate.compiledHash) ||
    candidate.compiledHash !== delivery.request.birth.promptHash ||
    !Array.isArray(candidate.messages) ||
    candidate.messages.length === 0 ||
    !['read-only', 'workspace-write'].includes(String(candidate.sandboxMode))
  ) {
    throw new Error('runner_execution_failed');
  }
  const messages = candidate.messages.map((value) => {
    const message = record(value);
    if (
      !exactKeys(message, ['role', 'content']) ||
      !['system', 'user', 'assistant'].includes(String(message.role)) ||
      typeof message.content !== 'string'
    ) {
      throw new Error('runner_execution_failed');
    }
    return {
      role: message.role,
      content: message.content,
    } as CompiledCodexRequest['messages'][number];
  });
  let outputSchema: unknown;
  try {
    outputSchema = structuredClone(candidate.outputSchema);
  } catch {
    throw new Error('runner_execution_failed');
  }
  return {
    schemaVersion: 1,
    compiledHash: candidate.compiledHash,
    messages,
    outputSchema,
    sandboxMode: candidate.sandboxMode as CompiledCodexRequest['sandboxMode'],
  };
}

function serializeMessages(messages: CompiledCodexRequest['messages']): string {
  return messages
    .flatMap((message, index) => [
      `<<<UI4A_COMPILED_MESSAGE_V1 role=${JSON.stringify(message.role)}>>>`,
      message.content,
      '<<<END_UI4A_COMPILED_MESSAGE_V1>>>',
      ...(index === messages.length - 1 ? [] : ['']),
    ])
    .join('\n');
}

function matchingProfile(
  delivery: RunnerDelivery,
  profiles: readonly ProductionRuntimeProfile[],
  runnerImage: string,
): ProductionRuntimeProfile {
  const matches = profiles.filter(
    (profile) =>
      profile.id === delivery.execution.profileId &&
      profile.specialization === delivery.request.specialization,
  );
  if (matches.length !== 1) throw new Error('runner_execution_failed');
  const profile = matches[0]!;
  const expectedBackend = profile.backend === 'host' ? 'trusted-host' : 'kubernetes-job';
  const expectedImage = profile.backend === 'host' ? runnerImage : profile.image;
  if (
    delivery.execution.backend !== expectedBackend ||
    delivery.execution.image !== expectedImage ||
    delivery.execution.workspace.rootRef !== profile.workspaceRoot ||
    delivery.execution.resources.cpu !== profile.resources.cpu ||
    delivery.execution.resources.memory !== profile.resources.memory ||
    delivery.execution.resources.timeoutMs !== profile.timeoutSeconds * 1_000 ||
    delivery.execution.networkPolicy !== profile.networkPolicy ||
    !sameStrings(delivery.execution.credentialRefs, profile.credentialRefs)
  ) {
    throw new Error('runner_execution_failed');
  }
  return profile;
}

function parseAgentResult(event: Record<string, unknown>): unknown | undefined {
  if (event.type !== 'item.completed') return undefined;
  const item = record(event.item);
  if (item.type !== 'agent_message' || typeof item.text !== 'string') return undefined;
  try {
    return JSON.parse(item.text) as unknown;
  } catch {
    throw new Error('runner_execution_failed');
  }
}

async function executeCodex(input: {
  delivery: RunnerDelivery;
  request: CompiledCodexRequest;
  profile: ProductionRuntimeProfile;
  signal: AbortSignal;
  configuration: ProductionDeploymentConfig;
  resolvedSecrets: Readonly<Record<string, string>>;
  createClient: (options: CodexOptions) => RunnerCodexSdk;
}): Promise<{
  candidate: { schemaVersion: 1; nativeSessionId: string; result: unknown; events: unknown[] };
  artifacts: [];
}> {
  const { settings } = input.configuration;
  const apiKey = input.resolvedSecrets[settings.llm.apiKeyRef];
  if (apiKey === undefined || apiKey === '') throw new Error('runner_execution_failed');
  const secretValues = Object.values(input.configuration.secrets).filter((value) => value !== '');
  if (containsSecret(input.request, secretValues)) throw new Error('runner_execution_failed');
  const client = input.createClient({
    baseUrl: settings.llm.baseUrl,
    apiKey,
    env: {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      LANG: 'C.UTF-8',
    },
  });
  const thread = client.startThread({
    model: settings.llm.model,
    workingDirectory: input.profile.workspaceRoot,
    skipGitRepoCheck: true,
    sandboxMode: input.request.sandboxMode,
    approvalPolicy: 'never',
    networkAccessEnabled: false,
  });
  const streamed = await thread.runStreamed(serializeMessages(input.request.messages), {
    outputSchema: input.request.outputSchema,
    signal: input.signal,
  });
  let nativeSessionId: string | undefined;
  let result: unknown;
  const events: unknown[] = [];
  for await (const value of streamed.events) {
    let event: Record<string, unknown>;
    try {
      event = structuredClone(record(value));
    } catch {
      throw new Error('runner_execution_failed');
    }
    events.push(event);
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      nativeSessionId = event.thread_id;
    }
    const parsed = parseAgentResult(event);
    if (parsed !== undefined) result = parsed;
    if (event.type === 'turn.failed' || event.type === 'error') {
      throw new Error('runner_execution_failed');
    }
  }
  nativeSessionId ??= thread.id ?? undefined;
  if (nativeSessionId === undefined || nativeSessionId === '' || result === undefined) {
    throw new Error('runner_execution_failed');
  }
  const candidate = { schemaVersion: 1 as const, nativeSessionId, result, events };
  if (containsSecret(candidate, secretValues)) throw new Error('runner_execution_failed');
  return { candidate, artifacts: [] };
}

function defaultLoadConfiguration(
  environment: NodeJS.ProcessEnv,
): ProductionDeploymentConfig | undefined {
  return preflightProductionDeploymentFromEnvironment(environment, (path) =>
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
    profiles = configuration.settings.runtime.profiles.filter(
      (profile): profile is KubernetesProductionRuntimeProfile =>
        profile.backend === 'kubernetes' && profile.image === runnerImage,
    );
    // Kubernetes delivery is a sealed file in a one-shot Job. The long-running Deployment stays
    // fail-closed because no HTTP Runner bearer-token contract exists for this backend.
    authorizeDelivery = async () => false;
    deliveryAvailable = false;
  } else {
    fail();
  }
  if (profiles.length === 0) fail();
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
