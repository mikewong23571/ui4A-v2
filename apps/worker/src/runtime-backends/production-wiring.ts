import { createHash } from 'node:crypto';

import { canonicalJson } from '@ui4a/engine';
import type { ProductionDeploymentSettings, ProductionRuntimeProfile } from '@ui4a/shared';

import type {
  AgentCollectedResult,
  AgentExecuteActivityArgs,
  AgentExecutionCompleted,
  AgentExecutionResult,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentRunWorkflowArgs,
  AgentVerificationResult,
} from '../agents/host/contracts';
import type { SealedRunnerEnvelope } from './backend';
import { createHttpRunnerExecutionPort } from './http-runner-execution';

export type ProductionRuntimeSpecialization = 'coding' | 'writing' | 'authoring';
export type ProductionRuntimeBackend = 'kubernetes-job' | 'trusted-host';

export interface CompiledRuntimeTransportRequest {
  schemaVersion: 1;
  compiledHash: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  outputSchema: unknown;
  sandboxMode: 'read-only' | 'workspace-write';
}

export interface CompiledRuntimeTransportEnvelope {
  schemaVersion: 1;
  runId: string;
  specialization: ProductionRuntimeSpecialization;
  birth: AgentRunWorkflowArgs['birth'];
  request: CompiledRuntimeTransportRequest;
  execution: {
    profileId: string;
    backend: ProductionRuntimeBackend;
    runnerId?: string;
    image: string;
    workspace: { rootRef: string };
    resources: { cpu: string; memory: string; timeoutMs: number };
    networkPolicy: 'restricted';
    credentialRefs: string[];
  };
}

export interface CompiledRuntimeTransportResult {
  schemaVersion: 1;
  runId: string;
  birth: AgentRunWorkflowArgs['birth'];
  nativeSessionId: string;
  result: unknown;
  events: unknown[];
}

export interface ProductionRuntimeTransportPort {
  kind: ProductionRuntimeBackend;
  execute(input: {
    envelope: CompiledRuntimeTransportEnvelope;
    signal: AbortSignal;
    reportProgress(cursor: string | null, event: unknown): void;
  }): Promise<CompiledRuntimeTransportResult>;
}

export interface ProductionRuntimeSpecializationPort {
  taskKind: string;
  prepare(context: AgentRunWorkflowArgs): Promise<AgentPreparedResult>;
  compile?(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
  }): Promise<CompiledRuntimeTransportRequest>;
  accept?(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    result: CompiledRuntimeTransportResult;
  }): Promise<AgentExecutionResult>;
  collect(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  }): Promise<AgentCollectedResult>;
  verify(input: {
    context: AgentRunWorkflowArgs;
    collected: AgentCollectedResult;
  }): Promise<AgentVerificationResult> | AgentVerificationResult;
  finalize(input: AgentFinalizeInput): Promise<void>;
  executeProduction?(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    profile: ProductionRuntimeProfile;
    transport: ProductionRuntimeTransportPort;
    runnerArtifactImage: string;
    controls: ProductionExecutionControls;
  }): Promise<AgentExecutionResult>;
}

export interface ProductionExecutionControls {
  signal: AbortSignal;
  reportProgress(cursor: string | null, event: unknown): void;
}

export interface ProductionAgentRunActivities {
  prepareAgentRun(context: AgentRunWorkflowArgs): Promise<AgentPreparedResult>;
  executeAgentRun(
    input: AgentExecuteActivityArgs,
    controls?: ProductionExecutionControls,
  ): Promise<AgentExecutionResult>;
  collectAgentRun(input: {
    context: AgentRunWorkflowArgs;
    prepared: AgentPreparedResult;
    execution: AgentExecutionCompleted;
  }): Promise<AgentCollectedResult>;
  verifyAgentRun(input: {
    context: AgentRunWorkflowArgs;
    collected: AgentCollectedResult;
  }): Promise<AgentVerificationResult>;
  finalizeAgentRun(input: AgentFinalizeInput): Promise<void>;
}

