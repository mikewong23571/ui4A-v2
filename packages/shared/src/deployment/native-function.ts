const PROFILE_KEYS = new Set([
  'schemaVersion',
  'ref',
  'version',
  'executorClass',
  'handlerRef',
  'adapterVersion',
  'availability',
  'limits',
  'network',
]);
const LIMIT_KEYS = new Set([
  'startToCloseTimeoutMs',
  'maximumAttempts',
  'inputBytes',
  'outputBytes',
]);
const MAX_TIMEOUT_MS = 86_400_000;
const MAX_ATTEMPTS = 10;
export const NATIVE_FUNCTION_INPUT_BYTES_MAX = 65_536;
export const NATIVE_FUNCTION_OUTPUT_BYTES_MAX = 256 * 1024;
const MAX_STRING_LENGTH = 512;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CORE_EVENT_PATTERN = /^core:[1-9][0-9]*$/;
const EXECUTION_ID_PATTERN = /^nf-[a-z0-9]+-[a-f0-9]{12}$/;

type JsonObject = Record<string, unknown>;

export interface NativeFunctionProfileV1 {
  schemaVersion: 1;
  ref: string;
  version: string;
  executorClass: 'native-function';
  handlerRef: string;
  adapterVersion: string;
  availability: { status: 'available' } | { status: 'unavailable'; reason: string };
  limits: {
    startToCloseTimeoutMs: number;
    maximumAttempts: number;
    inputBytes: number;
    outputBytes: number;
  };
  network: 'denied';
}

export type CapabilityInputSourceRef =
  | { from: 'action-param'; name: string }
  | { from: 'source-field'; name: string; rel: string }
  | { from: 'artifact-ref'; param: string; rel: string };

export interface NativeFunctionInvocationV1 {
  schemaVersion: 1;
  source: {
    eventId: `core:${number}`;
    rel: string;
    action: string;
    principal: string;
    policyScope: string;
  };
  birth: {
    capability: { name: string; hash: `sha256:${string}` };
    profile: {
      ref: string;
      version: string;
      handlerRef: string;
      adapterVersion: string;
      limitsHash: `sha256:${string}`;
    };
    inputContract: { hash: `sha256:${string}`; schema: JsonObject };
    outputContract: { hash: `sha256:${string}`; schema: JsonObject };
  };
  callback: { onDoneAction: string; onErrorAction: string };
  input: {
    payload: JsonObject;
    sources: Record<string, CapabilityInputSourceRef>;
    hash: `sha256:${string}`;
    byteLength: number;
  };
}

export interface NativeFunctionWorkflowInputV1 {
  executionId: string;
  invocation: NativeFunctionInvocationV1;
  profile: NativeFunctionProfileV1;
}

export interface NativeFunctionCallbackClaimV1 {
  schemaVersion: 1;
  executionId: string;
  sourceEventId: `core:${number}`;
  invocationHash: `sha256:${string}`;
  outcome: NativeFunctionOutcomeV1;
}

export type NativeFunctionOutcomeV1 =
  | {
      schemaVersion: 1;
      status: 'succeeded';
      output: JsonObject;
      outputHash: `sha256:${string}`;
      outputByteLength: number;
      evidenceRefs: string[];
      attempt: number;
    }
  | {
      schemaVersion: 1;
      status: 'failed';
      failure: { code: string; reason: string; retryable: boolean };
      attempt: number;
    }
  | { schemaVersion: 1; status: 'cancelled'; reason: string; attempt: number };

export interface NativeFunctionReceiptV1 {
  schemaVersion: 1;
  executionId: string;
  sourceEventId: `core:${number}`;
  invocationHash: `sha256:${string}`;
  capability: { name: string; hash: `sha256:${string}` };
  profile: NativeFunctionInvocationV1['birth']['profile'];
  inputHash: `sha256:${string}`;
  outcome: NativeFunctionOutcomeV1;
  callback: {
    commandId: string;
    action: string;
    outcome: 'accepted' | 'rejected' | 'suspended';
    reason?: string;
  };
}

