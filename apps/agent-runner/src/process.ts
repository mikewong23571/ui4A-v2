import { createHash } from 'node:crypto';

export type RunnerSpecialization = 'coding' | 'writing' | 'authoring';
export type RunnerBackendKind = 'kubernetes-job' | 'trusted-host';

export interface RunnerDelivery {
  schemaVersion: 1;
  deliveryId: string;
  request: {
    schemaVersion: 1;
    runId: string;
    specialization: RunnerSpecialization;
    birth: {
      definitionRef: string;
      definitionHash: string;
      promptHash: string;
      runtimeHash: string;
      taskContractHash: string;
      resultContractHash: string;
    };
    task: { contractRef: string; payload: unknown; contextRefs: string[] };
  };
  execution: {
    profileId: string;
    backend: RunnerBackendKind;
    image: string;
    workspace: { rootRef: string };
    resources: { cpu: string; memory: string; timeoutMs: number };
    networkPolicy: 'restricted';
    credentialRefs: string[];
  };
}

export interface RunnerDeliveryResult {
  schemaVersion: 1;
  deliveryId: string;
  runId: string;
  specialization: RunnerSpecialization;
  status: 'succeeded';
  birth: RunnerDelivery['request']['birth'];
  candidate: unknown;
  artifacts: Array<{ ref: string; hash: string }>;
  resultHash: string;
}

export interface RunnerDeliveryDependencies {
  resolveSecrets(refs: string[]): Promise<Record<string, string>>;
  executor(
    delivery: RunnerDelivery,
    context: { signal: AbortSignal; secrets: Readonly<Record<string, string>> },
  ): Promise<{
    candidate: unknown;
    artifacts: Array<{ ref: string; hash: string }>;
    transport?: unknown;
  }>;
  scheduleTimeout(timeoutMs: number, onTimeout: () => void): () => void;
}

export interface RunnerDeliveryProcessor {
  execute(delivery: unknown, options?: { signal?: AbortSignal }): Promise<RunnerDeliveryResult>;
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IMAGE_PATTERN = /@sha256:[0-9a-f]{64}$/;
const DELIVERY_FIELDS = ['schemaVersion', 'deliveryId', 'request', 'execution'] as const;
const REQUEST_FIELDS = ['schemaVersion', 'runId', 'specialization', 'birth', 'task'] as const;
const FORBIDDEN_REQUEST_FIELDS = [
  'provider',
  'model',
  'cwd',
  'env',
  'backend',
  'image',
  'workspace',
  'resources',
  'networkPolicy',
] as const;
const BIRTH_FIELDS = [
  'definitionRef',
  'definitionHash',
  'promptHash',
  'runtimeHash',
  'taskContractHash',
  'resultContractHash',
] as const;
const EXECUTION_FIELDS = [
  'profileId',
  'backend',
  'image',
  'workspace',
  'resources',
  'networkPolicy',
  'credentialRefs',
] as const;

function object(value: unknown, code = 'runner_delivery_invalid'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  fields: readonly string[],
  code = 'runner_delivery_invalid',
): void {
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(code);
  }
}

function string(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('runner_delivery_invalid');
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error('runner_delivery_invalid');
  }
  return Number(value);
}

