import { createHash } from 'node:crypto';

import type { TestInfo } from '@playwright/test';

import type { EventAppend } from '../apps/web/src/db/events';

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

export interface EvalFactRef {
  rel: string;
  pointer: string;
}

export interface StoryEvalResult {
  storyId: 'U1' | 'U2' | 'U3' | 'U4' | 'U5' | 'U10' | 'U12';
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

function factRefsFrom(value: unknown): EvalFactRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as { rel?: unknown }).rel !== 'string' ||
      typeof (entry as { pointer?: unknown }).pointer !== 'string'
    ) {
      return [];
    }
    return [
      {
        rel: (entry as { rel: string }).rel,
        pointer: (entry as { pointer: string }).pointer,
      },
    ];
  });
}

function observedFactRefs(turns: readonly EvalTurn[]): EvalFactRef[] {
  const refs = turns.flatMap((turn) => {
    const direct = factRefsFrom(turn.payload.sources);
    const steps = Array.isArray(turn.payload.steps) ? turn.payload.steps : [];
    const stepRefs = steps.flatMap((step) => {
      if (typeof step !== 'object' || step === null) return [];
      const op = (step as { op?: unknown }).op;
      if (typeof op !== 'object' || op === null) return [];
      return factRefsFrom((op as { sources?: unknown }).sources);
    });
    return [...direct, ...stepRefs];
  });
  return [...new Map(refs.map((ref) => [`${ref.rel}\u0000${ref.pointer}`, ref])).values()];
}

export function evaluateReadOnlyStory(args: {
  storyId: StoryEvalResult['storyId'];
  title: string;
  sourceRel: string;
  additionalSourceRels?: readonly string[];
  requiredFactRefs?: readonly EvalFactRef[];
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
  const sourceRels = [args.sourceRel, ...(args.additionalSourceRels ?? [])];
  const sourceObservations = Object.fromEntries(
    sourceRels.map((sourceRel) => [
      sourceRel,
      args.turns.some((turn) => turnEvidence(turn).includes(sourceRel)),
    ]),
  );
  const sourceObserved = sourceObservations[args.sourceRel] === true;
  for (const sourceRel of sourceRels) {
    if (sourceObservations[sourceRel] !== true) {
      failures.push(`source ${sourceRel} was not traceable in the outcome`);
    }
  }
  const factRefs = observedFactRefs(args.turns);
  const requiredFactRefs = [...(args.requiredFactRefs ?? [])];
  const factRefsSatisfied = requiredFactRefs.every((required) =>
    factRefs.some(
      (observed) =>
        observed.rel === required.rel &&
        (observed.pointer === required.pointer ||
          required.pointer.startsWith(`${observed.pointer}/`)),
    ),
  );
  if (!factRefsSatisfied) {
    failures.push('required contract fact references were not traceable in the answer');
  }

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
      sourceRels,
      sourceObservations,
      factRefs,
      requiredFactRefs,
      factRefsSatisfied,
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

export interface IsolatedStoryFixture {
  prepare(databaseUrl: string): Promise<void>;
}

/**
 * Build a test-only application seed containing one published post with a title but no body.
 * The fixture is appended before the scenario server boots, so the server folds it through the
 * same production bootstrap path without changing the built-in application artifact.
 */
export function postWithoutBodyFixture(args: {
  rel: `post:${string}`;
  title: string;
}): IsolatedStoryFixture {
  return {
    prepare: async (databaseUrl) => {
      const [{ planMetaBootstrap }, { walkthroughApplicationBundle }, events, pools] =
        await Promise.all([
          import('../packages/engine/src/index'),
          import('../apps/web/src/applications/bundles'),
          import('../apps/web/src/db/events'),
          import('../apps/web/src/db/pool'),
        ]);
      const bundle = structuredClone(walkthroughApplicationBundle);
      bundle.seed.detail.instances[args.rel] = {
        rel: args.rel,
        flow: 'post-status',
        node: 'published',
        fields: {
          title: { value: args.title, origin: 'default' },
        },
      };
      const articles = bundle.seed.detail.collections?.articles;
      if (articles === undefined) {
        throw new Error('walkthrough fixture is missing the articles collection');
      }
      articles.push(args.rel);

      const pool = pools.getPool(databaseUrl);
      await events.ensureEventsTable(pool);
      for (const event of planMetaBootstrap(bundle, [])) {
        await events.appendEvent(pool, event as EventAppend);
      }
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
  fixture?: IsolatedStoryFixture,
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
    if (fixture !== undefined) {
      await serverKit.truncateEvents();
      await fixture.prepare(databaseUrl);
    }
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
      fixture === undefined ? {} : { keepLog: true },
    );
    return result as T;
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}
