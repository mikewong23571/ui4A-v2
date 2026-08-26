import { describe, expect, it } from 'vitest';

import { singleSubjectRecipeContext } from './recipe-context';

function root(rel: string, classes: string[], extra: Record<string, unknown> = {}) {
  return {
    rels: [rel],
    entities: [{ class: classes, properties: { rel }, actions: [], links: [], ...extra }],
    policyScope: 'contract',
  };
}

describe('single-subject Recipe context', () => {
  it.each([
    [
      'flow instance',
      root('article-drafting:main', ['flow-instance', 'article-drafting']),
      {
        subjectShape: 'flow-instance:article-drafting',
        slots: [{ name: 'subject', kind: 'flow', subject: 'article-drafting:main' }],
      },
    ],
    [
      'collection',
      root('articles', ['collection', 'articles'], { entities: [] }),
      {
        subjectShape: 'collection:articles',
        slots: [{ name: 'subject', kind: 'collection', subject: 'articles' }],
      },
    ],
    [
      'pending confirmation',
      root('confirmation:c1', ['confirmation', 'pending']),
      {
        subjectShape: 'confirmation:pending',
        slots: [{ name: 'subject', kind: 'entity', subject: 'confirmation:c1' }],
      },
    ],
    [
      'capability artifact',
      root('artifact:a1', ['capability-artifact', 'writing.execute']),
      {
        subjectShape: 'capability-artifact:writing.execute',
        slots: [{ name: 'subject', kind: 'entity', subject: 'artifact:a1' }],
      },
    ],
    [
      'ordinary entity',
      root('post:first', ['post']),
      {
        subjectShape: 'entity',
        slots: [{ name: 'subject', kind: 'entity', subject: 'post:first' }],
      },
    ],
  ])(
    'derives the exact %s selector from structural Siren classes',
    (_label, situation, expected) => {
      expect(singleSubjectRecipeContext(situation)).toEqual(expected);
    },
  );

  it('fails closed for a selection or malformed authorized shape', () => {
    expect(
      singleSubjectRecipeContext({
        rels: ['articles', 'comments'],
        entities: [
          root('articles', ['collection']).entities[0],
          root('comments', ['collection']).entities[0],
        ],
        policyScope: 'contract',
      }),
    ).toBeUndefined();
    expect(
      singleSubjectRecipeContext({ rels: ['articles'], entities: [{}], policyScope: 'contract' }),
    ).toBeUndefined();
  });
});