function object(value: unknown, where: string): asserts value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
}

function exactKeys(value: JsonObject, keys: ReadonlySet<string>, where: string): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown !== undefined) throw new Error(`${where}.${unknown} is unknown`);
}

function string(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING_LENGTH) {
    throw new Error(`${where} must be a bounded non-empty string`);
  }
  return value;
}

function integer(value: unknown, where: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new Error(`${where} must be a bounded positive integer`);
  }
  return value as number;
}

function hash(value: unknown, where: string): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${where} must be a sha256 hash`);
  }
}

function eventId(value: unknown, where: string): asserts value is `core:${number}` {
  if (typeof value !== 'string' || !CORE_EVENT_PATTERN.test(value)) {
    throw new Error(`${where} must be a core event id`);
  }
}

function schemaVersion(value: unknown, where: string): void {
  if (value !== 1) throw new Error(`${where}.schemaVersion must be 1`);
}

function profileValue(value: unknown, index: number): NativeFunctionProfileV1 {
  const where = `nativeFunctionProfiles[${index}]`;
  object(value, where);
  exactKeys(value, PROFILE_KEYS, where);
  schemaVersion(value.schemaVersion, where);
  string(value.ref, `${where}.ref`);
  string(value.version, `${where}.version`);
  if (value.executorClass !== 'native-function') {
    throw new Error(`${where}.executorClass must be native-function`);
  }
  string(value.handlerRef, `${where}.handlerRef`);
  string(value.adapterVersion, `${where}.adapterVersion`);
  if (value.network !== 'denied') throw new Error(`${where}.network must be denied`);

  object(value.availability, `${where}.availability`);
  if (value.availability.status === 'available') {
    exactKeys(value.availability, new Set(['status']), `${where}.availability`);
  } else if (value.availability.status === 'unavailable') {
    exactKeys(value.availability, new Set(['status', 'reason']), `${where}.availability`);
    string(value.availability.reason, `${where}.availability.reason`);
  } else {
    throw new Error(`${where}.availability.status is invalid`);
  }

  object(value.limits, `${where}.limits`);
  exactKeys(value.limits, LIMIT_KEYS, `${where}.limits`);
  integer(
    value.limits.startToCloseTimeoutMs,
    `${where}.limits.startToCloseTimeoutMs`,
    MAX_TIMEOUT_MS,
  );
  integer(value.limits.maximumAttempts, `${where}.limits.maximumAttempts`, MAX_ATTEMPTS);
  integer(value.limits.inputBytes, `${where}.limits.inputBytes`, NATIVE_FUNCTION_INPUT_BYTES_MAX);
  integer(
    value.limits.outputBytes,
    `${where}.limits.outputBytes`,
    NATIVE_FUNCTION_OUTPUT_BYTES_MAX,
  );
  return value as unknown as NativeFunctionProfileV1;
}

export function parseNativeFunctionProfiles(value: unknown): NativeFunctionProfileV1[] {
  if (!Array.isArray(value)) throw new Error('nativeFunctionProfiles must be an array');
  const profiles = value.map(profileValue);
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.ref)) throw new Error(`duplicate native function profile: ${profile.ref}`);
    seen.add(profile.ref);
  }
  return profiles;
}

function compactRef(value: unknown, where: string, keys: readonly string[]): void {
  object(value, where);
  exactKeys(value, new Set(keys), where);
  for (const key of keys) {
    if (key === 'hash') hash(value[key], `${where}.${key}`);
    else string(value[key], `${where}.${key}`);
  }
}

function schemaContract(value: unknown, where: string): void {
  object(value, where);
  exactKeys(value, new Set(['hash', 'schema']), where);
  hash(value.hash, `${where}.hash`);
  object(value.schema, `${where}.schema`);
}

function parseSourceRef(value: unknown, where: string): CapabilityInputSourceRef {
  object(value, where);
  if (value.from === 'action-param') {
    exactKeys(value, new Set(['from', 'name']), where);
    string(value.name, `${where}.name`);
  } else if (value.from === 'source-field') {
    exactKeys(value, new Set(['from', 'name', 'rel']), where);
    string(value.name, `${where}.name`);
    string(value.rel, `${where}.rel`);
  } else if (value.from === 'artifact-ref') {
    exactKeys(value, new Set(['from', 'param', 'rel']), where);
    string(value.param, `${where}.param`);
    string(value.rel, `${where}.rel`);
  } else {
    throw new Error(`${where}.from is invalid`);
  }
  return value as unknown as CapabilityInputSourceRef;
}

export function parseNativeFunctionInvocation(value: unknown): NativeFunctionInvocationV1 {
  const where = 'nativeFunctionInvocation';
  object(value, where);
  exactKeys(value, new Set(['schemaVersion', 'source', 'birth', 'callback', 'input']), where);
  schemaVersion(value.schemaVersion, where);

  object(value.source, `${where}.source`);
  exactKeys(
    value.source,
    new Set(['eventId', 'rel', 'action', 'principal', 'policyScope']),
    `${where}.source`,
  );
  eventId(value.source.eventId, `${where}.source.eventId`);
  for (const key of ['rel', 'action', 'principal', 'policyScope']) {
    string(value.source[key], `${where}.source.${key}`);
  }

  object(value.birth, `${where}.birth`);
  exactKeys(
    value.birth,
    new Set(['capability', 'profile', 'inputContract', 'outputContract']),
    `${where}.birth`,
  );
  compactRef(value.birth.capability, `${where}.birth.capability`, ['name', 'hash']);
  compactRef(value.birth.profile, `${where}.birth.profile`, [
    'ref',
    'version',
    'handlerRef',
    'adapterVersion',
    'limitsHash',
  ]);
  schemaContract(value.birth.inputContract, `${where}.birth.inputContract`);
  schemaContract(value.birth.outputContract, `${where}.birth.outputContract`);

  object(value.callback, `${where}.callback`);
  exactKeys(value.callback, new Set(['onDoneAction', 'onErrorAction']), `${where}.callback`);
  string(value.callback.onDoneAction, `${where}.callback.onDoneAction`);
  string(value.callback.onErrorAction, `${where}.callback.onErrorAction`);

  object(value.input, `${where}.input`);
  exactKeys(value.input, new Set(['payload', 'sources', 'hash', 'byteLength']), `${where}.input`);
  object(value.input.payload, `${where}.input.payload`);
  object(value.input.sources, `${where}.input.sources`);
  for (const [key, source] of Object.entries(value.input.sources)) {
    string(key, `${where}.input.sources key`);
    parseSourceRef(source, `${where}.input.sources.${key}`);
  }
  hash(value.input.hash, `${where}.input.hash`);
  integer(value.input.byteLength, `${where}.input.byteLength`, NATIVE_FUNCTION_INPUT_BYTES_MAX);
  return value as unknown as NativeFunctionInvocationV1;
}

export function parseNativeFunctionOutcome(
  value: unknown,
  maximumOutputBytes: number,
): NativeFunctionOutcomeV1 {
  const where = 'nativeFunctionOutcome';
  object(value, where);
  schemaVersion(value.schemaVersion, where);
  integer(maximumOutputBytes, 'maximumOutputBytes', NATIVE_FUNCTION_OUTPUT_BYTES_MAX);
  integer(value.attempt, `${where}.attempt`, MAX_ATTEMPTS);
  if (value.status === 'succeeded') {
    exactKeys(
      value,
      new Set([
        'schemaVersion',
        'status',
        'output',
        'outputHash',
        'outputByteLength',
        'evidenceRefs',
        'attempt',
      ]),
      where,
    );
    object(value.output, `${where}.output`);
    hash(value.outputHash, `${where}.outputHash`);
    const outputBytes = integer(
      value.outputByteLength,
      `${where}.outputByteLength`,
      NATIVE_FUNCTION_OUTPUT_BYTES_MAX,
    );
    if (outputBytes > maximumOutputBytes) throw new Error(`${where}.output exceeds budget`);
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 64) {
      throw new Error(`${where}.evidenceRefs must be a bounded array`);
    }
    value.evidenceRefs.forEach((ref, index) => string(ref, `${where}.evidenceRefs[${index}]`));
  } else if (value.status === 'failed') {
    exactKeys(value, new Set(['schemaVersion', 'status', 'failure', 'attempt']), where);
    object(value.failure, `${where}.failure`);
    exactKeys(value.failure, new Set(['code', 'reason', 'retryable']), `${where}.failure`);
    string(value.failure.code, `${where}.failure.code`);
    string(value.failure.reason, `${where}.failure.reason`);
    if (typeof value.failure.retryable !== 'boolean') {
      throw new Error(`${where}.failure.retryable must be boolean`);
    }
  } else if (value.status === 'cancelled') {
    exactKeys(value, new Set(['schemaVersion', 'status', 'reason', 'attempt']), where);
    string(value.reason, `${where}.reason`);
  } else {
    throw new Error(`${where}.status is invalid`);
  }
  return value as unknown as NativeFunctionOutcomeV1;
}

export function parseNativeFunctionCallbackClaim(
  value: unknown,
  maximumOutputBytes: number,
): NativeFunctionCallbackClaimV1 {
  const where = 'nativeFunctionCallbackClaim';
  object(value, where);
  exactKeys(
    value,
    new Set(['schemaVersion', 'executionId', 'sourceEventId', 'invocationHash', 'outcome']),
    where,
  );
  schemaVersion(value.schemaVersion, where);
  if (typeof value.executionId !== 'string' || !EXECUTION_ID_PATTERN.test(value.executionId)) {
    throw new Error(`${where}.executionId is invalid`);
  }
  eventId(value.sourceEventId, `${where}.sourceEventId`);
  hash(value.invocationHash, `${where}.invocationHash`);
  parseNativeFunctionOutcome(value.outcome, maximumOutputBytes);
  return value as unknown as NativeFunctionCallbackClaimV1;
}

export function parseNativeFunctionReceipt(
  value: unknown,
  maximumOutputBytes: number,
): NativeFunctionReceiptV1 {
  const where = 'nativeFunctionReceipt';
  object(value, where);
  exactKeys(
    value,
    new Set([
      'schemaVersion',
      'executionId',
      'sourceEventId',
      'invocationHash',
      'capability',
      'profile',
      'inputHash',
      'outcome',
      'callback',
    ]),
    where,
  );
  schemaVersion(value.schemaVersion, where);
  if (typeof value.executionId !== 'string' || !EXECUTION_ID_PATTERN.test(value.executionId)) {
    throw new Error(`${where}.executionId is invalid`);
  }
  eventId(value.sourceEventId, `${where}.sourceEventId`);
  hash(value.invocationHash, `${where}.invocationHash`);
  compactRef(value.capability, `${where}.capability`, ['name', 'hash']);
  compactRef(value.profile, `${where}.profile`, [
    'ref',
    'version',
    'handlerRef',
    'adapterVersion',
    'limitsHash',
  ]);
  hash(value.inputHash, `${where}.inputHash`);
  parseNativeFunctionOutcome(value.outcome, maximumOutputBytes);
  object(value.callback, `${where}.callback`);
  const callbackKeys = new Set(['commandId', 'action', 'outcome', 'reason']);
  exactKeys(value.callback, callbackKeys, `${where}.callback`);
  if (value.callback.commandId !== `function-finalize:${value.executionId}`) {
    throw new Error(`${where}.callback.commandId does not match executionId`);
  }
  string(value.callback.action, `${where}.callback.action`);
  if (!['accepted', 'rejected', 'suspended'].includes(String(value.callback.outcome))) {
    throw new Error(`${where}.callback.outcome is invalid`);
  }
  if (value.callback.reason !== undefined)
    string(value.callback.reason, `${where}.callback.reason`);
  return value as unknown as NativeFunctionReceiptV1;
}
