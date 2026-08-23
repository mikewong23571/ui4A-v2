import {
  parseAgentDefinitionSource,
  validateAgentDefinitionActivation,
  type AgentDefinitionActivationCheck,
  type AgentDefinitionActivationRegistries,
} from '@ui4a/engine';
import {
  assertAgentAuthoringBrief,
  assertAgentAuthoringResult,
  type AgentAuthoringBrief,
  type AgentAuthoringEvalCase,
  type AgentAuthoringResult,
  type AgentDefinitionRef,
  type AgentDefinitionSource,
  type FlattenedAgentDefinitionArtifact,
  type JsonObject,
} from '@ui4a/shared';

export interface AuthoredDefinitionInspection {
  valid: boolean;
  issues: string[];
  artifact?: FlattenedAgentDefinitionArtifact;
  checks: AgentDefinitionActivationCheck[];
  pendingEvalSuiteRefs: string[];
}

export interface AuthoredDefinitionValidation extends AuthoredDefinitionInspection {
  valid: true;
  artifact: FlattenedAgentDefinitionArtifact;
}

/** Inspect a bounded JSON candidate without converting validation failure into Run failure. */
export function inspectAuthoredAgentDefinition(input: {
  brief: AgentAuthoringBrief;
  candidate: AgentDefinitionSource | JsonObject;
  evalCorpus: AgentAuthoringEvalCase[];
}): AuthoredDefinitionInspection {
  const brief = assertAgentAuthoringBrief(input.brief);
  const issues: string[] = [];
  let candidate: AgentDefinitionSource;
  try {
    candidate = parseAgentDefinitionSource(input.candidate);
  } catch (error) {
    return {
      valid: false,
      issues: [`parse-error: ${error instanceof Error ? error.message : String(error)}`],
      checks: [],
      pendingEvalSuiteRefs: [],
    };
  }
  if (brief.requestedRef !== undefined && candidate.ref !== brief.requestedRef) {
    issues.push(`requestedRef: candidate ${candidate.ref} does not match ${brief.requestedRef}`);
  }
  const definitions = new Map<
    AgentDefinitionRef,
    { status: 'active'; source: AgentDefinitionSource }
  >();
  try {
    for (const source of brief.registry.baseDefinitions) {
      const parsed = parseAgentDefinitionSource(source);
      if (definitions.has(parsed.ref)) issues.push(`duplicate base definition ${parsed.ref}`);
      definitions.set(parsed.ref, { status: 'active', source: parsed });
    }
  } catch (error) {
    issues.push(`base-definition: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (definitions.has(candidate.ref)) issues.push(`candidate ref ${candidate.ref} already exists`);
  definitions.set(candidate.ref, { status: 'active', source: candidate });
  const registries: AgentDefinitionActivationRegistries = {
    runtimeClasses: new Map(
      brief.registry.runtimeClasses.map((runtime) => [runtime.name, new Set(runtime.features)]),
    ),
    tools: new Set(brief.registry.tools),
    resources: new Set(brief.registry.resources),
    contextSources: new Set(brief.registry.contextSources),
    verifiers: new Set(brief.registry.verifiers),
    evalEvidence: new Map(),
  };
  const report = validateAgentDefinitionActivation(candidate.ref, definitions, registries);
  for (const check of report.checks) {
    if (check.name !== 'eval-evidence-valid' && !check.pass) {
      issues.push(`${check.name}: ${(check.detail ?? []).join(', ')}`);
    }
  }
  const pendingEvalSuiteRefs = report.artifact?.definition.evaluationPolicy.evalSuiteRefs ?? [];
  const evalIds = new Set(input.evalCorpus.map((evaluation) => evaluation.id));
  for (const ref of pendingEvalSuiteRefs) {
    if (!evalIds.has(ref)) issues.push(`Eval suite ${ref} is missing from generated corpus`);
  }
  return {
    valid: issues.length === 0 && report.artifact !== undefined,
    issues,
    ...(report.artifact === undefined ? {} : { artifact: report.artifact }),
    checks: report.checks,
    pendingEvalSuiteRefs,
  };
}

/** Strict gate used by Eval and activation preparation, never by initial Draft persistence. */
export function validateAuthoredAgentDefinition(input: {
  brief: AgentAuthoringBrief;
  result: AgentAuthoringResult;
}): AuthoredDefinitionValidation {
  const result = assertAgentAuthoringResult(input.result);
  if (result.status !== 'completed') throw new Error('Agent authoring result is not completed');
  const inspection = inspectAuthoredAgentDefinition({
    brief: input.brief,
    candidate: result.candidate,
    evalCorpus: result.evalCorpus,
  });
  if (!inspection.valid || inspection.artifact === undefined) {
    throw new Error(`authored candidate is invalid: ${inspection.issues.join('; ')}`);
  }
  return { ...inspection, valid: true, artifact: inspection.artifact };
}
