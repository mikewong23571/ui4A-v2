/**
 * Focused opt-in real-LLM acceptance for T15 Phase G/H.
 *
 * This file is intentionally separate from the long U1-U17 aggregate. It validates the two
 * Phase G/H claims that cannot be closed by deterministic protocol tests alone: an Assistant
 * explanation grounded in execution audit, and the actual inline model identity selected by the
 * external provider-neutral profile. It never asserts exact answer wording or a fixed tool trace.
 *
 * Run explicitly:
 *
 * RUN_LLM_EVAL=1 DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
 * TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
 * LLM_API_KEY=... LLM_BASE_URL=https://provider.example/v1 LLM_MODEL=provider-model \
 * CI=true pnpm exec playwright test --config=playwright.phase-gh-eval.config.ts
 */
import { expect, test, type TestInfo } from '@playwright/test';

import {
  captureReadOnlyStory,
  captureStory,
  expectedExecutedActionSafety,
  isolatedEvalDatabaseUrl,
  loadLlmEvalProfile,
  runEvalTurn,
  withIsolatedStoryServer,
} from '../kits/story-eval-kit';

const RUN_LLM_EVAL = process.env.RUN_LLM_EVAL === '1';

test.skip(!RUN_LLM_EVAL, 'RUN_LLM_EVAL=1 is required for focused Phase G/H real-LLM eval');
test.beforeEach(() => {
  test.setTimeout(420_000);
  expect(process.env.DATABASE_URL).toBe(isolatedEvalDatabaseUrl());
});

interface EventBody {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  detail: unknown;
}

async function events(baseUrl: string): Promise<EventBody[]> {
  const response = await fetch(`${baseUrl}/api/events?afterSeq=0`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events?: EventBody[] }).events ?? [];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function decisionPrompt(event: EventBody | undefined): string {
  const detail = record(event?.detail);
  const prompt = record(detail?.prompt);
  return typeof prompt?.user === 'string' ? prompt.user : '';
}

function turnEvidence(turn: {
  summary: string | null;
  messages: string[];
  payload: Record<string, unknown>;
}): string {
  return JSON.stringify({ summary: turn.summary, messages: turn.messages, payload: turn.payload });
}

