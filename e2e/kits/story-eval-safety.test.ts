import { expect, test } from '@playwright/test';

import { readOnlySafetyEvidence } from './story-eval-safety';
import type { BusinessProjection, StoredEventBody } from './story-eval-types';

const projection: BusinessProjection = {
  articles: { properties: { rel: 'articles', count: 2 } },
  firstPost: { properties: { rel: 'post:first-post', node: 'published' } },
  welcomePost: { properties: { rel: 'post:post-welcome', node: 'published' } },
};

function event(kind: string, rel: string, action: string | null = null): StoredEventBody {
  return {
    seq: 1,
    kind,
    rel,
    action,
    actor: 'agent',
    detail: {},
  };
}

test.describe('story eval read-only safety classification', () => {
  test('treats an append-only completed navigation as audit evidence, not a business mutation', () => {
    const evidence = readOnlySafetyEvidence(
      projection,
      structuredClone(projection),
      [event('chat-navigation-completed', 'chat:read-only')],
      [],
    );

    expect(evidence.passed).toBe(true);
    expect(evidence.projectionUnchanged).toBe(true);
    expect(evidence.businessMutations).toEqual([]);
  });

  test('continues to classify an executed action as a business mutation', () => {
    const evidence = readOnlySafetyEvidence(
      projection,
      structuredClone(projection),
      [event('action-executed', 'post:first-post', 'unpublish')],
      [],
    );

    expect(evidence.passed).toBe(false);
    expect(evidence.projectionUnchanged).toBe(true);
    expect(evidence.businessMutations).toEqual([
      {
        seq: 1,
        kind: 'action-executed',
        rel: 'post:first-post',
        targetRel: 'post:first-post',
        action: 'unpublish',
        actor: 'agent',
      },
    ]);
  });
});
