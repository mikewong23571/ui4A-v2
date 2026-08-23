import type {
  AgentDefinition,
  AgentDefinitionRef,
  FlattenedAgentDefinitionArtifact,
  JsonObject,
  JsonValue,
} from '@ui4a/shared';

import {
  AgentDefinitionDerivationError,
  resolveAgentDefinition,
  type AgentDefinitionSourceRegistry,
} from './derive';

export type AgentDefinitionActivationCheckName =
  | 'prompt-bindings-valid'
  | 'runtime-features-valid'
  | 'tools-registered'
  | 'resource-policy-valid'
  | 'verifiers-registered'
  | 'eval-evidence-valid'
  | 'derivation-acyclic';

export interface AgentDefinitionActivationCheck {
  name: AgentDefinitionActivationCheckName;
  pass: boolean;
  detail?: string[];
}

export interface AgentEvalEvidence {
  passed: boolean;
  score: number;
  artifactHash: string;
}

/** Server-owned registries used by Agent Definition activation checks. */
export interface AgentDefinitionActivationRegistries {
  runtimeClasses: ReadonlyMap<string, ReadonlySet<string>>;
  tools: ReadonlySet<string>;
  resources: ReadonlySet<string>;
  contextSources: ReadonlySet<string>;
  verifiers: ReadonlySet<string>;
  evalEvidence: ReadonlyMap<string, AgentEvalEvidence>;
}

export interface AgentDefinitionActivationReport {
  artifact?: FlattenedAgentDefinitionArtifact;
  checks: AgentDefinitionActivationCheck[];
  pass: boolean;
}

function decodePointer(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function resolveLocalRef(root: JsonObject, schema: JsonObject): JsonObject | undefined {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  if (!ref.startsWith('#/')) return undefined;
  let current: JsonValue | undefined = root;
  for (const token of decodePointer(ref.slice(1))) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = current[token];
  }
  return current !== null && typeof current === 'object' && !Array.isArray(current)
    ? (current as JsonObject)
    : undefined;
}

function schemaDeclaresPointer(root: JsonObject, pointer: string): boolean {
  let current: JsonObject | undefined = root;
  const visitedRefs = new Set<string>();
  const dereference = (): boolean => {
    while (current !== undefined && typeof current.$ref === 'string') {
      if (visitedRefs.has(current.$ref)) return false;
      visitedRefs.add(current.$ref);
      current = resolveLocalRef(root, current);
      if (current === undefined) return false;
    }
    return current !== undefined;
  };
  if (!dereference()) return false;
  for (const token of decodePointer(pointer)) {
    if (!dereference() || current === undefined) return false;
    const properties = current.properties;
    if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      const next = properties[token];
      if (next !== null && typeof next === 'object' && !Array.isArray(next)) {
        current = next as JsonObject;
        continue;
      }
    }
    const items = current.items;
    if (
      /^(0|[1-9][0-9]*)$/.test(token) &&
      items !== null &&
      typeof items === 'object' &&
      !Array.isArray(items)
    ) {
      current = items as JsonObject;
      continue;
    }
    return false;
  }
  return dereference();
}

function promptIssues(definition: AgentDefinition): string[] {
  const issues: string[] = [];
  for (const block of definition.prompt.blocks) {
    if (block.purpose === 'authority' && block.role !== 'system') {
      issues.push(`prompt block ${block.id}: authority purpose requires system role`);
    }
    if (block.purpose === 'authority' && block.sealed !== true) {
      issues.push(`prompt block ${block.id}: authority block must be sealed`);
    }
    if ('literal' in block) continue;
    const binding = block.binding;
    if (binding.source === 'task') {
      if (block.role !== 'user' || block.purpose !== 'task-data') {
        issues.push(`prompt block ${block.id}: task binding requires user task-data block`);
      }
      if (!schemaDeclaresPointer(definition.contracts.inputSchema, binding.pointer)) {
        issues.push(`prompt block ${block.id}: task pointer ${binding.pointer} is not declared`);
      }
    }
    if (binding.source === 'context') {
      if (block.role !== 'user' || block.purpose !== 'context-data') {
        issues.push(`prompt block ${block.id}: context binding requires user context-data block`);
      }
      if (
        definition.contracts.contextSchema === undefined ||
        !schemaDeclaresPointer(definition.contracts.contextSchema, binding.pointer)
      ) {
        issues.push(`prompt block ${block.id}: context pointer ${binding.pointer} is not declared`);
      }
    }
    if (binding.source === 'policy') {
      if (block.purpose !== 'policy-data' && block.purpose !== 'authority') {
        issues.push(
          `prompt block ${block.id}: policy binding requires policy-data or authority purpose`,
        );
      }
      if (
        definition.contracts.policySchema === undefined ||
        !schemaDeclaresPointer(definition.contracts.policySchema, binding.pointer)
      ) {
        issues.push(`prompt block ${block.id}: policy pointer ${binding.pointer} is not declared`);
      }
    }
  }
  return issues;
}

