import { describe, expect, it } from 'vitest';

import { T15_STORY_CORPUS, type T15StoryId } from '../../../e2e/t15-story-corpus';

const EXPECTED_IDS = Array.from({ length: 23 }, (_, index) => `U${index + 1}` as T15StoryId);

describe('T15 Phase H story corpus contract', () => {
  it('covers U1-U23 exactly once with one canonical and four variants', () => {
    expect(T15_STORY_CORPUS.map((story) => story.storyId)).toEqual(EXPECTED_IDS);
    for (const story of T15_STORY_CORPUS) {
      expect(
        story.scenarios.map((scenario) => scenario.id),
        story.storyId,
      ).toEqual(['canonical', 'variant-1', 'variant-2', 'variant-3', 'variant-4']);
      expect(
        story.scenarios.every((scenario) => scenario.inputs.length > 0),
        story.storyId,
      ).toBe(true);
      expect(
        story.scenarios.every((scenario) =>
          scenario.inputs.every((input) => input.trim().length > 0),
        ),
        story.storyId,
      ).toBe(true);
    }
  });

  it('forbids exact wording and fixed tool-trace acceptance by construction', () => {
    for (const story of T15_STORY_CORPUS) {
      expect(story.oracle.exactWording, story.storyId).toBe(false);
      expect(story.oracle.fixedToolTrace, story.storyId).toBe(false);
      expect(story.oracle.quality.length, story.storyId).toBeGreaterThan(0);
      expect(story.oracle.safety.length, story.storyId).toBeGreaterThan(0);
    }
  });

  it('keeps AI-quality stories on real-LLM or hybrid acceptance', () => {
    const llmRequired = [
      'U1',
      'U2',
      'U3',
      'U4',
      'U5',
      'U6',
      'U7',
      'U8',
      'U9',
      'U10',
      'U11',
      'U12',
      'U13',
      'U14',
      'U15',
      'U16',
      'U17',
      'U18',
      'U19',
      'U20',
      'U21',
      'U23',
    ] satisfies T15StoryId[];
    for (const storyId of llmRequired) {
      expect(T15_STORY_CORPUS.find((story) => story.storyId === storyId)?.acceptance).not.toBe(
        'mechanical',
      );
    }
    expect(T15_STORY_CORPUS.find((story) => story.storyId === 'U22')?.acceptance).toBe(
      'mechanical',
    );
  });
});