interface ProductionAgentRunActivityOptions {
  runtime: ProductionDeploymentSettings['runtime'];
  runnerArtifactImage: string;
  transports: Partial<Record<ProductionRuntimeBackend, ProductionRuntimeTransportPort>>;
  specializations: Record<ProductionRuntimeSpecialization, ProductionRuntimeSpecializationPort>;
}

const forbiddenRequestFields = ['backend', 'provider', 'model', 'cwd', 'env'] as const;
const imagePattern = /@sha256:[0-9a-f]{64}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

function taskPayload(context: AgentRunWorkflowArgs): Record<string, unknown> {
  const payload = context.task.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('runtime_request_invalid');
  }
  return payload as Record<string, unknown>;
}

function assertNoRequestOverrides(context: AgentRunWorkflowArgs): void {
  const payload = taskPayload(context);
  for (const field of forbiddenRequestFields) {
    if (Object.hasOwn(payload, field)) throw new Error(`runtime_request_forbidden_field:${field}`);
  }
}

function specializationFor(
  context: AgentRunWorkflowArgs,
  specializations: ProductionAgentRunActivityOptions['specializations'],
): { kind: ProductionRuntimeSpecialization; port: ProductionRuntimeSpecializationPort } {
  const kind = taskPayload(context).kind;
  const matches = (
    Object.entries(specializations) as Array<
      [ProductionRuntimeSpecialization, ProductionRuntimeSpecializationPort]
    >
  ).filter(([, port]) => port.taskKind === kind);
  if (matches.length !== 1) throw new Error('runtime_specialization_unavailable');
  return { kind: matches[0]![0], port: matches[0]![1] };
}

function profileFor(
  runtime: ProductionDeploymentSettings['runtime'],
  specialization: ProductionRuntimeSpecialization,
): ProductionRuntimeProfile {
  const id = runtime.defaultProfiles[specialization];
  const matches = runtime.profiles.filter(
    (profile) => profile.id === id && profile.specialization === specialization,
  );
  if (matches.length !== 1) throw new Error('runtime_profile_selection_invalid');
  return matches[0]!;
}

function backendFor(profile: ProductionRuntimeProfile): ProductionRuntimeBackend {
  return profile.backend === 'host' ? 'trusted-host' : 'kubernetes-job';
}

function validateCompiledRequest(value: CompiledRuntimeTransportRequest): void {
  if (
    value.schemaVersion !== 1 ||
    !digestPattern.test(value.compiledHash) ||
    !Array.isArray(value.messages) ||
    value.messages.length === 0 ||
    value.messages.some(
      (message) =>
        !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string',
    ) ||
    !['read-only', 'workspace-write'].includes(value.sandboxMode)
  ) {
    throw new Error('runtime_compiled_transport_invalid');
  }
}

function transportEnvelope(input: {
  context: AgentRunWorkflowArgs;
  request: CompiledRuntimeTransportRequest;
  profile: ProductionRuntimeProfile;
  runnerArtifactImage: string;
}): CompiledRuntimeTransportEnvelope {
  const { profile } = input;
  const image = profile.backend === 'kubernetes' ? profile.image : input.runnerArtifactImage;
  if (!imagePattern.test(image)) throw new Error('runtime_profile_invalid');
  const timeoutMs = profile.timeoutSeconds * 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('runtime_profile_invalid');
  return structuredClone({
    schemaVersion: 1,
    runId: input.context.runId,
    specialization: profile.specialization,
    birth: input.context.birth,
    request: input.request,
    execution: {
      profileId: profile.id,
      backend: backendFor(profile),
      ...(profile.backend === 'host' ? { runnerId: profile.runnerId } : {}),
      image,
      workspace: { rootRef: profile.workspaceRoot },
      resources: { ...profile.resources, timeoutMs },
      networkPolicy: profile.networkPolicy,
      credentialRefs: [...profile.credentialRefs],
    },
  });
}

