import type { RuntimeBackendExecutionPort, SealedRunnerEnvelope } from '../backend';

interface HttpRunnerExecutionOptions {
  origin: string;
  authorizationHeader: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

interface ValidatedRunnerResult {
  schemaVersion: 1;
  deliveryId: string;
  runId: string;
  birth: SealedRunnerEnvelope['birth'];
  specialization: SealedRunnerEnvelope['specialization'];
  status: 'succeeded';
  resultHash: string;
  candidate: unknown;
  artifacts: Array<{ ref: string; hash: string }>;
}

interface RunnerDeliveryWire {
  schemaVersion: 1;
  deliveryId: string;
  request: {
    schemaVersion: 1;
    runId: string;
    specialization: SealedRunnerEnvelope['specialization'];
    birth: SealedRunnerEnvelope['birth'];
    task: SealedRunnerEnvelope['task'];
  };
  execution: {
    profileId: string;
    backend: SealedRunnerEnvelope['execution']['backend'];
    image: string;
    workspace: { rootRef: string };
    resources: { cpu: string; memory: string; timeoutMs: number };
    networkPolicy: 'restricted';
    credentialRefs: string[];
  };
}

const RESULT_FIELDS = [
  'schemaVersion',
  'deliveryId',
  'runId',
  'birth',
  'specialization',
  'status',
  'resultHash',
  'candidate',
  'artifacts',
] as const;
const BIRTH_FIELDS = [
  'definitionRef',
  'definitionHash',
  'promptHash',
  'runtimeHash',
  'taskContractHash',
  'resultContractHash',
] as const;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BEARER_PATTERN = /^Bearer [A-Za-z0-9._~+/-]+=*$/;

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('runtime_http_result_invalid');
  }
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function sameBirth(value: unknown, expected: SealedRunnerEnvelope['birth']): boolean {
  const candidate = record(value);
  return (
    exactFields(candidate, BIRTH_FIELDS) &&
    BIRTH_FIELDS.every((field) => candidate[field] === expected[field])
  );
}

function artifacts(value: unknown): Array<{ ref: string; hash: string }> {
  if (!Array.isArray(value)) fail('runtime_http_result_invalid');
  return value.map((entry) => {
    const candidate = record(entry);
    if (
      !exactFields(candidate, ['ref', 'hash']) ||
      typeof candidate.ref !== 'string' ||
      candidate.ref === '' ||
      typeof candidate.hash !== 'string' ||
      !SHA256_PATTERN.test(candidate.hash)
    ) {
      fail('runtime_http_result_invalid');
    }
    return { ref: candidate.ref, hash: candidate.hash };
  });
}

function validateResult(input: {
  value: unknown;
  envelope: SealedRunnerEnvelope;
  deliveryId: string;
}): ValidatedRunnerResult {
  const candidate = record(input.value);
  if (
    !exactFields(candidate, RESULT_FIELDS) ||
    candidate.schemaVersion !== 1 ||
    candidate.deliveryId !== input.deliveryId ||
    candidate.runId !== input.envelope.runId ||
    candidate.specialization !== input.envelope.specialization ||
    candidate.status !== 'succeeded' ||
    typeof candidate.resultHash !== 'string' ||
    !SHA256_PATTERN.test(candidate.resultHash) ||
    !sameBirth(candidate.birth, input.envelope.birth) ||
    !Object.hasOwn(candidate, 'candidate')
  ) {
    fail('runtime_http_result_invalid');
  }
  return {
    schemaVersion: 1,
    deliveryId: input.deliveryId,
    runId: input.envelope.runId,
    birth: structuredClone(input.envelope.birth),
    specialization: input.envelope.specialization,
    status: 'succeeded',
    resultHash: candidate.resultHash,
    candidate: structuredClone(candidate.candidate),
    artifacts: artifacts(candidate.artifacts),
  };
}

