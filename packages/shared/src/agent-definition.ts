/** Wire version for specialized Agent definitions, tasks, results, and run birth references. */
export const AGENT_DEFINITION_SCHEMA_VERSION = 1 as const;

/** Hard protocol ceilings. Deployments may impose lower limits. */
export const AGENT_DEFINITION_LIMITS = {
  maxBytes: 256 * 1024,
  maxDepth: 32,
  maxNodes: 10_000,
  maxPromptBlocks: 128,
  maxBlockLiteralBytes: 32 * 1024,
  maxListItems: 512,
} as const;

export type AgentDefinitionSchemaVersion = typeof AGENT_DEFINITION_SCHEMA_VERSION;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type AgentDefinitionRef = `${string}@${number}`;
export type ContentHash = `sha256:${string}`;

export interface PromptBinding {
  source: 'task' | 'context' | 'policy';
  pointer: string;
  encoding: 'json-delimited';
  required: boolean;
}

interface PromptBlockBase {
  id: string;
  role: 'system' | 'user' | 'assistant';
  purpose: 'authority' | 'instruction' | 'task-data' | 'context-data' | 'policy-data';
  sealed?: boolean;
}

export type PromptBlock = PromptBlockBase &
  ({ literal: string; binding?: never } | { binding: PromptBinding; literal?: never });

export interface PromptTemplate {
  schemaVersion: AgentDefinitionSchemaVersion;
  blocks: PromptBlock[];
}

export interface AgentContracts {
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  contextSchema?: JsonObject;
  policySchema?: JsonObject;
}

export interface RuntimeRequirement {
  class: string;
  features: string[];
}

export interface ToolPolicy {
  allowed: string[];
}

export interface ContextPolicy {
  allowedSources: string[];
  maxItems: number;
}

export interface ResourcePolicy {
  allowed: string[];
}

export interface ArtifactPolicy {
  allowedMediaTypes: string[];
  maxCount: number;
  maxBytes: number;
}

export interface AgentPolicies {
  tools: ToolPolicy;
  context: ContextPolicy;
  resources: ResourcePolicy;
  artifacts: ArtifactPolicy;
}

export interface EvaluationPolicy {
  verifiers: string[];
  evalSuiteRefs: string[];
  minimumScore?: number;
}

/** Complete, provider-neutral specialization definition after derivation is flattened. */
export interface AgentDefinition {
  schemaVersion: AgentDefinitionSchemaVersion;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
  intent: string;
  prompt: PromptTemplate;
  contracts: AgentContracts;
  runtimeRequirements: RuntimeRequirement;
  policies: AgentPolicies;
  evaluationPolicy: EvaluationPolicy;
}

export type AgentDefinitionReplace = Pick<
  AgentDefinition,
  'intent' | 'contracts' | 'runtimeRequirements' | 'policies' | 'evaluationPolicy'
>;

/** Closed specialization patch: section replacement plus append-only Prompt blocks. */
export interface AgentSpecialization {
  replace: Partial<AgentDefinitionReplace>;
  appendPromptBlocks: PromptBlock[];
}

export interface DerivedAgentDefinitionSource {
  schemaVersion: AgentDefinitionSchemaVersion;
  ref: AgentDefinitionRef;
  name: string;
  version: number;
  extends: AgentDefinitionRef;
  specialize: AgentSpecialization;
}

export type AgentDefinitionSource = AgentDefinition | DerivedAgentDefinitionSource;

export interface FlattenedAgentDefinitionArtifact {
  schemaVersion: AgentDefinitionSchemaVersion;
  ref: AgentDefinitionRef;
  source: AgentDefinitionSource;
  derivedFrom?: {
    ref: AgentDefinitionRef;
    flattenedHash: ContentHash;
  };
  definition: AgentDefinition;
  flattenedHash: ContentHash;
}

export interface AgentBudget {
  timeoutSeconds: number;
  maxTurns: number;
  maxCost?: number;
}

export interface AgentContextRef {
  rel: string;
  revision?: number;
}

export interface AgentResourceGrant {
  category: string;
  resourceRef: string;
  permissions: string[];
}

export interface AgentRunBirthRefs {
  definitionRef: AgentDefinitionRef;
  flattenedDefinitionHash: ContentHash;
  promptHash: ContentHash;
  runtimeProfileRef: string;
  runtimeProfileVersion: number;
  taskSchemaHash: ContentHash;
  resultSchemaHash: ContentHash;
}

/** Provider-neutral task envelope after server-owned policy intersection. */
export interface AgentTaskEnvelope {
  schemaVersion: AgentDefinitionSchemaVersion;
  runId: string;
  birth: AgentRunBirthRefs;
  objective: string;
  input: JsonValue;
  context: AgentContextRef[];
  constraints: string[];
  grants: AgentResourceGrant[];
  budget: AgentBudget;
}

export interface AgentArtifactRef {
  hash: ContentHash;
  mediaType: string;
  sizeBytes: number;
  name?: string;
}

export interface AgentEvidenceRef {
  verifier: string;
  artifact: AgentArtifactRef;
  passed: boolean;
}

export interface AgentProposedEffect {
  capability: string;
  action: string;
  parameters: JsonObject;
}

export interface AgentQuestion {
  id: string;
  prompt: string;
  requestedResources?: string[];
}

export interface AgentRunProvenance {
  birth: AgentRunBirthRefs;
  trajectory: AgentArtifactRef;
  providerSessionRef?: string;
}

/** Stable result envelope; specialization-specific output remains schema-validated JSON. */
export interface AgentResultEnvelope {
  schemaVersion: AgentDefinitionSchemaVersion;
  runId: string;
  status: 'completed' | 'needs-input' | 'waiting-approval' | 'blocked' | 'failed' | 'cancelled';
  response?: string;
  output?: JsonValue;
  artifacts: AgentArtifactRef[];
  evidence: AgentEvidenceRef[];
  proposedEffects: AgentProposedEffect[];
  questions: AgentQuestion[];
  provenance: AgentRunProvenance;
}