function makeCheck(
  name: AgentDefinitionActivationCheckName,
  detail: string[],
): AgentDefinitionActivationCheck {
  return { name, pass: detail.length === 0, ...(detail.length === 0 ? {} : { detail }) };
}

/**
 * Evaluate every activation invariant without short-circuiting. If derivation fails, the
 * other checks report that the effective definition is unavailable rather than passing vacuously.
 */
export function validateAgentDefinitionActivation(
  candidateRef: AgentDefinitionRef,
  definitions: AgentDefinitionSourceRegistry,
  registries: AgentDefinitionActivationRegistries,
): AgentDefinitionActivationReport {
  let artifact: FlattenedAgentDefinitionArtifact | undefined;
  const derivationIssues: string[] = [];
  const entry = definitions.get(candidateRef);
  if (entry === undefined) {
    derivationIssues.push(`agent definition ${candidateRef} is missing`);
  } else {
    try {
      artifact = resolveAgentDefinition(entry.source, definitions);
    } catch (error) {
      derivationIssues.push(
        error instanceof AgentDefinitionDerivationError
          ? error.message
          : `derivation failed: ${String(error)}`,
      );
    }
  }
  const unavailable =
    artifact === undefined ? ['effective definition unavailable because derivation failed'] : [];
  const definition = artifact?.definition;

  const prompt = definition === undefined ? unavailable : promptIssues(definition);
  const runtime: string[] = [...unavailable];
  const tools: string[] = [...unavailable];
  const resources: string[] = [...unavailable];
  const verifiers: string[] = [...unavailable];
  const evals: string[] = [...unavailable];
  if (definition !== undefined) {
    const availableFeatures = registries.runtimeClasses.get(definition.runtimeRequirements.class);
    if (availableFeatures === undefined) {
      runtime.push(`runtime class ${definition.runtimeRequirements.class} is not registered`);
    } else {
      for (const feature of definition.runtimeRequirements.features) {
        if (!availableFeatures.has(feature))
          runtime.push(`runtime feature ${feature} is unavailable`);
      }
    }
    for (const tool of definition.policies.tools.allowed) {
      if (!registries.tools.has(tool)) tools.push(`tool ${tool} is not registered`);
    }
    for (const resource of definition.policies.resources.allowed) {
      if (!registries.resources.has(resource))
        resources.push(`resource ${resource} is not registered`);
    }
    for (const source of definition.policies.context.allowedSources) {
      if (!registries.contextSources.has(source))
        resources.push(`context source ${source} is not registered`);
    }
    for (const verifier of definition.evaluationPolicy.verifiers) {
      if (!registries.verifiers.has(verifier))
        verifiers.push(`verifier ${verifier} is not registered`);
    }
    if (definition.evaluationPolicy.verifiers.length === 0) {
      verifiers.push('at least one verifier is required');
    }
    if (definition.evaluationPolicy.evalSuiteRefs.length === 0) {
      evals.push('at least one eval evidence reference is required');
    }
    for (const evalRef of definition.evaluationPolicy.evalSuiteRefs) {
      const evidence = registries.evalEvidence.get(evalRef);
      if (evidence === undefined) evals.push(`eval evidence ${evalRef} is missing`);
      else if (!evidence.passed) evals.push(`eval evidence ${evalRef} did not pass`);
      else if (
        !Number.isFinite(evidence.score) ||
        evidence.score < 0 ||
        evidence.score > 1 ||
        !/^sha256:[0-9a-f]{64}$/.test(evidence.artifactHash)
      ) {
        evals.push(`eval evidence ${evalRef} is malformed`);
      } else if (
        definition.evaluationPolicy.minimumScore !== undefined &&
        evidence.score < definition.evaluationPolicy.minimumScore
      ) {
        evals.push(
          `eval evidence ${evalRef} score ${evidence.score} is below ${definition.evaluationPolicy.minimumScore}`,
        );
      }
    }
  }

  const checks = [
    makeCheck('prompt-bindings-valid', prompt),
    makeCheck('runtime-features-valid', runtime),
    makeCheck('tools-registered', tools),
    makeCheck('resource-policy-valid', resources),
    makeCheck('verifiers-registered', verifiers),
    makeCheck('eval-evidence-valid', evals),
    makeCheck('derivation-acyclic', derivationIssues),
  ];
  return {
    ...(artifact === undefined ? {} : { artifact }),
    checks,
    pass: checks.every((check) => check.pass),
  };
}