function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw new Error('runner_delivery_invalid');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function validateDelivery(value: unknown): RunnerDelivery {
  const delivery = object(value);
  exactKeys(delivery, DELIVERY_FIELDS);
  if (delivery.schemaVersion !== 1) throw new Error('runner_delivery_invalid');
  string(delivery.deliveryId);

  const request = object(delivery.request);
  for (const field of FORBIDDEN_REQUEST_FIELDS) {
    if (Object.hasOwn(request, field)) throw new Error(`runner_request_forbidden_field:${field}`);
  }
  exactKeys(request, REQUEST_FIELDS);
  if (request.schemaVersion !== 1) throw new Error('runner_delivery_invalid');
  string(request.runId);
  if (!['coding', 'writing', 'authoring'].includes(String(request.specialization))) {
    throw new Error('runner_delivery_invalid');
  }

  const birth = object(request.birth);
  exactKeys(birth, BIRTH_FIELDS);
  string(birth.definitionRef);
  for (const field of BIRTH_FIELDS.slice(1)) {
    if (!DIGEST_PATTERN.test(string(birth[field]))) throw new Error('runner_delivery_invalid');
  }

  const task = object(request.task);
  exactKeys(task, ['contractRef', 'payload', 'contextRefs']);
  string(task.contractRef);
  if (
    !Array.isArray(task.contextRefs) ||
    task.contextRefs.some((ref) => typeof ref !== 'string' || ref === '')
  ) {
    throw new Error('runner_delivery_invalid');
  }

  const execution = object(delivery.execution);
  exactKeys(execution, EXECUTION_FIELDS);
  string(execution.profileId);
  if (!['kubernetes-job', 'trusted-host'].includes(String(execution.backend))) {
    throw new Error('runner_delivery_invalid');
  }
  if (!IMAGE_PATTERN.test(string(execution.image))) throw new Error('runner_delivery_invalid');
  const workspace = object(execution.workspace);
  exactKeys(workspace, ['rootRef']);
  string(workspace.rootRef);
  const resources = object(execution.resources);
  exactKeys(resources, ['cpu', 'memory', 'timeoutMs']);
  string(resources.cpu);
  string(resources.memory);
  positiveInteger(resources.timeoutMs);
  if (execution.networkPolicy !== 'restricted') throw new Error('runner_delivery_invalid');
  if (
    !Array.isArray(execution.credentialRefs) ||
    execution.credentialRefs.some((ref) => typeof ref !== 'string' || ref === '') ||
    new Set(execution.credentialRefs).size !== execution.credentialRefs.length
  ) {
    throw new Error('runner_delivery_invalid');
  }
  return deepFreeze(deepClone(delivery)) as unknown as RunnerDelivery;
}

function sortedArtifacts(
  artifacts: Array<{ ref: string; hash: string }>,
): Array<{ ref: string; hash: string }> {
  const detached = deepClone(artifacts);
  for (const artifact of detached) {
    if (
      Object.keys(artifact).length !== 2 ||
      artifact.ref === '' ||
      !DIGEST_PATTERN.test(artifact.hash)
    ) {
      throw new Error('runner_execution_failed');
    }
  }
  if (new Set(detached.map(({ ref }) => ref)).size !== detached.length) {
    throw new Error('runner_execution_failed');
  }
  return detached.sort((left, right) =>
    left.ref < right.ref
      ? -1
      : left.ref > right.ref
        ? 1
        : left.hash < right.hash
          ? -1
          : left.hash > right.hash
            ? 1
            : 0,
  );
}

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === 'string') return secrets.some((secret) => value.includes(secret));
  if (Array.isArray(value)) return value.some((child) => containsSecret(child, secrets));
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).some((child) =>
    containsSecret(child, secrets),
  );
}