function validateTransportResult(
  result: CompiledRuntimeTransportResult,
  context: AgentRunWorkflowArgs,
): void {
  if (
    result.schemaVersion !== 1 ||
    result.runId !== context.runId ||
    canonicalJson(result.birth) !== canonicalJson(context.birth) ||
    typeof result.nativeSessionId !== 'string' ||
    result.nativeSessionId === '' ||
    !Array.isArray(result.events)
  ) {
    throw new Error('runtime_transport_result_scope_mismatch');
  }
}

/** Execute one already-compiled generic request through exactly one selected transport. */
export async function executeCompiledRuntimeTransport(input: {
  context: AgentRunWorkflowArgs;
  request: CompiledRuntimeTransportRequest;
  profile: ProductionRuntimeProfile;
  transport: ProductionRuntimeTransportPort;
  runnerArtifactImage: string;
  controls: ProductionExecutionControls;
}): Promise<CompiledRuntimeTransportResult> {
  validateCompiledRequest(input.request);
  const backend = backendFor(input.profile);
  if (input.transport.kind !== backend) {
    throw new Error(`runtime_backend_unavailable:${backend}`);
  }
  const envelope = transportEnvelope(input);
  const result = await input.transport.execute({
    envelope,
    signal: input.controls.signal,
    reportProgress: input.controls.reportProgress,
  });
  validateTransportResult(result, input.context);
  return result;
}

const defaultControls = (): ProductionExecutionControls => ({
  signal: new AbortController().signal,
  reportProgress: () => undefined,
});

/** Compose the actual Temporal activity surface around one deployment-owned Runtime selection. */
export function createProductionAgentRunActivities(
  options: ProductionAgentRunActivityOptions,
): ProductionAgentRunActivities {
  return {
    async prepareAgentRun(context) {
      assertNoRequestOverrides(context);
      return specializationFor(context, options.specializations).port.prepare(context);
    },
    async executeAgentRun(input, controls = defaultControls()) {
      assertNoRequestOverrides(input.context);
      const { kind, port } = specializationFor(input.context, options.specializations);
      const profile = profileFor(options.runtime, kind);
      if (input.context.birth.runtime.profileName !== profile.id) {
        throw new Error('runtime_birth_profile_mismatch');
      }
      const backend = backendFor(profile);
      const transport = options.transports[backend];
      if (transport === undefined || transport.kind !== backend) {
        throw new Error(`runtime_backend_unavailable:${backend}`);
      }
      if (port.executeProduction !== undefined) {
        return port.executeProduction({
          context: input.context,
          prepared: input.prepared,
          profile,
          transport,
          runnerArtifactImage: options.runnerArtifactImage,
          controls,
        });
      }
      if (port.compile === undefined || port.accept === undefined) {
        throw new Error('runtime_specialization_compile_unavailable');
      }
      const request = await port.compile({ context: input.context, prepared: input.prepared });
      const result = await executeCompiledRuntimeTransport({
        context: input.context,
        request,
        profile,
        transport,
        runnerArtifactImage: options.runnerArtifactImage,
        controls,
      });
      return port.accept({ context: input.context, prepared: input.prepared, result });
    },
    async collectAgentRun(input) {
      return specializationFor(input.context, options.specializations).port.collect(input);
    },
    async verifyAgentRun(input) {
      return specializationFor(input.context, options.specializations).port.verify(input);
    },
    async finalizeAgentRun(input) {
      return specializationFor(input.context, options.specializations).port.finalize(input);
    },
  };
}

interface HttpRunnerEndpoint {
  origin: string;
  authorizationHeader: string;
}

interface HttpRunnerExecutionOptions {
  endpoint(envelope: CompiledRuntimeTransportEnvelope): HttpRunnerEndpoint;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

function canonicalOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('runtime_http_origin_invalid');
  }
  if (url.protocol !== 'https:' || value !== url.origin) {
    throw new Error('runtime_http_origin_invalid');
  }
  return value;
}

