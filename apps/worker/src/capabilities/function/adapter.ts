import {
  parseNativeFunctionInvocation,
  parseNativeFunctionOutcome,
  parseNativeFunctionProfiles,
  type NativeFunctionOutcomeV1,
  type NativeFunctionProfileV1,
  type NativeFunctionWorkflowInputV1,
} from '@ui4a/shared';
import { assertCapabilityPayload, canonicalAgentJson, hashCanonicalAgentJson } from '@ui4a/engine';

export interface NativeFunctionHandlerResult {
  output: Record<string, unknown>;
  evidenceRefs?: string[];
}

export type NativeFunctionHandler = (
  payload: Record<string, unknown>,
  context: { executionId: string; signal: AbortSignal },
) => Promise<NativeFunctionHandlerResult>;

export class NativeFunctionHandlerFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'NativeFunctionHandlerFailure';
  }
}

export interface NativeFunctionHandlerRegistry {
  resolve(ref: string): NativeFunctionHandler | undefined;
}

export function createNativeFunctionHandlerRegistry(
  entries: ReadonlyArray<{ ref: string; handler: NativeFunctionHandler }>,
): NativeFunctionHandlerRegistry {
  const handlers = new Map<string, NativeFunctionHandler>();
  for (const entry of entries) {
    if (entry.ref === '' || handlers.has(entry.ref)) {
      throw new Error(`duplicate Native Function handler: ${entry.ref}`);
    }
    handlers.set(entry.ref, entry.handler);
  }
  return { resolve: (ref) => handlers.get(ref) };
}

export function nativeFunctionActivityOptions(profile: NativeFunctionProfileV1) {
  const parsed = parseNativeFunctionProfiles([profile])[0]!;
  return {
    startToCloseTimeout: `${parsed.limits.startToCloseTimeoutMs}ms`,
    retry: { maximumAttempts: parsed.limits.maximumAttempts },
  };
}

function failed(
  code: string,
  reason: string,
  attempt: number,
  retryable = false,
): NativeFunctionOutcomeV1 {
  return {
    schemaVersion: 1,
    status: 'failed',
    failure: { code, reason, retryable },
    attempt,
  };
}

function profileMatchesBirth(
  profile: NativeFunctionProfileV1,
  input: NativeFunctionWorkflowInputV1,
): boolean {
  const birth = input.invocation.birth.profile;
  return (
    profile.ref === birth.ref &&
    profile.version === birth.version &&
    profile.handlerRef === birth.handlerRef &&
    profile.adapterVersion === birth.adapterVersion &&
    hashCanonicalAgentJson({ limits: profile.limits, network: profile.network }) ===
      birth.limitsHash &&
    profile.executorClass === 'native-function' &&
    profile.availability.status === 'available'
  );
}

export async function executeNativeFunction(
  rawInput: NativeFunctionWorkflowInputV1,
  options: {
    registry: NativeFunctionHandlerRegistry;
    signal: AbortSignal;
    attempt: number;
  },
): Promise<NativeFunctionOutcomeV1> {
  const attempt = options.attempt;
  if (!Number.isSafeInteger(attempt) || attempt <= 0) {
    return failed('attempt-invalid', 'activity attempt is invalid', 1);
  }
  let profile: NativeFunctionProfileV1;
  let invocation;
  try {
    profile = parseNativeFunctionProfiles([rawInput.profile])[0]!;
    invocation = parseNativeFunctionInvocation(rawInput.invocation);
  } catch (error) {
    return failed(
      'invocation-invalid',
      error instanceof Error ? error.message : String(error),
      attempt,
    );
  }
  if (!/^nf-[a-z0-9]+-[a-f0-9]{12}$/.test(rawInput.executionId)) {
    return failed('execution-id-invalid', 'executionId is invalid', attempt);
  }
  if (!profileMatchesBirth(profile, { ...rawInput, invocation })) {
    return failed('profile-birth-mismatch', 'profile does not match invocation birth', attempt);
  }
  if (
    hashCanonicalAgentJson(invocation.birth.inputContract.schema as never) !==
      invocation.birth.inputContract.hash ||
    hashCanonicalAgentJson(invocation.birth.outputContract.schema as never) !==
      invocation.birth.outputContract.hash ||
    hashCanonicalAgentJson(invocation.input.payload as never) !== invocation.input.hash
  ) {
    return failed('birth-hash-mismatch', 'invocation contract or input hash mismatch', attempt);
  }
  const inputBytes = new TextEncoder().encode(
    canonicalAgentJson(invocation.input.payload as never),
  ).byteLength;
  if (inputBytes > profile.limits.inputBytes || inputBytes !== invocation.input.byteLength) {
    return failed('input-budget', 'input byte length exceeds or differs from birth', attempt);
  }
  try {
    assertCapabilityPayload(
      invocation.birth.inputContract.schema,
      invocation.input.payload,
      'native function input',
    );
  } catch {
    return failed('input-schema', 'input does not match the birth contract', attempt);
  }
  if (options.signal.aborted) {
    return { schemaVersion: 1, status: 'cancelled', reason: 'requested', attempt };
  }
  const handler = options.registry.resolve(profile.handlerRef);
  if (handler === undefined)
    return failed('handler-unavailable', 'handler is unavailable', attempt);

  let claim: NativeFunctionHandlerResult;
  try {
    claim = await handler(invocation.input.payload, {
      executionId: rawInput.executionId,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof NativeFunctionHandlerFailure) {
      if (error.retryable) throw error;
      return failed(error.code, error.message, attempt);
    }
    throw error;
  }
  const outputCanonical = canonicalAgentJson(claim.output as never);
  const outputByteLength = new TextEncoder().encode(outputCanonical).byteLength;
  if (outputByteLength > profile.limits.outputBytes) {
    return failed('output-budget', 'output exceeds the birth-pinned budget', attempt);
  }
  try {
    assertCapabilityPayload(
      invocation.birth.outputContract.schema,
      claim.output,
      'native function output',
    );
  } catch {
    return failed('output-schema', 'output does not match the birth contract', attempt);
  }
  return parseNativeFunctionOutcome(
    {
      schemaVersion: 1,
      status: 'succeeded',
      output: claim.output,
      outputHash: hashCanonicalAgentJson(claim.output as never),
      outputByteLength,
      evidenceRefs: claim.evidenceRefs ?? [],
      attempt,
    },
    profile.limits.outputBytes,
  );
}
