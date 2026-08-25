import type { T15StoryId } from './t15-story-corpus';

export interface T15AcceptanceEvidence {
  storyId: Extract<T15StoryId, 'U18' | 'U19' | 'U20' | 'U21' | 'U22' | 'U23'>;
  deterministic: readonly string[];
  focusedLiveEval?: string;
  liveClosure: 'not-required' | 'required';
  remaining: readonly string[];
}

/** Auditable routing from Phase G/H stories to narrow evidence; commands stay outside product code. */
export const T15_PHASE_GH_EVIDENCE: readonly T15AcceptanceEvidence[] = [
  {
    storyId: 'U18',
    deterministic: ['apps/web/src/engine/human-agent-parity.test.ts'],
    focusedLiveEval: 'e2e/t15-ai-first-phase-gh.spec.ts',
    liveClosure: 'required',
    remaining: ['run configured real LLM', 'complete attached fact-parity human rubric'],
  },
  {
    storyId: 'U19',
    deterministic: ['apps/web/src/engine/human-agent-parity.test.ts'],
    focusedLiveEval: 'e2e/t15-ai-first-phase-gh.spec.ts',
    liveClosure: 'required',
    remaining: ['run configured real LLM', 'complete attached intent-mapping human rubric'],
  },
  {
    storyId: 'U20',
    deterministic: [
      'packages/engine/src/execution/execution-audit.test.ts',
      'apps/web/src/chat/audit-context.test.ts',
      'packages/agent/src/llm/execution-audit-prompt.test.ts',
    ],
    focusedLiveEval: 'e2e/t15-ai-first-phase-gh.spec.ts',
    liveClosure: 'required',
    remaining: ['run configured real LLM', 'complete attached human explanation rubric'],
  },
  {
    storyId: 'U21',
    deterministic: [
      'packages/engine/src/execution/execution-audit.test.ts',
      'apps/web/src/chat/audit-context.test.ts',
    ],
    focusedLiveEval: 'e2e/t15-ai-first-phase-gh.spec.ts',
    liveClosure: 'required',
    remaining: ['run configured real LLM', 'complete attached provenance explanation rubric'],
  },
  {
    storyId: 'U22',
    deterministic: [
      'packages/agent/src/llm/llm-driver.test.ts',
      'apps/web/src/app/api/chat/route.test.ts',
      'e2e/chat.spec.ts',
      'e2e/t15-u22-failure.spec.ts',
    ],
    liveClosure: 'not-required',
    remaining: [],
  },
  {
    storyId: 'U23',
    deterministic: [
      'packages/agent/src/llm/llm-config.test.ts',
      'packages/agent/src/llm/llm-probe.test.ts',
      'apps/web/src/app/api/chat/route.delegated.test.ts',
    ],
    focusedLiveEval: 'e2e/t15-ai-first-phase-gh.spec.ts',
    liveClosure: 'required',
    remaining: [
      'run configured inline profile evidence',
      'run configured render surface',
      'run configured delegated worker surface',
    ],
  },
] as const;
