import {
  AGENT_DEFINITION_LIMITS,
  AGENT_DEFINITION_SCHEMA_VERSION,
  type AgentContracts,
  type AgentDefinition,
  type AgentDefinitionRef,
  type AgentDefinitionReplace,
  type AgentDefinitionSource,
  type AgentPolicies,
  type ContentHash,
  type EvaluationPolicy,
  type JsonObject,
  type JsonValue,
  type PromptBinding,
  type PromptBlock,
  type PromptTemplate,
  type RuntimeRequirement,
} from '@ui4a/shared';

const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const TOKEN = /^[a-z][a-z0-9._:/@-]{0,127}$/;
const DEFINITION_REF = /^([a-z][a-z0-9-]{0,63})@([1-9][0-9]*)$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new Error(`${where} contains unknown field "${unknown[0]}"`);
}

function requiredString(value: unknown, where: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${where} must be a non-empty string`);
  if (new TextEncoder().encode(value).byteLength > AGENT_DEFINITION_LIMITS.maxBlockLiteralBytes) {
    throw new Error(`${where} exceeds ${AGENT_DEFINITION_LIMITS.maxBlockLiteralBytes} bytes`);
  }
  if (pattern !== undefined && !pattern.test(value)) throw new Error(`${where} has invalid format`);
  return value;
}

function positiveInteger(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${where} must be a positive integer`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${where} must be a non-negative integer`);
  }
  return value as number;
}

function stringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be an array`);
  if (value.length > AGENT_DEFINITION_LIMITS.maxListItems) {
    throw new Error(`${where} exceeds ${AGENT_DEFINITION_LIMITS.maxListItems} items`);
  }
  const parsed = value.map((item, index) => requiredString(item, `${where}[${index}]`, TOKEN));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${where} contains duplicate values`);
  return parsed;
}

function validateJson(value: unknown, where: string): asserts value is JsonValue {
  let nodes = 0;
  const active = new WeakSet<object>();
  const visit = (current: unknown, depth: number, path: string): void => {
    nodes += 1;
    if (nodes > AGENT_DEFINITION_LIMITS.maxNodes) {
      throw new Error(`${where} exceeds ${AGENT_DEFINITION_LIMITS.maxNodes} JSON nodes`);
    }
    if (depth > AGENT_DEFINITION_LIMITS.maxDepth) {
      throw new Error(`${where} exceeds maximum depth ${AGENT_DEFINITION_LIMITS.maxDepth}`);
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error(`${path} contains a non-finite number`);
      return;
    }
    if (typeof current !== 'object') throw new Error(`${path} is not JSON data`);
    if (active.has(current)) throw new Error(`${path} contains a cycle`);
    active.add(current);
    if (Array.isArray(current)) {
      if (current.length > AGENT_DEFINITION_LIMITS.maxListItems) {
        throw new Error(`${path} exceeds ${AGENT_DEFINITION_LIMITS.maxListItems} items`);
      }
      current.forEach((item, index) => visit(item, depth + 1, `${path}/${index}`));
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${path} must contain plain JSON objects`);
      }
      for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
        visit(item, depth + 1, `${path}/${key}`);
      }
    }
    active.delete(current);
  };
  visit(value, 0, where);
}

function jsonObject(value: unknown, where: string): JsonObject {
  validateJson(value, where);
  if (!record(value)) throw new Error(`${where} must be a JSON object`);
  return value as JsonObject;
}

/** Parse and split an immutable exact-version Agent Definition reference. */
export function parseAgentDefinitionRef(
  value: unknown,
  where = 'agent definition ref',
): { ref: AgentDefinitionRef; name: string; version: number } {
  const text = requiredString(value, where);
  const match = DEFINITION_REF.exec(text);
  if (match === null) throw new Error(`${where} must be name@positive-version`);
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version)) throw new Error(`${where} version is too large`);
  return { ref: text as AgentDefinitionRef, name: match[1]!, version };
}

function parseBinding(value: unknown, where: string): PromptBinding {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(value, ['source', 'pointer', 'encoding', 'required'], where);
  if (value.source !== 'task' && value.source !== 'context' && value.source !== 'policy') {
    throw new Error(`${where}.source is invalid`);
  }
  if (typeof value.pointer !== 'string' || !isJsonPointer(value.pointer)) {
    throw new Error(`${where}.pointer must be an RFC 6901 JSON Pointer`);
  }
  if (value.encoding !== 'json-delimited') throw new Error(`${where}.encoding is invalid`);
  if (typeof value.required !== 'boolean') throw new Error(`${where}.required must be boolean`);
  return {
    source: value.source,
    pointer: value.pointer,
    encoding: value.encoding,
    required: value.required,
  };
}

