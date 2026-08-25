import type { ApplicationBundle } from '../packages/engine/src/meta-bootstrap';
import type { EventAppend } from '../apps/web/src/db/events';

import { isolatedEvalDatabaseUrl } from './story-eval-env';
import { readOnlySafetyEvidence } from './story-eval-safety';
import { readBusinessProjection, readEvents } from './story-eval-turns';
import type {
  BusinessProjection,
  EvalSafetyEvidence,
  EvalTurn,
  IsolatedStoryFixture,
  LlmEvalProfile,
  StoredEventBody,
} from './story-eval-types';

async function prepareWalkthroughFixture(
  databaseUrl: string,
  customize: (bundle: ApplicationBundle) => void | Promise<void>,
): Promise<void> {
  const [{ planMetaBootstrap }, { walkthroughApplicationBundle }, events, pools] =
    await Promise.all([
      import('../packages/engine/src/index'),
      import('../apps/web/src/applications/bundles'),
      import('../apps/web/src/db/events'),
      import('../apps/web/src/db/pool'),
    ]);
  const bundle = structuredClone(walkthroughApplicationBundle);
  await customize(bundle);
  const pool = pools.getPool(databaseUrl);
  await events.ensureEventsTable(pool);
  for (const event of planMetaBootstrap(bundle, [])) {
    await events.appendEvent(pool, event as EventAppend);
  }
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
      await prepareWalkthroughFixture(databaseUrl, (bundle) => {
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
      });
    },
  };
}

/**
 * Test-only formal summarize capability plus its artifact-backed persistence action. The
 * capability is scoped to publishing/post-status; an unrelated community capability is present
 * so U17 can prove that the Assistant situation does not broadcast cross-scope tools.
 */
export function boundedContextFixture(
  options: {
    seedSessionId?: string;
  } = {},
): IsolatedStoryFixture {
  return {
    prepare: async (databaseUrl) => {
      await prepareWalkthroughFixture(databaseUrl, async (bundle) => {
        bundle.capabilities.push({
          name: 'moderate-comments',
          title: '评论风险识别',
          kind: 'transform',
          intent: '只为社区评论生成审核建议。',
          scope: { applications: ['community'], flows: ['comment-moderation'] },
        });
      });

      if (options.seedSessionId === undefined) return;
      const events = await import('../apps/web/src/db/events');
      const pools = await import('../apps/web/src/db/pool');
      const pool = pools.getPool(databaseUrl);
      let latestSeq = 0;
      for (let index = 1; index <= 14; index += 1) {
        const role = index % 2 === 1 ? ('user' as const) : ('assistant' as const);
        const appended = await events.appendEvent(pool, {
          kind: 'chat-message-appended',
          actor: role === 'user' ? 'human' : 'agent',
          rel: `chat:${options.seedSessionId}`,
          detail: {
            sessionId: options.seedSessionId,
            turnId: `seed-turn-${index}`,
            messageId: `seed-message-${index}`,
            role,
            content: index === 1 ? 'OUT_OF_WINDOW_SENTINEL' : `历史对话 ${index}`,
            provenance: { kind: role === 'user' ? 'user-input' : 'assistant-output' },
          },
        });
        latestSeq = appended.seq;
      }
      await events.appendEvent(pool, {
        kind: 'chat-context-updated',
        actor: 'agent',
        rel: `chat:${options.seedSessionId}`,
        detail: {
          sessionId: options.seedSessionId,
          basedOnSeq: latestSeq,
          provenance: {
            kind: 'mechanical-projection',
            sourceMessageIds: ['seed-message-13'],
          },
          patch: {
            activeGoal: { verb: '了解当前文章处境', targetRel: 'post:first-post' },
            focus: {
              currentRel: 'post:first-post',
              history: [{ rel: 'post:first-post', sourceMessageId: 'seed-message-13' }],
            },
            constraints: [
              {
                text: 'RECENT_CONTEXT_SENTINEL：只读说明，不执行动作',
                sourceMessageId: 'seed-message-13',
              },
            ],
          },
        },
      });
    },
  };
}

/** Remove the optional formal capability while retaining native temporary LLM answers. */
export function withoutFormalSummaryFixture(): IsolatedStoryFixture {
  return {
    prepare: async (databaseUrl) => {
      await prepareWalkthroughFixture(databaseUrl, (bundle) => {
        bundle.capabilities.splice(
          0,
          bundle.capabilities.length,
          ...bundle.capabilities.filter((capability) => capability.name !== 'summarize'),
        );
        const flow = bundle.flows.find((candidate) => candidate.name === 'post-status');
        const published = flow?.nodes.find((candidate) => candidate.name === 'published');
        if (published === undefined)
          throw new Error('walkthrough fixture misses post-status/published');
        published.actions.splice(
          0,
          published.actions.length,
          ...published.actions.filter(
            (action) => action.name !== 'generate-summary' && action.name !== 'save-summary',
          ),
        );
      });
    },
  };
}

/**
 * Capture one read-only conversation across a real web-process restart while retaining the
 * append-only test log. This is deliberately stronger than a browser refresh: the second phase
 * cannot inherit process memory and must recover the session from PostgreSQL.
 */
export async function captureReadOnlyStoryAcrossRestart(
  profile: LlmEvalProfile,
  executeBeforeRestart: (baseUrl: string) => Promise<EvalTurn[]>,
  executeAfterRestart: (baseUrl: string) => Promise<EvalTurn[]>,
): Promise<{ turns: EvalTurn[]; safety: EvalSafetyEvidence }> {
  const databaseUrl = isolatedEvalDatabaseUrl();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    const serverKit = await import('./server-kit');
    if (serverKit.DATABASE_URL !== databaseUrl) {
      throw new Error(
        'server-kit was initialized with a different database; use a dedicated worker',
      );
    }
    const environment = {
      DATABASE_URL: databaseUrl,
      LLM_API_KEY: profile.apiKey,
      LLM_BASE_URL: profile.baseUrl,
      LLM_MODEL: profile.model,
    };
    let beforeProjection: BusinessProjection | undefined;
    let beforeSeq = 0;
    let firstTurns: EvalTurn[] = [];

    await serverKit.waitUntilPortFree(serverKit.SCENARIO_PORT, 15_000);
    await serverKit.withFreshServer(async () => {
      beforeProjection = await readBusinessProjection(serverKit.SCENARIO_BASE);
      const existingEvents = await readEvents(serverKit.SCENARIO_BASE);
      beforeSeq = existingEvents.at(-1)?.seq ?? 0;
      firstTurns = await executeBeforeRestart(serverKit.SCENARIO_BASE);
    }, environment);

    let secondTurns: EvalTurn[] = [];
    let afterProjection: BusinessProjection | undefined;
    let appendedEvents: StoredEventBody[] = [];
    await serverKit.withFreshServer(
      async () => {
        secondTurns = await executeAfterRestart(serverKit.SCENARIO_BASE);
        [afterProjection, appendedEvents] = await Promise.all([
          readBusinessProjection(serverKit.SCENARIO_BASE),
          readEvents(serverKit.SCENARIO_BASE, beforeSeq),
        ]);
      },
      environment,
      { keepLog: true },
    );

    if (beforeProjection === undefined || afterProjection === undefined) {
      throw new Error('story restart capture did not complete both server phases');
    }
    const turns = [...firstTurns, ...secondTurns];
    return {
      turns,
      safety: readOnlySafetyEvidence(beforeProjection, afterProjection, appendedEvents, turns),
    };
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
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