function stableResult(
  delivery: RunnerDelivery,
  output: { candidate: unknown; artifacts: Array<{ ref: string; hash: string }> },
): RunnerDeliveryResult {
  const semantic = {
    schemaVersion: 1 as const,
    runId: delivery.request.runId,
    specialization: delivery.request.specialization,
    status: 'succeeded' as const,
    birth: deepClone(delivery.request.birth),
    candidate: deepClone(output.candidate),
    artifacts: sortedArtifacts(output.artifacts),
  };
  return deepFreeze({
    deliveryId: delivery.deliveryId,
    ...semantic,
    resultHash: digest(semantic),
  });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function executeOnce(
  delivery: RunnerDelivery,
  dependencies: RunnerDeliveryDependencies,
  externalSignal: AbortSignal | undefined,
): Promise<RunnerDeliveryResult> {
  if (isAborted(externalSignal)) throw new Error('runner_execution_cancelled');
  let secrets: Record<string, string>;
  try {
    secrets = await dependencies.resolveSecrets([...delivery.execution.credentialRefs]);
  } catch {
    throw new Error('runner_execution_failed');
  }
  if (isAborted(externalSignal)) throw new Error('runner_execution_cancelled');
  if (
    Object.keys(secrets).length !== delivery.execution.credentialRefs.length ||
    Object.keys(secrets).some((ref) => !delivery.execution.credentialRefs.includes(ref))
  ) {
    throw new Error('runner_execution_failed');
  }
  for (const ref of delivery.execution.credentialRefs) {
    if (typeof secrets[ref] !== 'string' || secrets[ref] === '') {
      throw new Error('runner_execution_failed');
    }
  }
  const secretValues = Object.values(secrets).filter((secret) => secret !== '');
  const controller = new AbortController();
  const termination: { reason?: 'timeout' | 'cancelled' } = {};
  const onCancel = (): void => {
    termination.reason = 'cancelled';
    controller.abort();
  };
  externalSignal?.addEventListener('abort', onCancel, { once: true });
  const disposeTimeout = dependencies.scheduleTimeout(
    delivery.execution.resources.timeoutMs,
    () => {
      termination.reason = 'timeout';
      controller.abort();
    },
  );
  try {
    const output = await dependencies.executor(delivery, {
      signal: controller.signal,
      secrets: deepFreeze(deepClone(secrets)),
    });
    if (termination.reason === 'timeout') throw new Error('runner_execution_timeout');
    if (termination.reason === 'cancelled' || isAborted(externalSignal)) {
      throw new Error('runner_execution_cancelled');
    }
    if (containsSecret(output, secretValues)) throw new Error('runner_execution_failed');
    return stableResult(delivery, output);
  } catch {
    if (termination.reason === 'timeout') throw new Error('runner_execution_timeout');
    if (termination.reason === 'cancelled' || isAborted(externalSignal)) {
      throw new Error('runner_execution_cancelled');
    }
    throw new Error('runner_execution_failed');
  } finally {
    disposeTimeout();
    externalSignal?.removeEventListener('abort', onCancel);
  }
}

/** Create one specialization-neutral, idempotent delivery executor shared by all Runner modes. */
export function createRunnerDeliveryProcessor(
  dependencies: RunnerDeliveryDependencies,
): RunnerDeliveryProcessor {
  const fingerprints = new Map<string, string>();
  const results = new Map<string, Promise<RunnerDeliveryResult>>();
  return {
    async execute(deliveryValue, options = {}) {
      const delivery = validateDelivery(deliveryValue);
      const fingerprint = digest(delivery);
      const knownFingerprint = fingerprints.get(delivery.deliveryId);
      if (knownFingerprint !== undefined && knownFingerprint !== fingerprint) {
        throw new Error('runner_delivery_conflict');
      }
      const knownResult = results.get(delivery.deliveryId);
      if (knownResult !== undefined) return knownResult;
      fingerprints.set(delivery.deliveryId, fingerprint);
      const pending = executeOnce(delivery, dependencies, options.signal);
      results.set(delivery.deliveryId, pending);
      void pending.catch(() => {
        if (results.get(delivery.deliveryId) === pending) results.delete(delivery.deliveryId);
      });
      return pending;
    },
  };
}

/** Single delivery seam used by both the one-shot command and authenticated daemon transport. */
export function executeRunnerDelivery(
  processor: RunnerDeliveryProcessor,
  delivery: unknown,
  options?: { signal?: AbortSignal },
): Promise<RunnerDeliveryResult> {
  return processor.execute(delivery, options);
}

/** Default timer adapter; process tests and embeddings may inject a deterministic scheduler. */
export function scheduleRunnerTimeout(timeoutMs: number, onTimeout: () => void): () => void {
  const timer = setTimeout(onTimeout, timeoutMs);
  timer.unref();
  return () => clearTimeout(timer);
}