/** Return whether text is a syntactically valid RFC 6901 JSON Pointer. */
export function isJsonPointer(value: string): boolean {
  if (value === '') return true;
  if (!value.startsWith('/')) return false;
  return value
    .split('/')
    .slice(1)
    .every((token) => !/~(?:[^01]|$)/.test(token));
}

/** Parse one strict typed Prompt block; literal and binding are mutually exclusive. */
export function parsePromptBlock(value: unknown, where = 'prompt block'): PromptBlock {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(value, ['id', 'role', 'purpose', 'sealed', 'literal', 'binding'], where);
  const id = requiredString(value.id, `${where}.id`, TOKEN);
  if (value.role !== 'system' && value.role !== 'user' && value.role !== 'assistant') {
    throw new Error(`${where}.role is invalid`);
  }
  const purposes = ['authority', 'instruction', 'task-data', 'context-data', 'policy-data'];
  if (!purposes.includes(value.purpose as string)) throw new Error(`${where}.purpose is invalid`);
  if (value.sealed !== undefined && typeof value.sealed !== 'boolean') {
    throw new Error(`${where}.sealed must be boolean`);
  }
  const hasLiteral = Object.hasOwn(value, 'literal');
  const hasBinding = Object.hasOwn(value, 'binding');
  if (hasLiteral === hasBinding)
    throw new Error(`${where} must contain exactly one of literal or binding`);
  const base = {
    id,
    role: value.role as PromptBlock['role'],
    purpose: value.purpose as PromptBlock['purpose'],
    ...(value.sealed === undefined ? {} : { sealed: value.sealed }),
  };
  if (hasLiteral) {
    const literal = requiredString(value.literal, `${where}.literal`);
    if (/\{\{[^}]+\}\}|\$\{[^}]+\}/.test(literal)) {
      throw new Error(`${where}.literal must not contain template interpolation`);
    }
    return { ...base, literal };
  }
  return { ...base, binding: parseBinding(value.binding, `${where}.binding`) };
}

