import type { AgentDefinitionSource, JsonObject } from './agent-definition';

export const AGENT_AUTHORING_SCHEMA_VERSION = 1 as const;

export const AGENT_AUTHORING_LIMITS = {
  maxBriefBytes: 512 * 1024,
  maxDescriptionBytes: 64 * 1024,
  maxRegistryItems: 256,
  maxExamples: 32,
  maxEvalCases: 32,
  maxJsonTextBytes: 64 * 1024,
  maxRawEvents: 2_000,
  maxRawBytes: 4 * 1024 * 1024,
  maxRawChunkBytes: 64 * 1024,
} as const;

export interface AgentAuthoringRuntimeClass {
  name: string;
  features: string[];
}

export interface AgentAuthoringRegistry {
  runtimeClasses: AgentAuthoringRuntimeClass[];
  tools: string[];
  resources: string[];
  contextSources: string[];
  verifiers: string[];
  baseDefinitions: AgentDefinitionSource[];
}

export interface AgentAuthoringBudget {
  timeoutSeconds: number;
  maxTurns: number;
  maxRawEvents: number;
  maxRawBytes: number;
  maxRawChunkBytes: number;
}

/** Natural-language request plus the exact registry ceiling visible to the authoring Agent. */
export interface AgentAuthoringBrief {
  schemaVersion: typeof AGENT_AUTHORING_SCHEMA_VERSION;
  description: string;
  requestedRef?: `${string}@${number}`;
  constraints: string[];
  registry: AgentAuthoringRegistry;
  budget: AgentAuthoringBudget;
}

export interface AgentAuthoringExample {
  name: string;
  inputJson: string;
  expectedOutcome: string;
}

export interface AgentAuthoringEvalCase {
  id: string;
  taskJson: string;
  acceptanceCriteria: string[];
}

export interface AgentAuthoringSafety {
  draftOnly: boolean;
  noApprovalRequested: boolean;
  noActivationRequested: boolean;
  noRuntimeOverride: boolean;
}

export interface AgentAuthoringValidation {
  valid: boolean;
  issues: string[];
  pendingEvalSuiteRefs: string[];
  checks: Array<{ name: string; pass: boolean; detail?: string[] }>;
}

/** Draft proposal only. Governance and activation remain outside this specialization. */
export interface AgentAuthoringResult {
  schemaVersion: typeof AGENT_AUTHORING_SCHEMA_VERSION;
  resultId: string;
  status: 'completed' | 'failed';
  summary: string;
  candidate: AgentDefinitionSource | JsonObject;
  examples: AgentAuthoringExample[];
  evalCorpus: AgentAuthoringEvalCase[];
  safety: AgentAuthoringSafety;
  /** Invalid candidates remain revisable Drafts; this never authorizes activation. */
  validation: AgentAuthoringValidation;
}

const token = /^[a-z][a-z0-9._:/@-]{0,127}$/u;
const definitionRef = /^[a-z][a-z0-9-]{0,63}@[1-9][0-9]*$/u;
const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new Error(`${where} contains unknown field ${unknown}`);
}

