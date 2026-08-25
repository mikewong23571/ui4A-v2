export const REPORT_SCHEMA = 'ui4a.story-eval/v1' as const;

export const NON_MUTATING_EVENT_KINDS = new Set([
  'action-rejected',
  'agent-decision',
  'chat-context-updated',
  'chat-message-appended',
  'chat-turn',
  'chat-turn-progress',
  'chat-turn-started',
]);

export interface LlmEvalProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface EvalFrame {
  type?: string;
  message?: { role?: string; text?: string };
  payload?: Record<string, unknown>;
  error?: string;
}

export interface EvalTurn {
  input: string;
  status: number;
  driver: string | null;
  outcome: string | null;
  summary: string | null;
  messages: string[];
  payload: Record<string, unknown>;
  error: string | null;
}

export interface EvalEventEvidence {
  seq: number;
  kind: string;
  rel: string | null;
  targetRel: string | null;
  action: string | null;
  actor: string | null;
}

export interface EvalSafetyEvidence {
  passed: boolean;
  projectionUnchanged: boolean;
  beforeDigest: string;
  afterDigest: string;
  businessMutations: EvalEventEvidence[];
  successfulEffects: { rel: string; action: string }[];
}

export interface EvalFactRef {
  rel: string;
  pointer: string;
}

export interface StoryEvalResult {
  storyId:
    | 'U1'
    | 'U2'
    | 'U3'
    | 'U4'
    | 'U5'
    | 'U6'
    | 'U7'
    | 'U8'
    | 'U9'
    | 'U10'
    | 'U11'
    | 'U12'
    | 'U13'
    | 'U14'
    | 'U15'
    | 'U16'
    | 'U17';
  title: string;
  passed: boolean;
  failures: string[];
  turns: EvalTurn[];
  safety: EvalSafetyEvidence;
  quality: {
    mechanicallyAccepted: boolean;
    sourceRel: string;
    sourceObserved: boolean;
    sourceRels: string[];
    sourceObservations: Record<string, boolean>;
    factRefs: EvalFactRef[];
    requiredFactRefs: EvalFactRef[];
    factRefsSatisfied: boolean;
    exactWordingAsserted: false;
  };
  manualRubric: {
    status: 'pending';
    faithfulness: null;
    usefulness: null;
    conversationalCoherence: null;
    notes: string;
  };
}

export interface StoryEvalReport {
  schema: typeof REPORT_SCHEMA;
  generatedAt: string;
  run: {
    driver: 'llm';
    model: string;
    baseUrl: string;
    database: 'isolated-test';
  };
  stories: StoryEvalResult[];
  summary: {
    passed: number;
    failed: number;
    safetyFailures: number;
  };
}

export interface StoredEventBody {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: string | null;
  params?: Record<string, unknown>;
  detail: unknown;
}

export interface BusinessProjection {
  articles: unknown;
  firstPost: unknown;
  welcomePost: unknown;
}

export interface EvalStoryCapture {
  turns: EvalTurn[];
  beforeProjection: BusinessProjection;
  afterProjection: BusinessProjection;
  appendedEvents: StoredEventBody[];
}

export interface IsolatedStoryFixture {
  prepare(databaseUrl: string): Promise<void>;
}

export interface StoryOutcomeEvaluation {
  storyId: StoryEvalResult['storyId'];
  title: string;
  sourceRel: string;
  additionalSourceRels?: readonly string[];
  requiredFactRefs?: readonly EvalFactRef[];
  turns: EvalTurn[];
  safety: EvalSafetyEvidence;
  accepted: (turns: EvalTurn[]) => boolean;
}
