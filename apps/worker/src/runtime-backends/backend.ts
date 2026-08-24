import { createHash } from 'node:crypto';

import { canonicalJson } from '@ui4a/engine';

export type RuntimeSpecialization = 'coding' | 'writing' | 'authoring';
export type RuntimeBackendKind = 'kubernetes-job' | 'trusted-host';
export type RuntimeTransition = 'prepared' | 'executing' | 'collected' | 'verified' | 'finalized';

export interface RuntimeRequest {
  schemaVersion: 1;
  runId: string;
  specialization: RuntimeSpecialization;
  birth: {
    definitionRef: string;
    definitionHash: string;
    promptHash: string;
    runtimeHash: string;
    taskContractHash: string;
    resultContractHash: string;
  };
  task: { contractRef: string; payload: unknown; contextRefs: string[] };
}

export interface ServerRuntimeProfile {
  id: string;
  backend: RuntimeBackendKind;
  image: string;
  workspace: { rootRef: string; retention: 'until-human-decision' };
  resources: { cpu: string; memory: string; timeoutSeconds: number };
  networkPolicy: 'restricted';
  leaseDurationMs: number;
  heartbeatTimeoutMs: number;
}

export interface SealedRunnerEnvelope extends RuntimeRequest {
  execution: {
    profileId: string;
    backend: RuntimeBackendKind;
    image: string;
    workspace: ServerRuntimeProfile['workspace'];
    resources: ServerRuntimeProfile['resources'];
    networkPolicy: 'restricted';
    leaseId: string;
    issuedAt: string;
  };
}

export interface RuntimeCheckpoint {
  schemaVersion: 1;
  runId: string;
  profileId: string;
  backend: RuntimeBackendKind;
  leaseId: string;
  attempt: number;
  cursor: string | null;
  heartbeatAt: number;
  leaseExpiresAt: number;
}

export interface RuntimeBackendSpi {
  kind: RuntimeBackendKind;
  prepare(envelope: SealedRunnerEnvelope): Promise<{ handle: string }>;
  execute(
    envelope: SealedRunnerEnvelope,
    prepared: { handle: string },
    controls: {
      signal: AbortSignal;
      checkpoint?: RuntimeCheckpoint;
      heartbeat(cursor: string | null): void;
    },
  ): Promise<{ status: 'completed'; backendOutput: unknown; transport?: unknown }>;
  collect(
    envelope: SealedRunnerEnvelope,
    execution: { status: 'completed'; backendOutput: unknown; transport?: unknown },
  ): Promise<{ candidate: unknown; artifacts: Array<{ ref: string; hash: string }> }>;
}

export interface RuntimeSpecializationPort {
  verify(input: {
    envelope: SealedRunnerEnvelope;
    candidate: unknown;
    artifacts: Array<{ ref: string; hash: string }>;
  }): Promise<{ passed: true; evidence: unknown }>;
  finalize(input: { envelope: SealedRunnerEnvelope; resultHash: string }): Promise<void>;
}

export interface CanonicalRuntimeResult {
  schemaVersion: 1;
  runId: string;
  specialization: RuntimeSpecialization;
  status: 'succeeded';
  birth: RuntimeRequest['birth'];
  candidate: unknown;
  artifacts: Array<{ ref: string; hash: string }>;
  verification: unknown;
  resultHash: string;
}

export type RuntimeControlDecision =
  | { action: 'continue' | 'resume' }
  | { action: 'cancel'; reasonCode: 'cancel_requested' }
  | { action: 'timeout'; reasonCode: 'deadline_exceeded' }
  | {
      action: 'restart';
      reasonCode: 'runner_disconnected' | 'lease_expired' | 'heartbeat_stale';
      backend: RuntimeBackendKind;
      profileId: string;
      nextAttempt: number;
      fallbackAllowed: false;
    };

