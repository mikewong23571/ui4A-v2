/**
 * Opt-in real-LLM regression for the Assistant's scoped business context.
 *
 * The assertion follows durable business state and append-only audit evidence. It deliberately
 * avoids fixed tool traces and exact Assistant wording.
 */
import { expect, test, type TestInfo } from '@playwright/test';

import {
  captureStory,
  isolatedEvalDatabaseUrl,
  loadLlmEvalProfile,
  readEvalEntity,
  runEvalTurn,
  withIsolatedStoryServer,
  type StoredEventBody,
} from '../kits/story-eval-kit';

const RUN_LLM_EVAL = process.env.RUN_LLM_EVAL === '1';
const SESSION_ID = 'scoped-context-publish';
const REQUEST =
  '新增一篇文章，标题为《操作流程》，分类为 tech，正文介绍操作流程，内容是“操作流程包括准备、执行和复核。”';

test.skip(!RUN_LLM_EVAL, 'RUN_LLM_EVAL=1 is required for the real-LLM scoped-context eval');
test.beforeEach(() => {
  test.setTimeout(420_000);
  expect(process.env.DATABASE_URL).toBe(isolatedEvalDatabaseUrl());
});

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function entities(value: unknown): Array<Record<string, unknown>> {
  const members = record(value)?.entities;
  return Array.isArray(members) ? members.flatMap((member) => record(member) ?? []) : [];
}

function entityRels(value: unknown): string[] {
  return entities(value).flatMap((member) => {
    const rel = record(member.properties)?.rel;
    return typeof rel === 'string' ? [rel] : [];
  });
}

function entityFields(value: unknown): Record<string, unknown> {
  return record(record(record(value)?.properties)?.fields) ?? {};
}

function decisionDetails(events: StoredEventBody[]): Array<Record<string, unknown>> {
  return events
    .filter((event) => event.kind === 'agent-decision' && event.rel === `chat:${SESSION_ID}`)
    .flatMap((event) => record(event.detail) ?? []);
}

function promptUser(detail: Record<string, unknown>): string {
  const user = record(detail.prompt)?.user;
  return typeof user === 'string' ? user : '';
}

function promptCurrentRel(prompt: string): string {
  const match = prompt.match(/## 本轮合同读取位置 rel\(不是客户端当前页面\)\n([^\n]+)/);
  if (match?.[1] === undefined)
    throw new Error('decision prompt omitted the structured current rel');
  return match[1];
}

function promptSitemap(prompt: string): Record<string, unknown> {
  const heading = '## 当前 app/scope 的动态 sitemap 分层披露';
  const start = prompt.indexOf('{', prompt.indexOf(heading));
  const end = prompt.indexOf('\n\n## 授权合同观察账本', start);
  if (start < 0 || end < 0) throw new Error('decision prompt omitted the scoped sitemap block');
  return JSON.parse(prompt.slice(start, end)) as Record<string, unknown>;
}

function turnSteps(events: StoredEventBody[]): Array<Record<string, unknown>> {
  return events
    .filter((event) => event.kind === 'chat-turn' && event.rel === `chat:${SESSION_ID}`)
    .flatMap((event) => {
      const steps = record(event.detail)?.steps;
      return Array.isArray(steps) ? steps.flatMap((step) => record(step) ?? []) : [];
    });
}

function assertedBusinessRel(rel: string): void {
  expect(rel).not.toMatch(/^(?:meta\/|draft:)/);
}

async function attachEvidence(
  testInfo: TestInfo,
  model: string,
  body: Record<string, unknown>,
): Promise<void> {
  await testInfo.attach('scoped-context-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          schema: 'ui4a.scoped-context-eval/v1',
          driver: 'llm',
          model,
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

test('natural write stays in scoped business contracts and creates the authorized article', async ({}, testInfo) => {
  const profile = loadLlmEvalProfile();
  const evidence = await withIsolatedStoryServer(profile, async (baseUrl) => {
    const capture = await captureStory(baseUrl, async () => [
      await runEvalTurn(baseUrl, SESSION_ID, `${SESSION_ID}-turn-1`, REQUEST),
    ]);
    const turn = capture.turns[0]!;
    expect(turn.status).toBe(200);
    expect(turn.driver).toBe('llm');
    expect(turn.outcome).toBe('done');

    const beforeRels = entityRels(capture.beforeProjection.articles);
    const afterRels = entityRels(capture.afterProjection.articles);
    expect(beforeRels).toHaveLength(2);
    expect(afterRels).toHaveLength(3);
    const createdRels = afterRels.filter((rel) => !beforeRels.includes(rel));
    expect(createdRels).toHaveLength(1);

    const createdRel = createdRels[0]!;
    assertedBusinessRel(createdRel);
    const created = await readEvalEntity(baseUrl, createdRel);
    const fields = entityFields(created);
    expect(fields.title).toBe('操作流程');
    expect(fields.category).toBe('tech');
    expect(fields.body).toBe('操作流程包括准备、执行和复核。');

    const decisions = decisionDetails(capture.appendedEvents);
    const steps = turnSteps(capture.appendedEvents);
    expect(decisions.length).toBeGreaterThan(0);
    expect(steps.length).toBeGreaterThan(0);
    expect(decisions.every((detail) => detail.driver === 'llm')).toBe(true);

    const prompts = decisions.map(promptUser);
    const currentRels = prompts.map(promptCurrentRel);
    expect(currentRels[0]).toBe('flow:article-drafting');
    const currentRelHeading = prompts[0]!.indexOf('## 本轮合同读取位置 rel');
    expect(prompts[0]!.indexOf(currentRels[0]!)).toBe(
      prompts[0]!.indexOf(currentRels[0]!, currentRelHeading),
    );

    const firstSitemap = promptSitemap(prompts[0]!);
    expect(
      (firstSitemap.applications as Array<{ name?: unknown }>).map(({ name }) => name),
    ).toEqual(['default']);
    for (const prompt of prompts) {
      expect(JSON.stringify(promptSitemap(prompt))).not.toMatch(/"(?:inputSchema|outputSchema)"/);
      expect(prompt).not.toContain('/_meta/.well-known/ui4a.json');
      expect(prompt).not.toContain('"class": [\n      "meta"');
    }

    const stepCurrentRels = steps.flatMap((step) =>
      typeof step.rel === 'string' ? [step.rel] : [],
    );
    const navigateTargets = [
      ...decisions.flatMap((detail) => {
        const op = record(detail.op);
        return op?.kind === 'navigate' && typeof op.rel === 'string' ? [op.rel] : [];
      }),
      ...steps.flatMap((step) => {
        const op = record(step.op);
        return op?.kind === 'navigate' && typeof op.rel === 'string' ? [op.rel] : [];
      }),
      ...capture.appendedEvents.flatMap((event) => {
        if (event.kind !== 'chat-navigation-completed') return [];
        const subject = record(event.detail)?.subject;
        return typeof subject === 'string' ? [subject] : [];
      }),
    ];
    for (const rel of [...currentRels, ...stepCurrentRels, ...navigateTargets]) {
      assertedBusinessRel(rel);
    }

    return {
      createdRel,
      fields,
      currentRels,
      navigateTargets,
      eventSeqs: capture.appendedEvents.map(({ seq }) => seq),
    };
  });

  await attachEvidence(testInfo, profile.model, evidence);
});