/** Parse a provider-neutral Prompt Template with stable, unique block IDs. */
export function parsePromptTemplate(value: unknown, where = 'prompt'): PromptTemplate {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(value, ['schemaVersion', 'blocks'], where);
  if (value.schemaVersion !== AGENT_DEFINITION_SCHEMA_VERSION) {
    throw new Error(`${where}.schemaVersion must be ${AGENT_DEFINITION_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.blocks)) throw new Error(`${where}.blocks must be an array`);
  if (value.blocks.length === 0 || value.blocks.length > AGENT_DEFINITION_LIMITS.maxPromptBlocks) {
    throw new Error(
      `${where}.blocks must contain 1-${AGENT_DEFINITION_LIMITS.maxPromptBlocks} items`,
    );
  }
  const blocks = value.blocks.map((block, index) =>
    parsePromptBlock(block, `${where}.blocks[${index}]`),
  );
  if (new Set(blocks.map((block) => block.id)).size !== blocks.length) {
    throw new Error(`${where}.blocks contains duplicate IDs`);
  }
  return { schemaVersion: AGENT_DEFINITION_SCHEMA_VERSION, blocks };
}

function parseContracts(value: unknown, where: string): AgentContracts {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(value, ['inputSchema', 'outputSchema', 'contextSchema', 'policySchema'], where);
  return {
    inputSchema: jsonObject(value.inputSchema, `${where}.inputSchema`),
    outputSchema: jsonObject(value.outputSchema, `${where}.outputSchema`),
    ...(value.contextSchema === undefined
      ? {}
      : { contextSchema: jsonObject(value.contextSchema, `${where}.contextSchema`) }),
    ...(value.policySchema === undefined
      ? {}
      : { policySchema: jsonObject(value.policySchema, `${where}.policySchema`) }),
  };
}

function parseRuntime(value: unknown, where: string): RuntimeRequirement {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(value, ['class', 'features'], where);
  return {
    class: requiredString(value.class, `${where}.class`, TOKEN),
    features: stringList(value.features, `${where}.features`),
  };
}

function parsePolicies(value: unknown, where: string): AgentPolicies {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(value, ['tools', 'context', 'resources', 'artifacts'], where);
  const { tools, context, resources, artifacts } = value;
  if (!record(tools) || !record(context) || !record(resources) || !record(artifacts)) {
    throw new Error(`${where} sections must be objects`);
  }
  exactKeys(tools, ['allowed'], `${where}.tools`);
  exactKeys(context, ['allowedSources', 'maxItems'], `${where}.context`);
  exactKeys(resources, ['allowed'], `${where}.resources`);
  exactKeys(artifacts, ['allowedMediaTypes', 'maxCount', 'maxBytes'], `${where}.artifacts`);
  return {
    tools: { allowed: stringList(tools.allowed, `${where}.tools.allowed`) },
    context: {
      allowedSources: stringList(context.allowedSources, `${where}.context.allowedSources`),
      maxItems: nonNegativeInteger(context.maxItems, `${where}.context.maxItems`),
    },
    resources: { allowed: stringList(resources.allowed, `${where}.resources.allowed`) },
    artifacts: {
      allowedMediaTypes: stringList(
        artifacts.allowedMediaTypes,
        `${where}.artifacts.allowedMediaTypes`,
      ),
      maxCount: nonNegativeInteger(artifacts.maxCount, `${where}.artifacts.maxCount`),
      maxBytes: nonNegativeInteger(artifacts.maxBytes, `${where}.artifacts.maxBytes`),
    },
  };
}

function parseEvaluationPolicy(value: unknown, where: string): EvaluationPolicy {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(value, ['verifiers', 'evalSuiteRefs', 'minimumScore'], where);
  if (
    value.minimumScore !== undefined &&
    (typeof value.minimumScore !== 'number' ||
      !Number.isFinite(value.minimumScore) ||
      value.minimumScore < 0 ||
      value.minimumScore > 1)
  ) {
    throw new Error(`${where}.minimumScore must be between 0 and 1`);
  }
  return {
    verifiers: stringList(value.verifiers, `${where}.verifiers`),
    evalSuiteRefs: stringList(value.evalSuiteRefs, `${where}.evalSuiteRefs`),
    ...(value.minimumScore === undefined ? {} : { minimumScore: value.minimumScore }),
  };
}

function assertIdentity(
  refValue: unknown,
  nameValue: unknown,
  versionValue: unknown,
  where: string,
): { ref: AgentDefinitionRef; name: string; version: number } {
  const parsed = parseAgentDefinitionRef(refValue, `${where}.ref`);
  const name = requiredString(nameValue, `${where}.name`, IDENTIFIER);
  const version = positiveInteger(versionValue, `${where}.version`);
  if (parsed.name !== name || parsed.version !== version) {
    throw new Error(`${where}.ref must equal ${name}@${version}`);
  }
  return { ref: parsed.ref, name, version };
}

/** Parse a strict complete/root Agent Definition. */
export function parseAgentDefinition(value: unknown, where = 'agent definition'): AgentDefinition {
  assertDefinitionLimits(value);
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(
    value,
    [
      'schemaVersion',
      'ref',
      'name',
      'version',
      'intent',
      'prompt',
      'contracts',
      'runtimeRequirements',
      'policies',
      'evaluationPolicy',
    ],
    where,
  );
  if (value.schemaVersion !== AGENT_DEFINITION_SCHEMA_VERSION) {
    throw new Error(`${where}.schemaVersion must be ${AGENT_DEFINITION_SCHEMA_VERSION}`);
  }
  const identity = assertIdentity(value.ref, value.name, value.version, where);
  const parsed: AgentDefinition = {
    schemaVersion: AGENT_DEFINITION_SCHEMA_VERSION,
    ...identity,
    intent: requiredString(value.intent, `${where}.intent`),
    prompt: parsePromptTemplate(value.prompt, `${where}.prompt`),
    contracts: parseContracts(value.contracts, `${where}.contracts`),
    runtimeRequirements: parseRuntime(value.runtimeRequirements, `${where}.runtimeRequirements`),
    policies: parsePolicies(value.policies, `${where}.policies`),
    evaluationPolicy: parseEvaluationPolicy(value.evaluationPolicy, `${where}.evaluationPolicy`),
  };
  assertDefinitionLimits(parsed);
  return parsed;
}

function parseReplace(value: unknown, where: string): Partial<AgentDefinitionReplace> {
  if (!record(value)) throw new Error(`${where} must be an object`);
  exactKeys(
    value,
    ['intent', 'contracts', 'runtimeRequirements', 'policies', 'evaluationPolicy'],
    where,
  );
  return {
    ...(value.intent === undefined
      ? {}
      : { intent: requiredString(value.intent, `${where}.intent`) }),
    ...(value.contracts === undefined
      ? {}
      : { contracts: parseContracts(value.contracts, `${where}.contracts`) }),
    ...(value.runtimeRequirements === undefined
      ? {}
      : {
          runtimeRequirements: parseRuntime(
            value.runtimeRequirements,
            `${where}.runtimeRequirements`,
          ),
        }),
    ...(value.policies === undefined
      ? {}
      : { policies: parsePolicies(value.policies, `${where}.policies`) }),
    ...(value.evaluationPolicy === undefined
      ? {}
      : {
          evaluationPolicy: parseEvaluationPolicy(
            value.evaluationPolicy,
            `${where}.evaluationPolicy`,
          ),
        }),
  };
}

/** Parse a root or exact-parent derived Agent Definition source artifact. */
export function parseAgentDefinitionSource(
  value: unknown,
  where = 'agent definition source',
): AgentDefinitionSource {
  assertDefinitionLimits(value);
  if (!record(value)) throw new Error(`${where} must be an object`);
  if (!Object.hasOwn(value, 'extends')) return parseAgentDefinition(value, where);
  exactKeys(value, ['schemaVersion', 'ref', 'name', 'version', 'extends', 'specialize'], where);
  if (value.schemaVersion !== AGENT_DEFINITION_SCHEMA_VERSION) {
    throw new Error(`${where}.schemaVersion must be ${AGENT_DEFINITION_SCHEMA_VERSION}`);
  }
  const identity = assertIdentity(value.ref, value.name, value.version, where);
  const parent = parseAgentDefinitionRef(value.extends, `${where}.extends`).ref;
  if (!record(value.specialize)) throw new Error(`${where}.specialize must be an object`);
  exactKeys(value.specialize, ['replace', 'appendPromptBlocks'], `${where}.specialize`);
  if (!Array.isArray(value.specialize.appendPromptBlocks)) {
    throw new Error(`${where}.specialize.appendPromptBlocks must be an array`);
  }
  const appendPromptBlocks = value.specialize.appendPromptBlocks.map((block, index) =>
    parsePromptBlock(block, `${where}.specialize.appendPromptBlocks[${index}]`),
  );
  if (appendPromptBlocks.length > AGENT_DEFINITION_LIMITS.maxPromptBlocks) {
    throw new Error(`${where}.specialize.appendPromptBlocks exceeds limit`);
  }
  if (new Set(appendPromptBlocks.map((block) => block.id)).size !== appendPromptBlocks.length) {
    throw new Error(`${where}.specialize.appendPromptBlocks contains duplicate IDs`);
  }
  return {
    schemaVersion: AGENT_DEFINITION_SCHEMA_VERSION,
    ...identity,
    extends: parent,
    specialize: {
      replace: parseReplace(value.specialize.replace, `${where}.specialize.replace`),
      appendPromptBlocks,
    },
  };
}

/** Reject non-JSON, cyclic, excessive, or oversized values before hashing/persistence. */
export function assertDefinitionLimits(value: unknown): void {
  validateJson(value, 'agent definition');
  const bytes = new TextEncoder().encode(canonicalAgentJson(value as JsonValue)).byteLength;
  if (bytes > AGENT_DEFINITION_LIMITS.maxBytes) {
    throw new Error(`agent definition exceeds ${AGENT_DEFINITION_LIMITS.maxBytes} bytes`);
  }
}

/** Canonical JSON recursively sorts object keys while preserving semantic array order. */
export function canonicalAgentJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAgentJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalAgentJson(value[key]!)}`)
    .join(',')}}`;
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function sha256(bytes: Uint8Array): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15]!, 7) ^
        rotateRight(words[index - 15]!, 18) ^
        (words[index - 15]! >>> 3);
      const s1 =
        rotateRight(words[index - 2]!, 17) ^
        rotateRight(words[index - 2]!, 19) ^
        (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + upper + choice + constants[index]! + words[index]!) >>> 0;
      const lower = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (lower + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}

/** Compute a platform-neutral SHA-256 over bounded canonical JSON. */
export function hashCanonicalAgentJson(value: JsonValue): ContentHash {
  assertDefinitionLimits(value);
  return `sha256:${sha256(new TextEncoder().encode(canonicalAgentJson(value)))}`;
}
