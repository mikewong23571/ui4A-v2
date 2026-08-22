import { describe, expect, it } from 'vitest';

import {
  T16_STORY_IDS,
  T16_TECHNICAL_STORY_IDS,
  createT16StoryEvidence,
  summarizeT16Evidence,
} from '../../../e2e/t16-evidence';

describe('T16 presentation evidence contract', () => {
  it('enumerates every user and technical story exactly once', () => {
    expect(T16_STORY_IDS).toHaveLength(32);
    expect(new Set(T16_STORY_IDS).size).toBe(32);
    expect(T16_TECHNICAL_STORY_IDS).toHaveLength(18);
    expect(new Set(T16_TECHNICAL_STORY_IDS).size).toBe(18);
  });

  it('records semantic, safety, fastpath, browser, and rubric evidence', () => {
    const evidence = createT16StoryEvidence({
      storyId: 'S18',
      scenarioId: 'canonical',
      variant: 'canonical',
      driver: 'llm',
      model: 'configured-model',
      outcome: 'passed',
      semantic: { passed: true, notes: ['same sidecar id and version'] },
      safety: { passed: true, failures: [], businessEventDelta: [] },
      presentation: {
        hitPath: 'user-cache',
        chatLlmCalls: 0,
        presentationLlmCalls: 0,
        dependencyValidation: 'valid',
        firstUsableMs: 112,
      },
      browser: { completed: true, assertions: ['chat', 'canvas', 'direct'] },
      rubric: { engineering: 5, human: 4, notes: ['cross-session fastpath'] },
      technicalStories: ['TS13', 'TS14'],
    });

    expect(evidence.presentation.hitPath).toBe('user-cache');
    expect(evidence.presentation.chatLlmCalls).toBe(0);
    expect(evidence.technicalStories).toEqual(['TS13', 'TS14']);
  });

  it('summarizes quality separately from mechanical safety', () => {
    const passing = createT16StoryEvidence({
      storyId: 'S1',
      scenarioId: 'canonical',
      variant: 'canonical',
      driver: 'llm',
      model: 'configured-model',
      outcome: 'passed',
      semantic: { passed: true, notes: [] },
      safety: { passed: true, failures: [], businessEventDelta: [] },
      presentation: {
        hitPath: 'none',
        chatLlmCalls: 1,
        presentationLlmCalls: 0,
        dependencyValidation: 'not-applicable',
      },
      browser: { completed: true, assertions: [] },
      rubric: { engineering: 4, human: 4, notes: [] },
      technicalStories: ['TS2'],
    });
    const unsafe = createT16StoryEvidence({
      ...passing,
      storyId: 'S29',
      safety: { passed: false, failures: ['nested rel leaked'], businessEventDelta: [] },
      outcome: 'failed',
      technicalStories: ['TS5', 'TS15'],
    });

    expect(summarizeT16Evidence([passing, unsafe])).toEqual({
      scenarios: 2,
      passed: 1,
      semanticSuccessRate: 1,
      safetyFailures: 1,
      browserCompletionRate: 1,
      engineeringRubricMean: 4,
      humanRubricMean: 4,
    });
  });
});
