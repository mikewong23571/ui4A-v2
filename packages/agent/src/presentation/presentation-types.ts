/**
 * Independent Presentation Agent 的公开类型(从 presentation-agent.ts 拆出,行为不变)。
 */
import type {
  ApplicationRenderRecipeCandidate,
  ScenarioDescriptor,
  SemanticRegionRole,
  SurfaceCatalogBinding,
} from '@ui4a/engine';

import type { LlmDriverOptions } from '../llm/llm-driver';

/** Explicit alias documents that generation consumes the pure engine descriptor, not Chat state. */
export type PresentationScenarioDescriptor = ScenarioDescriptor;

export interface PresentationDefinitionSummary {
  kind: 'application' | 'flow' | 'entity' | 'action' | 'capability';
  ref: string;
  version: string;
  /** Structural contract pointers that a property/item binding may dereference at runtime. */
  allowedPointers?: readonly string[];
}

export interface PresentationCatalogBindingSummary {
  name: string;
  sources: SurfaceCatalogBinding['sources'];
  required: boolean;
}

export interface PresentationCatalogWordSummary {
  name: string;
  roles: readonly SemanticRegionRole[];
  bindings: readonly PresentationCatalogBindingSummary[];
}

export interface PresentationCatalogSummary {
  id: string;
  version: string;
  words: readonly PresentationCatalogWordSummary[];
}

export interface PresentationExample {
  scenarioKind: string;
  /** Bare, binding-only template. Dependency and provenance fields are intentionally absent. */
  surfaceTemplate: unknown;
}

export interface PresentationGenerationInput {
  scenario: PresentationScenarioDescriptor;
  definitions: readonly PresentationDefinitionSummary[];
  catalog: PresentationCatalogSummary;
  examples?: readonly PresentationExample[];
}

export type PresentationFailureCode =
  'configuration-unavailable' | 'context-invalid' | 'transport-failed' | 'output-invalid';

export type PresentationGenerationResult =
  | { status: 'candidate'; candidate: ApplicationRenderRecipeCandidate }
  | { status: 'failed'; reasonCode: PresentationFailureCode; issues: string[] };

export interface PresentationAgent {
  generate(input: PresentationGenerationInput): Promise<PresentationGenerationResult>;
}

export interface PresentationAgentOptions extends LlmDriverOptions {
  timeoutMs?: number;
  now?: () => Date;
}

export interface PresentationCandidateProvenance {
  model: string;
  generatedAt: string;
}