const REQUEST_FIELDS = ['schemaVersion', 'runId', 'specialization', 'birth', 'task'] as const;
const FORBIDDEN_REQUEST_FIELDS = [
  'provider',
  'model',
  'cwd',
  'env',
  'backend',
  'profile',
  'image',
  'workspace',
  'resources',
  'networkPolicy',
] as const;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IMAGE_PATTERN = /@sha256:[0-9a-f]{64}$/;

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(code);
  return value;
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(code);
  return Number(value);
}

function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw new Error('runtime_request_invalid');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateRequest(value: unknown): RuntimeRequest {
  const candidate = record(value, 'runtime_request_invalid');
  for (const field of FORBIDDEN_REQUEST_FIELDS) {
    if (Object.hasOwn(candidate, field))
      throw new Error(`runtime_request_forbidden_field:${field}`);
  }
  if (
    Object.keys(candidate).some((field) => !(REQUEST_FIELDS as readonly string[]).includes(field))
  ) {
    throw new Error('runtime_request_invalid');
  }
  if (candidate.schemaVersion !== 1) throw new Error('runtime_request_invalid');
  const runId = nonEmptyString(candidate.runId, 'runtime_request_invalid');
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(runId)) {
    throw new Error('runtime_request_invalid');
  }
  if (!['coding', 'writing', 'authoring'].includes(String(candidate.specialization))) {
    throw new Error('runtime_request_invalid');
  }
  const birth = record(candidate.birth, 'runtime_request_invalid');
  const birthFields = [
    'definitionRef',
    'definitionHash',
    'promptHash',
    'runtimeHash',
    'taskContractHash',
    'resultContractHash',
  ] as const;
  if (
    Object.keys(birth).length !== birthFields.length ||
    birthFields.some((field) => !Object.hasOwn(birth, field))
  ) {
    throw new Error('runtime_request_invalid');
  }
  nonEmptyString(birth.definitionRef, 'runtime_request_invalid');
  for (const field of birthFields.slice(1)) {
    if (!DIGEST_PATTERN.test(nonEmptyString(birth[field], 'runtime_request_invalid'))) {
      throw new Error('runtime_request_invalid');
    }
  }
  const task = record(candidate.task, 'runtime_request_invalid');
  if (
    Object.keys(task).length !== 3 ||
    !Object.hasOwn(task, 'contractRef') ||
    !Object.hasOwn(task, 'payload') ||
    !Array.isArray(task.contextRefs) ||
    task.contextRefs.some((ref) => typeof ref !== 'string' || ref === '')
  ) {
    throw new Error('runtime_request_invalid');
  }
  nonEmptyString(task.contractRef, 'runtime_request_invalid');
  return deepClone(candidate) as unknown as RuntimeRequest;
}

function validateProfile(profile: ServerRuntimeProfile): ServerRuntimeProfile {
  if (
    profile.id === '' ||
    !['kubernetes-job', 'trusted-host'].includes(profile.backend) ||
    !IMAGE_PATTERN.test(profile.image) ||
    profile.workspace.rootRef === '' ||
    profile.workspace.retention !== 'until-human-decision' ||
    profile.resources.cpu === '' ||
    profile.resources.memory === '' ||
    !Number.isSafeInteger(profile.resources.timeoutSeconds) ||
    profile.resources.timeoutSeconds < 1 ||
    profile.networkPolicy !== 'restricted'
  ) {
    throw new Error('runtime_profile_invalid');
  }
  positiveInteger(profile.leaseDurationMs, 'runtime_profile_invalid');
  positiveInteger(profile.heartbeatTimeoutMs, 'runtime_profile_invalid');
  return deepClone(profile);
}

