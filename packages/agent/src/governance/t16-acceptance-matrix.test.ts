import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { T16_STORY_IDS, type T16StoryId } from '../../../../e2e/kits/t16-evidence';

interface StoryAcceptanceRoute {
  storyId: T16StoryId;
  deterministic: string[];
  browser?: string;
  llmVariants?: number;
}

const routes: readonly StoryAcceptanceRoute[] = [
  {
    storyId: 'S1',
    deterministic: ['packages/agent/src/governance/t15-story-corpus.test.ts'],
    browser: 'e2e/eval/t16-real-llm.spec.ts',
    llmVariants: 4,
  },
  {
    storyId: 'S2',
    deterministic: ['apps/web/src/components/chat/floating-chat.test.tsx'],
    browser: 'e2e/chat.spec.ts',
  },
  {
    storyId: 'S3',
    deterministic: ['packages/agent/src/llm/llm-driver.test.ts'],
    browser: 'e2e/eval/t16-real-llm.spec.ts',
    llmVariants: 4,
  },
  {
    storyId: 'S4',
    deterministic: ['apps/web/src/render/presentation/generic.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  {
    storyId: 'S5',
    deterministic: ['apps/web/src/render/presentation/compiler.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  {
    storyId: 'S6',
    deterministic: ['packages/engine/src/presentation/surface/surface.test.ts'],
    browser: 'e2e/eval/t16-real-llm.spec.ts',
    llmVariants: 4,
  },
  {
    storyId: 'S7',
    deterministic: ['packages/engine/src/presentation/scenario.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  { storyId: 'S8', deterministic: ['packages/engine/src/presentation/recipe/resolver.test.ts'] },
  {
    storyId: 'S9',
    deterministic: ['apps/web/src/engine/presentation/runtime.test.ts'],
    llmVariants: 4,
  },
  {
    storyId: 'S10',
    deterministic: ['packages/shared/src/presentation/presentation.test.ts'],
    llmVariants: 4,
  },
  {
    storyId: 'S11',
    deterministic: ['apps/web/src/render/presentation/compiler.test.ts'],
    llmVariants: 4,
  },
  {
    storyId: 'S12',
    deterministic: ['apps/web/src/engine/presentation/recipes.test.ts'],
    llmVariants: 4,
  },
  { storyId: 'S13', deterministic: ['apps/web/src/render/canvas/action-gate.test.ts'] },
  {
    storyId: 'S14',
    deterministic: ['apps/web/src/render/canvas/action-gate.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  {
    storyId: 'S15',
    deterministic: ['apps/web/src/engine/service-tests/service.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  { storyId: 'S16', deterministic: ['apps/web/src/render/presentation/compiler.test.ts'] },
  { storyId: 'S17', deterministic: ['apps/web/src/engine/presentation/runtime.test.ts'] },
  {
    storyId: 'S18',
    deterministic: ['apps/web/src/engine/presentation/runtime.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  { storyId: 'S19', deterministic: ['packages/engine/src/presentation/sidecar/sidecar.test.ts'] },
  { storyId: 'S20', deterministic: ['packages/engine/src/presentation/scenario.test.ts'] },
  { storyId: 'S21', deterministic: ['packages/engine/src/presentation/sidecar/sidecar.test.ts'] },
  { storyId: 'S22', deterministic: ['packages/engine/src/presentation/sidecar/sidecar.test.ts'] },
  { storyId: 'S23', deterministic: ['apps/web/src/engine/presentation/broker.test.ts'] },
  {
    storyId: 'S24',
    deterministic: ['packages/agent/src/presentation/presentation-revision.test.ts'],
    browser: 'e2e/eval/t16-real-llm.spec.ts',
    llmVariants: 4,
  },
  {
    storyId: 'S25',
    deterministic: ['packages/engine/src/presentation/patch.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  {
    storyId: 'S26',
    deterministic: ['apps/web/src/app/api/presentation/sidecar/route.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  {
    storyId: 'S27',
    deterministic: ['packages/engine/src/presentation/recipe/promotion.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  {
    storyId: 'S28',
    deterministic: ['packages/engine/src/presentation/sidecar/sidecar.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
  { storyId: 'S29', deterministic: ['packages/engine/src/presentation/recipe/resolver.test.ts'] },
  { storyId: 'S30', deterministic: ['apps/web/src/engine/presentation/runtime.test.ts'] },
  {
    storyId: 'S31',
    deterministic: ['packages/engine/src/presentation/recipe/promotion.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
    llmVariants: 4,
  },
  {
    storyId: 'S32',
    deterministic: ['packages/db/src/presentation.test.ts'],
    browser: 'e2e/eval/t16-golden.spec.ts',
  },
];

describe('T16 executable story routing', () => {
  it('routes every canonical story to existing evidence and four variants for AI stories', () => {
    expect(routes.map(({ storyId }) => storyId)).toEqual(T16_STORY_IDS);
    for (const route of routes) {
      for (const path of [
        ...route.deterministic,
        ...(route.browser === undefined ? [] : [route.browser]),
      ]) {
        expect(existsSync(path), `${route.storyId} evidence path ${path}`).toBe(true);
      }
      if (route.llmVariants !== undefined) expect(route.llmVariants).toBeGreaterThanOrEqual(4);
    }
  });
});
