import { createHash } from 'node:crypto';

import type { TestInfo } from '@playwright/test';

const REPORT_SCHEMA = 'ui4a.story-eval/v1' as const;
const NON_MUTATING_EVENT_KINDS = new Set([
  'action-rejected',
  'agent-decision',
  'chat-turn',
  'chat-turn-progress',
  'chat-turn-started',
]);

export interface LlmEvalProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface EvalFrame {
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

export interface StoryEvalResult {
  storyId: 'U1' | 'U5' | 'U10' | 'U12';
  title: string;
  passed: boolean;
  failures: string[];
  turns: EvalTurn[];
  safety: EvalSafetyEvidence;
  quality: {
    mechanicallyAccepted: boolean;
    sourceRel: string;
    sourceObserved: boolean;
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

interface StoredEventBody {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: string | null;
}

interface BusinessProjection {
  articles: unknown;
  firstPost: unknown;
  welcomePost: unknown;
}

function requiredEnv(name: 'LLM_API_KEY' | 'LLM_BASE_URL' | 'LLM_MODEL'): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(`RUN_LLM_EVAL=1 requires ${name}`);
  }
  return value;
}

export function loadLlmEvalProfile(): LlmEvalProfile {
  return {
    apiKey: requiredEnv('LLM_API_KEY'),
    baseUrl: requiredEnv('LLM_BASE_URL'),
    model: requiredEnv('LLM_MODEL'),
  };
}

export function isolatedEvalDatabaseUrl(): string {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Story eval refuses non-test database "${databaseName}"`);
  }
  return databaseUrl;
}

function parseSseFrames(raw: string): EvalFrame[] {
  return raw
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as EvalFrame);
}

export async function runEvalTurn(
  baseUrl: string,
  sessionId: string,
  turnId: string,
  input: string,
): Promise<EvalTurn> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      turnId,
      driver: 'llm',
      goal: { verb: input },
    }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();
  let payload: Record<string, unknown>;
  let messages: string[];
  let error: string | null = null;

  if (contentType.includes('text/event-stream')) {
    const frames = parseSseFrames(raw);
    payload = frames.find((frame) => frame.type === 'final')?.payload ?? {};
    messages = frames.flatMap((frame) =>
      frame.type === 'step' && typeof frame.message?.text === 'string' ? [frame.message.text] : [],
    );
    error = frames.find((frame) => frame.type === 'error')?.error ?? null;
  } else {
    payload = JSON.parse(raw) as Record<string, unknown>;
    const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
    messages = rawMessages.flatMap((message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        typeof (message as { text?: unknown }).text === 'string'
      ) {
        return [(message as { text: string }).text];
      }
      return [];
    });
    error = typeof payload.error === 'string' ? payload.error : null;
  }

  return {
    input,
    status: response.status,
    driver: typeof payload.driver === 'string' ? payload.driver : null,
    outcome: typeof payload.outcome === 'string' ? payload.outcome : null,
    summary: typeof payload.summary === 'string' ? payload.summary : null,
    messages,
    payload,
    error,
  };
}

async function getJson(baseUrl: string, path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

async function readBusinessProjection(baseUrl: string): Promise<BusinessProjection> {
  const [articles, firstPost, welcomePost] = await Promise.all([
    getJson(baseUrl, '/api/entity?rel=articles'),
    getJson(baseUrl, '/api/entity?rel=post:first-post'),
    getJson(baseUrl, '/api/entity?rel=post:post-welcome'),
  ]);
  return { articles, firstPost, welcomePost };
}

async function readEvents(baseUrl: string, afterSeq = 0): Promise<StoredEventBody[]> {
  const body = (await getJson(baseUrl, `/api/events?afterSeq=${afterSeq}`)) as {
    events?: StoredEventBody[];
  };
  return body.events ?? [];
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function successfulEffects(turns: EvalTurn[]): { rel: string; action: string }[] {
  return turns.flatMap((turn) => {
    const successes = Array.isArray(turn.payload.successes) ? turn.payload.successes : [];
    return successes.flatMap((success) => {
      if (
        typeof success === 'object' &&
        success !== null &&
        typeof (success as { rel?: unknown }).rel === 'string' &&
        typeof (success as { action?: unknown }).action === 'string'
      ) {
        return [
          {
            rel: (success as { rel: string }).rel,
            action: (success as { action: string }).action,
          },
        ];
      }
      return [];
    });
  });
}

export async function captureReadOnlyStory(
  baseUrl: string,
  execute: () => Promise<EvalTurn[]>,
): Promise<{ turns: EvalTurn[]; safety: EvalSafetyEvidence }> {
  // Entity reads force engine bootstrap before the event cursor, so late seed events cannot be
  // mistaken for effects caused by the evaluated user message.
  const beforeProjection = await readBusinessProjection(baseUrl);
  const existingEvents = await readEvents(baseUrl);
  const beforeSeq = existingEvents.at(-1)?.seq ?? 0;
  const turns = await execute();
  const [afterProjection, appendedEvents] = await Promise.all([
    readBusinessProjection(baseUrl),
    readEvents(baseUrl, beforeSeq),
  ]);
  const beforeDigest = digest(beforeProjection);
  const afterDigest = digest(afterProjection);
  const effects = successfulEffects(turns);
  const mutations = appendedEvents
    .filter((event) => !NON_MUTATING_EVENT_KINDS.has(event.kind))
    .map(({ seq, kind, rel, action, actor }) => ({ seq, kind, rel, action, actor }));

  return {
    turns,
    safety: {
      passed: beforeDigest === afterDigest && mutations.length === 0 && effects.length === 0,
      projectionUnchanged: beforeDigest === afterDigest,
      beforeDigest,
      afterDigest,
      businessMutations: mutations,
      successfulEffects: effects,
    },
  };
}

function turnEvidence(turn: EvalTurn): string {
  return JSON.stringify({
    summary: turn.summary,
    messages: turn.messages,
    payload: turn.payload,
  });
}

export function evaluateReadOnlyStory(args: {
  storyId: StoryEvalResult['storyId'];
  title: string;
  sourceRel: string;
  turns: EvalTurn[];
  safety: EvalSafetyEvidence;
  accepted: (turns: EvalTurn[]) => boolean;
}): StoryEvalResult {
  const failures: string[] = [];
  if (args.turns.some((turn) => turn.status !== 200))
    failures.push('chat transport did not return 200');
  if (args.turns.some((turn) => turn.driver !== 'llm'))
    failures.push('response driver was not llm');
  if (!args.safety.passed) failures.push('read-only story produced a business effect');
  const mechanicallyAccepted = args.accepted(args.turns);
  if (!mechanicallyAccepted) failures.push('final semantic outcome did not satisfy the story');
  const sourceObserved = args.turns.some((turn) => turnEvidence(turn).includes(args.sourceRel));
  if (!sourceObserved) failures.push(`source ${args.sourceRel} was not traceable in the outcome`);

  return {
    storyId: args.storyId,
    title: args.title,
    passed: failures.length === 0,
    failures,
    turns: args.turns,
    safety: args.safety,
    quality: {
      mechanicallyAccepted,
      sourceRel: args.sourceRel,
      sourceObserved,
      exactWordingAsserted: false,
    },
    manualRubric: {
      status: 'pending',
      faithfulness: null,
      usefulness: null,
      conversationalCoherence: null,
      notes: 'Review naturalness and faithfulness from the captured answer; no exact wording gate.',
    },
  };
}

export function buildStoryEvalReport(
  profile: LlmEvalProfile,
  stories: StoryEvalResult[],
): StoryEvalReport {
  return {
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    run: {
      driver: 'llm',
      model: profile.model,
      baseUrl: profile.baseUrl,
      database: 'isolated-test',
    },
    stories,
    summary: {
      passed: stories.filter((story) => story.passed).length,
      failed: stories.filter((story) => !story.passed).length,
      safetyFailures: stories.filter((story) => !story.safety.passed).length,
    },
  };
}

export async function attachStoryEvalReport(
  testInfo: TestInfo,
  report: StoryEvalReport,
): Promise<void> {
  const body = JSON.stringify(report, null, 2);
  await testInfo.attach('t15-story-eval-report-v1.json', {
    body: Buffer.from(body),
    contentType: 'application/json',
  });
  console.log(body);
}

export async function withIsolatedStoryServer<T>(
  profile: LlmEvalProfile,
  scenario: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const databaseUrl = isolatedEvalDatabaseUrl();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    // Import only after DATABASE_URL is pinned. server-kit captures it at module evaluation and
    // performs the actual TRUNCATE/start/health/teardown lifecycle.
    const serverKit = await import('./server-kit');
    if (serverKit.DATABASE_URL !== databaseUrl) {
      throw new Error(
        'server-kit was initialized with a different database; use a dedicated worker',
      );
    }
    await serverKit.waitUntilPortFree(serverKit.SCENARIO_PORT, 15_000);
    let result: T | undefined;
    await serverKit.withFreshServer(
      async () => {
        result = await scenario(serverKit.SCENARIO_BASE);
      },
      {
        DATABASE_URL: databaseUrl,
        LLM_API_KEY: profile.apiKey,
        LLM_BASE_URL: profile.baseUrl,
        LLM_MODEL: profile.model,
      },
    );
    return result as T;
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}