/** Resolve an untrusted task against one exact server-selected profile and freeze the result. */
export function sealRuntimeEnvelope(input: {
  request: unknown;
  profile: ServerRuntimeProfile;
  leaseId: string;
  issuedAt: string;
}): SealedRunnerEnvelope {
  const request = validateRequest(input.request);
  const profile = validateProfile(input.profile);
  const leaseId = nonEmptyString(input.leaseId, 'runtime_lease_invalid');
  const issuedAt = nonEmptyString(input.issuedAt, 'runtime_issued_at_invalid');
  const time = new Date(issuedAt);
  if (!Number.isFinite(time.valueOf()) || time.toISOString() !== issuedAt) {
    throw new Error('runtime_issued_at_invalid');
  }
  return deepFreeze({
    ...request,
    execution: {
      profileId: profile.id,
      backend: profile.backend,
      image: profile.image,
      workspace: profile.workspace,
      resources: profile.resources,
      networkPolicy: profile.networkPolicy,
      leaseId,
      issuedAt,
    },
  });
}

function sortedArtifacts(
  artifacts: Array<{ ref: string; hash: string }>,
): Array<{ ref: string; hash: string }> {
  const detached = deepClone(artifacts);
  for (const artifact of detached) {
    if (artifact.ref === '' || !DIGEST_PATTERN.test(artifact.hash)) {
      throw new Error('runtime_artifact_invalid');
    }
  }
  detached.sort((left, right) =>
    left.ref === right.ref ? compareText(left.hash, right.hash) : compareText(left.ref, right.ref),
  );
  return detached;
}

/** Build the backend-independent result used by Agent Run ingress and specialization finalizers. */
export function canonicalizeRuntimeResult(input: {
  envelope: SealedRunnerEnvelope;
  candidate: unknown;
  artifacts: Array<{ ref: string; hash: string }>;
  verification: unknown;
  transport?: unknown;
}): CanonicalRuntimeResult {
  const semantic = {
    schemaVersion: 1 as const,
    runId: input.envelope.runId,
    specialization: input.envelope.specialization,
    status: 'succeeded' as const,
    birth: deepClone(input.envelope.birth),
    candidate: deepClone(input.candidate),
    artifacts: sortedArtifacts(input.artifacts),
    verification: deepClone(input.verification),
  };
  const resultHash = `sha256:${createHash('sha256').update(canonicalJson(semantic)).digest('hex')}`;
  return deepFreeze({ ...semantic, resultHash });
}

function checkpointMatches(
  checkpoint: RuntimeCheckpoint,
  envelope: SealedRunnerEnvelope,
  attempt: number,
): boolean {
  return (
    checkpoint.schemaVersion === 1 &&
    checkpoint.runId === envelope.runId &&
    checkpoint.profileId === envelope.execution.profileId &&
    checkpoint.backend === envelope.execution.backend &&
    checkpoint.leaseId === envelope.execution.leaseId &&
    checkpoint.attempt === attempt - 1 &&
    (checkpoint.cursor === null || typeof checkpoint.cursor === 'string') &&
    Number.isFinite(checkpoint.heartbeatAt) &&
    Number.isFinite(checkpoint.leaseExpiresAt)
  );
}

