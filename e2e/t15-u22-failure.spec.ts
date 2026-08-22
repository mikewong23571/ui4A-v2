/** U22 focused corpus: five natural requests under an explicitly missing LLM profile. */
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './server-kit';
import { runEvalTurn } from './story-eval-kit';
import { T15_STORY_CORPUS } from './t15-story-corpus';

const NON_BUSINESS_KINDS = new Set([
  'agent-decision',
  'chat-context-updated',
  'chat-message-appended',
  'chat-turn',
  'chat-turn-progress',
  'chat-turn-started',
]);

test.beforeEach(() => {
  test.setTimeout(180_000);
});

test('U22 canonical + four variants fail honestly with llm identity and zero business effects', async () => {
  const story = T15_STORY_CORPUS.find((entry) => entry.storyId === 'U22')!;
  await withFreshServer(
    async () => {
      const before = await (await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`)).json();
      const existingEventBody = (await (
        await fetch(`${SCENARIO_BASE}/api/events?afterSeq=0`)
      ).json()) as { events?: { seq: number; kind: string }[] };
      const beforeSeq = existingEventBody.events?.at(-1)?.seq ?? 0;
      for (const [index, scenario] of story.scenarios.entries()) {
        const turn = await runEvalTurn(
          SCENARIO_BASE,
          `t15-u22-${index + 1}`,
          `t15-u22-${index + 1}-1`,
          scenario.inputs[0]!,
        );
        expect(turn.status, scenario.id).toBe(200);
        expect(turn.driver, scenario.id).toBe('llm');
        expect(turn.outcome, scenario.id).toBe('failed');
        const failure = [turn.summary, turn.error, ...turn.messages].filter(Boolean).join('\n');
        expect(failure, scenario.id).toContain('LLM 不可用');
        expect(failure, scenario.id).toContain('配置后可重试');
      }

      const after = await (await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`)).json();
      expect(after).toEqual(before);
      const eventBody = (await (
        await fetch(`${SCENARIO_BASE}/api/events?afterSeq=${beforeSeq}`)
      ).json()) as { events?: { kind: string }[] };
      expect(
        (eventBody.events ?? []).filter((event) => !NON_BUSINESS_KINDS.has(event.kind)),
      ).toEqual([]);
    },
    { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
  );
});
