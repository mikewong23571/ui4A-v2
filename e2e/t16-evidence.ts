/** Versioned evidence contract for T16 story-level acceptance reports. */

export const T16_STORY_IDS = Array.from(
  { length: 32 },
  (_, index) => `S${index + 1}` as T16StoryId,
);

export const T16_TECHNICAL_STORY_IDS = Array.from(
  { length: 18 },
  (_, index) => `TS${index + 1}` as T16TechnicalStoryId,
);

export type T16StoryId = `S${number}`;
export type T16TechnicalStoryId = `TS${number}`;
export type T16HitPath =
  | 'user-pinned'
  | 'user-cache'
  | 'promoted-recipe'
  | 'candidate-recipe'
  | 'generic'
  | 'planner'
  | 'none';

export interface T16SemanticEvidence {
  passed: boolean;
  notes: string[];
}

export interface T16SafetyEvidence {
  passed: boolean;
  failures: string[];
  businessEventDelta: string[];
}

export interface T16PresentationEvidence {
  hitPath: T16HitPath;
  chatLlmCalls: number;
  presentationLlmCalls: number;
  dependencyValidation: 'valid' | 'invalid' | 'not-applicable';
  firstUsableMs?: number;
  recipe?: { id: string; version: number };
  sidecar?: { id: string; version: number };
  reusedSubtrees?: string[];
  replannedSubtrees?: string[];
}

export interface T16BrowserEvidence {
  completed: boolean;
  assertions: string[];
}

export interface T16RubricEvidence {
  engineering: number;
  human: number;
  notes: string[];
}

export interface T16StoryEvidence {
  schemaVersion: 1;
  storyId: T16StoryId;
  scenarioId: string;
  variant: 'canonical' | `variant-${number}`;
  driver: 'llm' | 'mechanical' | 'human';
  model: string | null;
  outcome: 'passed' | 'failed' | 'blocked';
  semantic: T16SemanticEvidence;
  safety: T16SafetyEvidence;
  presentation: T16PresentationEvidence;
  browser: T16BrowserEvidence;
  rubric: T16RubricEvidence;
  technicalStories: T16TechnicalStoryId[];
}

export interface T16EvidenceSummary {
  scenarios: number;
  passed: number;
  semanticSuccessRate: number;
  safetyFailures: number;
  browserCompletionRate: number;
  engineeringRubricMean: number;
  humanRubricMean: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function createT16StoryEvidence(
  evidence: Omit<T16StoryEvidence, 'schemaVersion'> | T16StoryEvidence,
): T16StoryEvidence {
  return { ...evidence, schemaVersion: 1 };
}

export function summarizeT16Evidence(evidence: readonly T16StoryEvidence[]): T16EvidenceSummary {
  const scenarios = evidence.length;
  return {
    scenarios,
    passed: evidence.filter((entry) => entry.outcome === 'passed').length,
    semanticSuccessRate:
      scenarios === 0 ? 0 : evidence.filter((entry) => entry.semantic.passed).length / scenarios,
    safetyFailures: evidence.filter((entry) => !entry.safety.passed).length,
    browserCompletionRate:
      scenarios === 0 ? 0 : evidence.filter((entry) => entry.browser.completed).length / scenarios,
    engineeringRubricMean: mean(evidence.map((entry) => entry.rubric.engineering)),
    humanRubricMean: mean(evidence.map((entry) => entry.rubric.human)),
  };
}
