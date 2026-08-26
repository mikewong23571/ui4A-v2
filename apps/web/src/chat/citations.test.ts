import { describe, expect, it } from 'vitest';

import { parseCitations } from './citations';

describe('canonical chat citations', () => {
  it('strictly accepts FactRef values and deduplicates exact pairs in first-seen order', () => {
    expect(
      parseCitations([
        { rel: 'post:first-post', pointer: '/properties/fields/body' },
        { rel: 'post:first-post', pointer: '/properties/fields/title' },
        { rel: 'post:first-post', pointer: '/properties/fields/body' },
        { rel: 'articles', pointer: '/properties/count' },
      ]),
    ).toEqual([
      { rel: 'post:first-post', pointer: '/properties/fields/body' },
      { rel: 'post:first-post', pointer: '/properties/fields/title' },
      { rel: 'articles', pointer: '/properties/count' },
    ]);
  });

  it.each([
    null,
    {},
    [{ rel: '', pointer: '/properties/count' }],
    [{ rel: 'articles', pointer: 'properties/count' }],
    [{ rel: 'articles', pointer: '/properties/count', invented: true }],
  ])('rejects malformed or non-canonical citation metadata: %j', (value) => {
    expect(() => parseCitations(value)).toThrow(/citation/i);
  });
});