async function attachFocusedEvidence(
  testInfo: TestInfo,
  storyId: 'U18' | 'U19' | 'U21',
  profileModel: string,
  body: Record<string, unknown>,
): Promise<void> {
  await testInfo.attach(`t15-${storyId.toLowerCase()}-focused-evidence.json`, {
    body: Buffer.from(
      JSON.stringify(
        {
          schema: 'ui4a.story-eval-focused/v1',
          storyId,
          driver: 'llm',
          model: profileModel,
          exactWordingAsserted: false,
          fixedToolTraceAsserted: false,
          ...body,
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
}

test('U18: real Assistant reads the same authorized article projection as the renderer', async ({}, testInfo) => {
  const profile = loadLlmEvalProfile();
  const evidence = await withIsolatedStoryServer(profile, async (baseUrl) => {
    const rendererEntity = await (
      await fetch(`${baseUrl}/api/entity?rel=${encodeURIComponent('articles')}`)
    ).json();
    const result = await captureReadOnlyStory(baseUrl, async () => [
      await runEvalTurn(
        baseUrl,
        't15-focused-u18',
        't15-focused-u18-1',
        '告诉我《第一篇》的标题、分类和正文主要内容。',
      ),
    ]);
    const turn = result.turns[0]!;
    expect(turn.driver).toBe('llm');
    expect(['answered', 'done']).toContain(turn.outcome);
    expect(result.safety.passed).toBe(true);
    const members = record(rendererEntity)?.entities;
    expect(Array.isArray(members)).toBe(true);
    const memberIndex = (members as unknown[]).findIndex(
      (member) => record(record(member)?.properties)?.rel === 'post:first-post',
    );
    expect(memberIndex).toBeGreaterThanOrEqual(0);
    const fields = record(record((members as unknown[])[memberIndex])?.properties)?.fields;
    const answer = [turn.summary, ...turn.messages].filter(Boolean).join('\n');
    expect(answer.length).toBeGreaterThan(0);
    for (const name of ['title', 'category']) {
      const value = record(fields)?.[name];
      expect(typeof value, `renderer field ${name}`).toBe('string');
      expect(answer, `Assistant omitted renderer field ${name}`).toContain(String(value));
    }
    expect(typeof record(fields)?.body).toBe('string');
    const requiredSources = ['title', 'category', 'body'].map((name) => ({
      rel: 'articles',
      pointer: `/entities/${memberIndex}/properties/fields/${name}`,
    }));
    expect(turn.payload.sources).toEqual(expect.arrayContaining(requiredSources));
    return { rendererEntity, result };
  });

  await attachFocusedEvidence(testInfo, 'U18', profile.model, {
    mechanicalSafetyPassed: evidence.result.safety.passed,
    rendererEntity: evidence.rendererEntity,
    turns: evidence.result.turns,
    manualRubric: {
      status: 'pending',
      criteria: [
        'title and category agree exactly with the renderer projection',
        'body is faithfully summarized and the exact body source is cited',
      ],
    },
  });
});

test('U19: real Assistant maps a natural write request onto the shared action contract', async ({}, testInfo) => {
  const profile = loadLlmEvalProfile();
  const evidence = await withIsolatedStoryServer(profile, async (baseUrl) => {
    const capture = await captureStory(baseUrl, async () => [
      await runEvalTurn(
        baseUrl,
        't15-focused-u19',
        't15-focused-u19-1',
        '把标题叫《第一篇》的文章从线上撤下来。',
      ),
    ]);
    const safety = expectedExecutedActionSafety(capture, {
      rel: 'post:first-post',
      action: 'unpublish',
      beforeNode: 'published',
      afterNode: 'offline',
      unchangedProjection: 'welcomePost',
    });
    expect(capture.turns[0]?.driver).toBe('llm');
    expect(safety.passed).toBe(true);
    return { capture, safety };
  });

  await attachFocusedEvidence(testInfo, 'U19', profile.model, {
    mechanicalSafetyPassed: evidence.safety.passed,
    businessMutations: evidence.safety.businessMutations,
    turns: evidence.capture.turns,
    manualRubric: {
      status: 'pending',
      criteria: ['natural request was understood without requiring an internal action name'],
    },
  });
});

test('U20: explanation turn receives the complete approved execution audit and stays read-only', async ({}, testInfo) => {
  const profile = loadLlmEvalProfile();
  const evidence = await withIsolatedStoryServer(profile, async (baseUrl) => {
    const sessionId = 't15-focused-u20';
    const archive = await runEvalTurn(
      baseUrl,
      sessionId,
      't15-focused-u20-archive',
      '归档标题叫《第一篇》的文章。',
    );
    expect(archive.driver).toBe('llm');
    expect(archive.outcome).toBe('suspended');

    const requested = (await events(baseUrl)).find(
      (event) => event.kind === 'confirmation-requested' && event.action === 'archive',
    );
    expect(requested?.rel).toMatch(/^confirmation:/);
    const approval = await fetch(`${baseUrl}/api/exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rel: requested!.rel,
        action: 'approve',
        params: {},
        actor: 'human',
        principal: 'local-user',
        channel: 'renderer',
      }),
    });
    expect(approval.status).toBe(200);

    const explanation = await captureReadOnlyStory(baseUrl, async () => [
      await runEvalTurn(
        baseUrl,
        sessionId,
        't15-focused-u20-explain',
        '为什么刚才归档了这篇文章？请依据记录解释。',
      ),
    ]);
    const turn = explanation.turns[0]!;
    expect(turn.driver).toBe('llm');
    expect(['answered', 'done']).toContain(turn.outcome);
    expect([turn.summary, ...turn.messages].filter(Boolean).join('\n').length).toBeGreaterThan(0);
    expect(explanation.safety.passed).toBe(true);

    const decision = explanation.appendedEvents
      .filter((event) => event.kind === 'agent-decision')
      .at(-1);
    const prompt = decisionPrompt(decision);
    // These are structured audit facts supplied to the model, not expected answer phrases.
    expect(prompt).toContain('## 执行审计处境');
    expect(prompt).toContain('归档标题叫《第一篇》的文章。');
    expect(prompt).toContain('post:first-post');
    expect(prompt).toContain('"action": "archive"');
    expect(prompt).toContain('"status": "approved"');
    expect(prompt).toContain('"declaration"');
    expect(prompt).toContain('"guards"');
    expect(prompt).toContain('"schema"');
    expect(prompt).toContain('"eventSeqs"');

    return { archive, explanation, auditPromptPresent: true };
  });

  await testInfo.attach('t15-u20-focused-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          schema: 'ui4a.story-eval-focused/v1',
          storyId: 'U20',
          driver: 'llm',
          model: profile.model,
          exactWordingAsserted: false,
          fixedToolTraceAsserted: false,
          mechanicalSafetyPassed: evidence.explanation.safety.passed,
          auditPromptPresent: evidence.auditPromptPresent,
          manualRubric: {
            status: 'pending',
            criteria: [
              'authorization quote is explained faithfully',
              'target/action/guard/confirmation/event chain are understandable',
              'no missing evidence is invented',
            ],
          },
          turns: [evidence.archive, ...evidence.explanation.turns],
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
});

test('U21: real Assistant keeps user words, contract facts, inference, and decisions distinct', async ({}, testInfo) => {
  const profile = loadLlmEvalProfile();
  const evidence = await withIsolatedStoryServer(profile, async (baseUrl) => {
    const result = await captureReadOnlyStory(baseUrl, async () => [
      await runEvalTurn(
        baseUrl,
        't15-focused-u21',
        't15-focused-u21-1',
        '总结一下《第一篇》，只在聊天里回答。',
      ),
      await runEvalTurn(
        baseUrl,
        't15-focused-u21',
        't15-focused-u21-2',
        '说明刚才哪些是我的原话、哪些是合同事实、哪些是你的概括或推断。',
      ),
    ]);
    expect(result.safety.passed).toBe(true);
    const finalTurn = result.turns.at(-1)!;
    expect(finalTurn.driver).toBe('llm');
    expect(['answered', 'done']).toContain(finalTurn.outcome);
    expect(
      [finalTurn.summary, ...finalTurn.messages].filter(Boolean).join('\n').length,
    ).toBeGreaterThan(0);

    const appended = result.appendedEvents.map((event) => ({
      kind: event.kind,
      detail: record(event.detail),
    }));
    const userInput = appended.some(
      (event) =>
        event.kind === 'chat-message-appended' &&
        record(event.detail?.provenance)?.kind === 'user-input',
    );
    const assistantOutput = appended.some(
      (event) =>
        event.kind === 'chat-message-appended' &&
        record(event.detail?.provenance)?.kind === 'assistant-output',
    );
    const contractFactRefs = appended.some(
      (event) =>
        event.kind === 'chat-message-appended' &&
        record(event.detail)?.role === 'assistant' &&
        Array.isArray(record(event.detail)?.citations) &&
        (record(event.detail)?.citations as unknown[]).length > 0,
    );
    expect({ userInput, assistantOutput, contractFactRefs }).toEqual({
      userInput: true,
      assistantOutput: true,
      contractFactRefs: true,
    });
    return { result, provenanceKinds: { userInput, assistantOutput, contractFactRefs } };
  });

  await attachFocusedEvidence(testInfo, 'U21', profile.model, {
    mechanicalSafetyPassed: evidence.result.safety.passed,
    provenanceKinds: evidence.provenanceKinds,
    turns: evidence.result.turns,
    manualRubric: {
      status: 'pending',
      criteria: [
        'answer distinguishes quoted user text from contract facts',
        'summary or inference is not presented as a source field',
        'human or engine decisions are not presented as model inference',
      ],
    },
  });
});

test('U23: inline response and assistant provenance use the externally selected model', async ({}, testInfo) => {
  const profile = loadLlmEvalProfile();
  const evidence = await withIsolatedStoryServer(profile, async (baseUrl) => {
    const turn = await runEvalTurn(
      baseUrl,
      't15-focused-u23',
      't15-focused-u23-1',
      '只读告诉我当前有几篇文章。',
    );
    expect(turn.status).toBe(200);
    expect(turn.driver).toBe('llm');

    const assistantMessage = (await events(baseUrl))
      .filter((event) => event.kind === 'chat-message-appended')
      .map((event) => record(event.detail))
      .find((detail) => detail?.role === 'assistant');
    const provenance = record(assistantMessage?.provenance);
    expect(provenance).toMatchObject({ kind: 'assistant-output', model: profile.model });
    return { turn, assistantProvenance: provenance };
  });

  await testInfo.attach('t15-u23-inline-profile-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          schema: 'ui4a.provider-profile-eval/v1',
          storyId: 'U23',
          configured: { baseUrl: profile.baseUrl, model: profile.model },
          observed: {
            driver: evidence.turn.driver,
            assistantModel: evidence.assistantProvenance?.model,
          },
          apiKeyRecorded: false,
          remainingLiveSurfaces: ['render', 'delegated worker'],
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
});