function text(
  value: unknown,
  where: string,
  maximum = AGENT_AUTHORING_LIMITS.maxDescriptionBytes,
): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where} is required`);
  if (bytes(value) > maximum) throw new Error(`${where} exceeds size limit`);
  return value;
}

function tokens(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.length > AGENT_AUTHORING_LIMITS.maxRegistryItems) {
    throw new Error(`${where} must be a bounded array`);
  }
  const parsed = value.map((item, index) => {
    const parsedToken = text(item, `${where}[${index}]`, 256);
    if (!token.test(parsedToken)) throw new Error(`${where}[${index}] has invalid format`);
    return parsedToken;
  });
  if (new Set(parsed).size !== parsed.length) throw new Error(`${where} contains duplicate values`);
  return parsed;
}

function positive(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new Error(`${where} must be positive`);
  return Number(value);
}

function parseJsonText(value: unknown, where: string): string {
  const serialized = text(value, where, AGENT_AUTHORING_LIMITS.maxJsonTextBytes);
  try {
    JSON.parse(serialized);
  } catch {
    throw new Error(`${where} must contain valid JSON`);
  }
  return serialized;
}

function candidateShape(value: unknown): AgentDefinitionSource | JsonObject {
  if (!record(value)) throw new Error('authoring result candidate must be an object');
  if (bytes(JSON.stringify(value)) > AGENT_AUTHORING_LIMITS.maxBriefBytes) {
    throw new Error('authoring result candidate exceeds size limit');
  }
  return value as AgentDefinitionSource | JsonObject;
}

function baseDefinitionShape(value: unknown): AgentDefinitionSource {
  const candidate = candidateShape(value);
  if (!record(candidate) || candidate.schemaVersion !== 1) {
    throw new Error('Agent authoring base definition schemaVersion is invalid');
  }
  const ref = text(candidate.ref, 'Agent authoring base definition ref', 128);
  if (!definitionRef.test(ref)) throw new Error('Agent authoring base definition ref is invalid');
  const name = text(candidate.name, 'Agent authoring base definition name', 64);
  const version = positive(candidate.version, 'Agent authoring base definition version');
  if (ref !== `${name}@${version}`)
    throw new Error('Agent authoring base definition identity is inconsistent');
  return candidate as unknown as AgentDefinitionSource;
}

export function assertAgentAuthoringBrief(value: unknown): AgentAuthoringBrief {
  if (!record(value) || value.schemaVersion !== AGENT_AUTHORING_SCHEMA_VERSION) {
    throw new Error('Agent authoring brief must use schemaVersion 1');
  }
  exact(
    value,
    ['schemaVersion', 'description', 'requestedRef', 'constraints', 'registry', 'budget'],
    'Agent authoring brief',
  );
  text(value.description, 'Agent authoring description');
  if (
    value.requestedRef !== undefined &&
    (typeof value.requestedRef !== 'string' || !definitionRef.test(value.requestedRef))
  ) {
    throw new Error('Agent authoring requestedRef must be an exact name@version');
  }
  if (
    !Array.isArray(value.constraints) ||
    value.constraints.length > AGENT_AUTHORING_LIMITS.maxRegistryItems ||
    value.constraints.some((item) => typeof item !== 'string')
  ) {
    throw new Error('Agent authoring constraints must be a bounded string array');
  }
  if (!record(value.registry)) throw new Error('Agent authoring registry is invalid');
  exact(
    value.registry,
    ['runtimeClasses', 'tools', 'resources', 'contextSources', 'verifiers', 'baseDefinitions'],
    'Agent authoring registry',
  );
  if (
    !Array.isArray(value.registry.runtimeClasses) ||
    value.registry.runtimeClasses.length === 0 ||
    value.registry.runtimeClasses.length > AGENT_AUTHORING_LIMITS.maxRegistryItems
  ) {
    throw new Error('Agent authoring runtimeClasses must be non-empty and bounded');
  }
  const runtimeNames = new Set<string>();
  for (const [index, runtime] of value.registry.runtimeClasses.entries()) {
    if (!record(runtime)) throw new Error(`Agent authoring runtimeClasses[${index}] is invalid`);
    exact(runtime, ['name', 'features'], `Agent authoring runtimeClasses[${index}]`);
    const name = text(runtime.name, `Agent authoring runtimeClasses[${index}].name`, 128);
    if (!token.test(name))
      throw new Error(`Agent authoring runtimeClasses[${index}].name is invalid`);
    if (runtimeNames.has(name))
      throw new Error('Agent authoring runtimeClasses contains duplicate names');
    runtimeNames.add(name);
    tokens(runtime.features, `Agent authoring runtimeClasses[${index}].features`);
  }
  tokens(value.registry.tools, 'Agent authoring registry tools');
  tokens(value.registry.resources, 'Agent authoring registry resources');
  tokens(value.registry.contextSources, 'Agent authoring registry contextSources');
  tokens(value.registry.verifiers, 'Agent authoring registry verifiers');
  if (
    !Array.isArray(value.registry.baseDefinitions) ||
    value.registry.baseDefinitions.length > AGENT_AUTHORING_LIMITS.maxRegistryItems
  ) {
    throw new Error('Agent authoring baseDefinitions must be bounded');
  }
  value.registry.baseDefinitions.forEach(baseDefinitionShape);
  if (!record(value.budget)) throw new Error('Agent authoring budget is invalid');
  exact(
    value.budget,
    ['timeoutSeconds', 'maxTurns', 'maxRawEvents', 'maxRawBytes', 'maxRawChunkBytes'],
    'Agent authoring budget',
  );
  positive(value.budget.timeoutSeconds, 'Agent authoring budget timeoutSeconds');
  positive(value.budget.maxTurns, 'Agent authoring budget maxTurns');
  positive(value.budget.maxRawEvents, 'Agent authoring budget maxRawEvents');
  positive(value.budget.maxRawBytes, 'Agent authoring budget maxRawBytes');
  positive(value.budget.maxRawChunkBytes, 'Agent authoring budget maxRawChunkBytes');
  if (
    Number(value.budget.maxRawEvents) > AGENT_AUTHORING_LIMITS.maxRawEvents ||
    Number(value.budget.maxRawBytes) > AGENT_AUTHORING_LIMITS.maxRawBytes ||
    Number(value.budget.maxRawChunkBytes) > AGENT_AUTHORING_LIMITS.maxRawChunkBytes
  ) {
    throw new Error('Agent authoring budget exceeds protocol limits');
  }
  if (bytes(JSON.stringify(value)) > AGENT_AUTHORING_LIMITS.maxBriefBytes)
    throw new Error('Agent authoring brief exceeds size limit');
  return value as unknown as AgentAuthoringBrief;
}

export function assertAgentAuthoringResult(value: unknown): AgentAuthoringResult {
  if (!record(value) || value.schemaVersion !== AGENT_AUTHORING_SCHEMA_VERSION) {
    throw new Error('Agent authoring result must use schemaVersion 1');
  }
  exact(
    value,
    [
      'schemaVersion',
      'resultId',
      'status',
      'summary',
      'candidate',
      'examples',
      'evalCorpus',
      'safety',
      'validation',
    ],
    'Agent authoring result',
  );
  text(value.resultId, 'Agent authoring resultId', 128);
  if (value.status !== 'completed' && value.status !== 'failed')
    throw new Error('Agent authoring result status is invalid');
  text(value.summary, 'Agent authoring result summary');
  candidateShape(value.candidate);
  if (
    !Array.isArray(value.examples) ||
    value.examples.length === 0 ||
    value.examples.length > AGENT_AUTHORING_LIMITS.maxExamples
  ) {
    throw new Error('Agent authoring examples must be non-empty and bounded');
  }
  for (const [index, example] of value.examples.entries()) {
    if (!record(example)) throw new Error(`Agent authoring examples[${index}] is invalid`);
    exact(example, ['name', 'inputJson', 'expectedOutcome'], `Agent authoring examples[${index}]`);
    text(example.name, `Agent authoring examples[${index}].name`, 256);
    parseJsonText(example.inputJson, `Agent authoring examples[${index}].inputJson`);
    text(example.expectedOutcome, `Agent authoring examples[${index}].expectedOutcome`);
  }
  if (
    !Array.isArray(value.evalCorpus) ||
    value.evalCorpus.length === 0 ||
    value.evalCorpus.length > AGENT_AUTHORING_LIMITS.maxEvalCases
  ) {
    throw new Error('Agent authoring evalCorpus must be non-empty and bounded');
  }
  const evalIds = new Set<string>();
  for (const [index, evaluation] of value.evalCorpus.entries()) {
    if (!record(evaluation)) throw new Error(`Agent authoring evalCorpus[${index}] is invalid`);
    exact(
      evaluation,
      ['id', 'taskJson', 'acceptanceCriteria'],
      `Agent authoring evalCorpus[${index}]`,
    );
    const id = text(evaluation.id, `Agent authoring evalCorpus[${index}].id`, 128);
    if (!token.test(id)) throw new Error(`Agent authoring evalCorpus[${index}].id is invalid`);
    if (evalIds.has(id)) throw new Error('Agent authoring evalCorpus contains duplicate IDs');
    evalIds.add(id);
    parseJsonText(evaluation.taskJson, `Agent authoring evalCorpus[${index}].taskJson`);
    if (
      !Array.isArray(evaluation.acceptanceCriteria) ||
      evaluation.acceptanceCriteria.length === 0 ||
      evaluation.acceptanceCriteria.some((item) => typeof item !== 'string' || item.trim() === '')
    ) {
      throw new Error(`Agent authoring evalCorpus[${index}].acceptanceCriteria is invalid`);
    }
  }
  const safety = value.safety;
  const safetyKeys = [
    'draftOnly',
    'noApprovalRequested',
    'noActivationRequested',
    'noRuntimeOverride',
  ] as const;
  if (
    !record(safety) ||
    Object.keys(safety).length !== safetyKeys.length ||
    safetyKeys.some((key) => safety[key] !== true)
  ) {
    throw new Error('Agent authoring safety claims must all be true');
  }
  const validation = value.validation;
  if (!record(validation)) throw new Error('Agent authoring validation is invalid');
  exact(
    validation,
    ['valid', 'issues', 'pendingEvalSuiteRefs', 'checks'],
    'Agent authoring validation',
  );
  if (typeof validation.valid !== 'boolean')
    throw new Error('Agent authoring validation.valid is invalid');
  if (
    !Array.isArray(validation.issues) ||
    validation.issues.some((issue) => typeof issue !== 'string')
  ) {
    throw new Error('Agent authoring validation.issues is invalid');
  }
  tokens(validation.pendingEvalSuiteRefs, 'Agent authoring validation.pendingEvalSuiteRefs');
  if (!Array.isArray(validation.checks))
    throw new Error('Agent authoring validation.checks is invalid');
  for (const [index, check] of validation.checks.entries()) {
    if (!record(check)) throw new Error(`Agent authoring validation.checks[${index}] is invalid`);
    exact(check, ['name', 'pass', 'detail'], `Agent authoring validation.checks[${index}]`);
    text(check.name, `Agent authoring validation.checks[${index}].name`, 128);
    if (typeof check.pass !== 'boolean')
      throw new Error(`Agent authoring validation.checks[${index}].pass is invalid`);
    if (
      check.detail !== undefined &&
      (!Array.isArray(check.detail) || check.detail.some((item) => typeof item !== 'string'))
    ) {
      throw new Error(`Agent authoring validation.checks[${index}].detail is invalid`);
    }
  }
  return value as unknown as AgentAuthoringResult;
}