/** Execute the specialization-neutral common lifecycle against exactly one selected backend. */
export async function runRuntimeBackendLifecycle(input: {
  request: unknown;
  profile: ServerRuntimeProfile;
  leaseId: string;
  issuedAt: string;
  attempt: number;
  checkpoint?: RuntimeCheckpoint;
  signal: AbortSignal;
  backends: Partial<Record<RuntimeBackendKind, RuntimeBackendSpi>>;
  specializations: Record<RuntimeSpecialization, RuntimeSpecializationPort>;
  recordTransition(transition: RuntimeTransition): void;
  recordHeartbeat(checkpoint: RuntimeCheckpoint): void;
  now(): number;
}): Promise<CanonicalRuntimeResult> {
  const resolvedProfile = validateProfile(input.profile);
  const envelope = sealRuntimeEnvelope({ ...input, profile: resolvedProfile });
  const attempt = positiveInteger(input.attempt, 'runtime_attempt_invalid');
  if (
    (attempt === 1 && input.checkpoint !== undefined) ||
    (attempt > 1 &&
      (input.checkpoint === undefined || !checkpointMatches(input.checkpoint, envelope, attempt)))
  ) {
    throw new Error('runtime_checkpoint_scope_mismatch');
  }
  if (input.signal.aborted) throw new Error('runtime_cancelled');
  const backend = input.backends[envelope.execution.backend];
  if (backend === undefined || backend.kind !== envelope.execution.backend) {
    throw new Error(`runtime_backend_unavailable:${envelope.execution.backend}`);
  }
  const specialization = input.specializations[envelope.specialization];
  if (specialization === undefined) throw new Error('runtime_specialization_unavailable');

  let prepared: { handle: string };
  try {
    prepared = await backend.prepare(envelope);
  } catch {
    throw new Error(`runtime_backend_unavailable:${envelope.execution.backend}`);
  }
  input.recordTransition('prepared');
  input.recordTransition('executing');

  let execution: { status: 'completed'; backendOutput: unknown; transport?: unknown };
  try {
    execution = await backend.execute(envelope, prepared, {
      signal: input.signal,
      ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
      heartbeat: (cursor) => {
        const heartbeatAt = input.now();
        input.recordHeartbeat(
          deepFreeze({
            schemaVersion: 1,
            runId: envelope.runId,
            profileId: envelope.execution.profileId,
            backend: envelope.execution.backend,
            leaseId: envelope.execution.leaseId,
            attempt,
            cursor,
            heartbeatAt,
            leaseExpiresAt: heartbeatAt + resolvedProfile.leaseDurationMs,
          }),
        );
      },
    });
  } catch {
    throw new Error(`runtime_backend_unavailable:${envelope.execution.backend}`);
  }
  if (execution.status !== 'completed') {
    throw new Error(`runtime_backend_unavailable:${envelope.execution.backend}`);
  }

  let collected: { candidate: unknown; artifacts: Array<{ ref: string; hash: string }> };
  try {
    collected = await backend.collect(envelope, execution);
  } catch {
    throw new Error(`runtime_backend_unavailable:${envelope.execution.backend}`);
  }
  input.recordTransition('collected');
  const verified = await specialization.verify({ envelope, ...collected });
  if (verified.passed !== true) throw new Error('runtime_verification_failed');
  input.recordTransition('verified');
  const result = canonicalizeRuntimeResult({
    envelope,
    candidate: collected.candidate,
    artifacts: collected.artifacts,
    verification: verified.evidence,
    transport: execution.transport,
  });
  await specialization.finalize({ envelope, resultHash: result.resultHash });
  input.recordTransition('finalized');
  return result;
}

/** Apply deterministic cancel/deadline/lease/heartbeat precedence without backend fallback. */
export function decideRuntimeControl(input: {
  checkpoint: RuntimeCheckpoint;
  now: number;
  deadlineAt: number;
  heartbeatTimeoutMs: number;
  cancelRequested: boolean;
  backendConnected: boolean;
}): RuntimeControlDecision {
  const { checkpoint } = input;
  if (input.cancelRequested) return { action: 'cancel', reasonCode: 'cancel_requested' };
  if (input.now > input.deadlineAt) {
    return { action: 'timeout', reasonCode: 'deadline_exceeded' };
  }
  const restart = (
    reasonCode: Extract<RuntimeControlDecision, { action: 'restart' }>['reasonCode'],
  ): RuntimeControlDecision => ({
    action: 'restart',
    reasonCode,
    backend: checkpoint.backend,
    profileId: checkpoint.profileId,
    nextAttempt: checkpoint.attempt + 1,
    fallbackAllowed: false,
  });
  if (!input.backendConnected) return restart('runner_disconnected');
  if (input.now > checkpoint.leaseExpiresAt) return restart('lease_expired');
  if (input.now - checkpoint.heartbeatAt > input.heartbeatTimeoutMs) {
    return restart('heartbeat_stale');
  }
  return { action: checkpoint.attempt > 1 ? 'resume' : 'continue' };
}
