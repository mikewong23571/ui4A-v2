import type { BusinessProjection, EvalFrame, EvalTurn, StoredEventBody } from './story-eval-types';
import type { ClientViewReport } from '@ui4a/shared';

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
  clientView?: ClientViewReport,
): Promise<EvalTurn> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      turnId,
      driver: 'llm',
      goal: { verb: input },
      ...(clientView === undefined ? {} : { clientView }),
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

export async function readEvalEntity(baseUrl: string, rel: string): Promise<unknown> {
  return getJson(baseUrl, `/api/entity?rel=${encodeURIComponent(rel)}`);
}

export async function readEvalMetaEntity(baseUrl: string, rel: string): Promise<unknown> {
  return getJson(baseUrl, `/_meta/api/entity?rel=${encodeURIComponent(rel)}`);
}

export async function readBusinessProjection(baseUrl: string): Promise<BusinessProjection> {
  const [articles, firstPost, welcomePost] = await Promise.all([
    getJson(baseUrl, '/api/entity?rel=articles'),
    getJson(baseUrl, '/api/entity?rel=post:first-post'),
    getJson(baseUrl, '/api/entity?rel=post:post-welcome'),
  ]);
  return { articles, firstPost, welcomePost };
}

export async function readEvents(baseUrl: string, afterSeq = 0): Promise<StoredEventBody[]> {
  const body = (await getJson(baseUrl, `/api/events?afterSeq=${afterSeq}`)) as {
    events?: StoredEventBody[];
  };
  return body.events ?? [];
}

async function postEvalJson(baseUrl: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok)
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

/**
 * Activate a novel action through the definition plane, then create one normal post born on the
 * activated definition. Existing instances intentionally stay pinned to their birth version.
 */
export async function activateDynamicReviewAction(baseUrl: string): Promise<`post:${string}`> {
  const actor = { actor: 'human' as const, principal: 'user:e2e', channel: 'e2e' };
  await postEvalJson(baseUrl, '/_meta/api/exec', {
    rel: 'meta/flow:post-status',
    action: 'revise',
    ...actor,
  });
  await postEvalJson(baseUrl, '/_meta/api/exec', {
    rel: 'meta/flow:post-status',
    action: 'add-action',
    params: {
      node: 'published',
      action: {
        name: 'mark-reviewed',
        title: '标记为已复核',
        to: 'published',
        guards: [],
        fields: [],
        effect: [
          { type: 'transition', to: 'published' },
          { type: 'set-field', field: 'reviewed', value: true },
        ],
      },
    },
    ...actor,
  });
  await postEvalJson(baseUrl, '/_meta/api/exec', {
    rel: 'meta/flow:post-status',
    action: 'submit',
    ...actor,
  });
  const collection = (await readEvalMetaEntity(baseUrl, 'meta/activations')) as {
    entities?: { properties?: { status?: unknown }; href?: string }[];
  };
  const pending = collection.entities?.find(
    (entity) => entity.properties?.status === 'pending-approval' && typeof entity.href === 'string',
  );
  const activationRel = pending?.href?.match(/[?&]rel=([^&]+)/)?.[1];
  if (activationRel === undefined) throw new Error('dynamic action activation was not projected');
  await postEvalJson(baseUrl, '/_meta/api/exec', {
    rel: decodeURIComponent(activationRel),
    action: 'approve',
    ...actor,
  });

  const title = 'dynamic-review';
  await postEvalJson(baseUrl, '/api/exec', {
    rel: 'article-drafting:main',
    action: 'next',
    params: { title },
    ...actor,
  });
  await postEvalJson(baseUrl, '/api/exec', {
    rel: 'article-drafting:main',
    action: 'next',
    params: { category: 'review' },
    ...actor,
  });
  await postEvalJson(baseUrl, '/api/exec', {
    rel: 'article-drafting:main',
    action: 'next',
    params: { body: '用于验证激活后新实例动态发现 action。' },
    ...actor,
  });
  await postEvalJson(baseUrl, '/api/exec', {
    rel: 'article-drafting:main',
    action: 'publish',
    params: { title },
    ...actor,
  });
  return `post:${title}`;
}