function wireDelivery(envelope: SealedRunnerEnvelope, deliveryId: string): RunnerDeliveryWire {
  const timeoutMs = envelope.execution.resources.timeoutSeconds * 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    fail('runtime_http_delivery_invalid');
  }
  return structuredClone({
    schemaVersion: 1,
    deliveryId,
    request: {
      schemaVersion: envelope.schemaVersion,
      runId: envelope.runId,
      specialization: envelope.specialization,
      birth: {
        definitionRef: envelope.birth.definitionRef,
        definitionHash: envelope.birth.definitionHash,
        promptHash: envelope.birth.promptHash,
        runtimeHash: envelope.birth.runtimeHash,
        taskContractHash: envelope.birth.taskContractHash,
        resultContractHash: envelope.birth.resultContractHash,
      },
      task: {
        contractRef: envelope.task.contractRef,
        payload: envelope.task.payload,
        contextRefs: envelope.task.contextRefs,
      },
    },
    execution: {
      profileId: envelope.execution.profileId,
      backend: envelope.execution.backend,
      image: envelope.execution.image,
      workspace: { rootRef: envelope.execution.workspace.rootRef },
      resources: {
        cpu: envelope.execution.resources.cpu,
        memory: envelope.execution.resources.memory,
        timeoutMs,
      },
      networkPolicy: envelope.execution.networkPolicy,
      credentialRefs: envelope.execution.credentialRefs,
    },
  });
}

function canonicalOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('runtime_http_origin_invalid');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    value !== url.origin
  ) {
    fail('runtime_http_origin_invalid');
  }
  return url.origin;
}

/**
 * Create the authenticated HTTP bridge shared by trusted-host and Compose Runner deployments.
 * Credentials stay exclusively in the Authorization header; only the sealed Runner delivery is
 * serialized. Network I/O remains injected so the port is deterministic under tests.
 */
export function createHttpRunnerExecutionPort(
  options: HttpRunnerExecutionOptions,
): RuntimeBackendExecutionPort {
  const origin = canonicalOrigin(options.origin);
  if (!BEARER_PATTERN.test(options.authorizationHeader)) {
    fail('runtime_http_authorization_invalid');
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    fail('runtime_http_timeout_invalid');
  }
  const verifiedOutputs = new WeakSet<object>();

  return {
    async execute(input) {
      if (typeof input.handle !== 'string' || input.handle === '') {
        fail('runtime_http_delivery_invalid');
      }
      let body: string;
      try {
        body = JSON.stringify(wireDelivery(input.envelope, input.handle));
      } catch {
        fail('runtime_http_delivery_invalid');
      }

      if (input.signal.aborted) fail('runtime_http_cancelled');
      const request = new AbortController();
      let timedOut = false;
      const cancel = (): void => request.abort();
      input.signal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        request.abort();
      }, options.timeoutMs);

      let response: Response;
      try {
        response = await options.fetchImpl(new URL('/deliver', origin), {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            authorization: options.authorizationHeader,
            'content-type': 'application/json',
          },
          body,
          signal: request.signal,
        });
      } catch {
        if (input.signal.aborted) fail('runtime_http_cancelled');
        if (timedOut) fail('runtime_http_timeout');
        fail('runtime_http_unavailable');
      } finally {
        clearTimeout(timeout);
        input.signal.removeEventListener('abort', cancel);
      }

      if (!response.ok) fail(`runtime_http_status:${response.status}`);
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        fail('runtime_http_result_invalid');
      }
      const result = validateResult({
        value,
        envelope: input.envelope,
        deliveryId: input.handle,
      });
      verifiedOutputs.add(result);
      input.heartbeat('http:completed');
      return {
        status: 'completed',
        backendOutput: result,
        transport: { status: response.status },
      };
    },

    async collect(input) {
      if (
        typeof input.execution.backendOutput !== 'object' ||
        input.execution.backendOutput === null ||
        !verifiedOutputs.has(input.execution.backendOutput)
      ) {
        fail('runtime_http_result_unverified');
      }
      const result = input.execution.backendOutput as ValidatedRunnerResult;
      if (
        result.runId !== input.envelope.runId ||
        result.specialization !== input.envelope.specialization ||
        !sameBirth(result.birth, input.envelope.birth)
      ) {
        fail('runtime_http_result_unverified');
      }
      return {
        candidate: structuredClone(result.candidate),
        artifacts: structuredClone(result.artifacts),
      };
    },
  };
}