function backendBirth(birth: AgentRunWorkflowArgs['birth']): SealedRunnerEnvelope['birth'] {
  return {
    definitionRef: `${birth.definition.ref}@${birth.definition.version}`,
    definitionHash: birth.definition.flattenedHash,
    promptHash: birth.prompt.compiledHash,
    runtimeHash: `sha256:${createHash('sha256').update(canonicalJson(birth.runtime)).digest('hex')}`,
    taskContractHash: birth.taskContract.hash,
    resultContractHash: birth.resultContract.hash,
  };
}

function runnerEnvelope(envelope: CompiledRuntimeTransportEnvelope): {
  deliveryId: string;
  envelope: SealedRunnerEnvelope;
} {
  const deliveryId = `delivery:${envelope.runId}:${envelope.execution.profileId}`;
  return {
    deliveryId,
    envelope: {
      schemaVersion: 1,
      runId: envelope.runId,
      specialization: envelope.specialization,
      birth: backendBirth(envelope.birth),
      task: {
        contractRef: 'generic-codex-transport@1',
        payload: structuredClone(envelope.request),
        contextRefs: [],
      },
      execution: {
        profileId: envelope.execution.profileId,
        backend: envelope.execution.backend,
        image: envelope.execution.image,
        workspace: {
          rootRef: envelope.execution.workspace.rootRef,
          retention: 'until-human-decision',
        },
        resources: {
          cpu: envelope.execution.resources.cpu,
          memory: envelope.execution.resources.memory,
          timeoutSeconds: envelope.execution.resources.timeoutMs / 1_000,
        },
        networkPolicy: envelope.execution.networkPolicy,
        credentialRefs: [...envelope.execution.credentialRefs],
        // These fields scope the in-process HTTP adapter only. RunnerDeliveryWire deliberately
        // omits them, so no synthetic timestamp becomes durable Runner or Agent Run evidence.
        leaseId: `lease:${deliveryId}`,
        issuedAt: '1970-01-01T00:00:00.000Z',
      },
    },
  };
}

function compiledCandidate(
  candidate: unknown,
  envelope: CompiledRuntimeTransportEnvelope,
): CompiledRuntimeTransportResult {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error('runtime_http_result_invalid');
  }
  const value = candidate as Record<string, unknown>;
  if (
    Object.keys(value).length !== 4 ||
    value.schemaVersion !== 1 ||
    typeof value.nativeSessionId !== 'string' ||
    value.nativeSessionId === '' ||
    !Object.hasOwn(value, 'result') ||
    !Array.isArray(value.events)
  ) {
    throw new Error('runtime_http_result_invalid');
  }
  return {
    schemaVersion: 1,
    runId: envelope.runId,
    birth: structuredClone(envelope.birth),
    nativeSessionId: value.nativeSessionId,
    result: structuredClone(value.result),
    events: structuredClone(value.events),
  };
}

/** Authenticated compiled-transport HTTP port used by trusted Host and Compose Runner profiles. */
export function createHttpRunnerExecutionPortForCompiledTransport(
  options: HttpRunnerExecutionOptions,
): ProductionRuntimeTransportPort {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error('runtime_http_timeout_invalid');
  }
  return {
    kind: 'trusted-host',
    async execute(input) {
      const endpoint = options.endpoint(input.envelope);
      const origin = canonicalOrigin(endpoint.origin);
      const mapped = runnerEnvelope(input.envelope);
      const port = createHttpRunnerExecutionPort({
        origin,
        authorizationHeader: endpoint.authorizationHeader,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
      const execution = await port.execute({
        envelope: mapped.envelope,
        handle: mapped.deliveryId,
        signal: input.signal,
        heartbeat: (cursor) => input.reportProgress(cursor, { kind: 'runner-heartbeat' }),
      });
      const collected = await port.collect({ envelope: mapped.envelope, execution });
      const result = compiledCandidate(collected.candidate, input.envelope);
      for (const [index, event] of result.events.entries()) {
        input.reportProgress(String(index + 1), event);
      }
      return result;
    },
  };
}
