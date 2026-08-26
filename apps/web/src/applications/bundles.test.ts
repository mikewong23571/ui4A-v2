import { describe, expect, it } from 'vitest';

import { walkthroughApplicationBundle } from './bundles';

describe('walkthrough application entries', () => {
  it('parses structured default entries for every installed application scope', () => {
    expect(
      Object.fromEntries(
        walkthroughApplicationBundle.applications.map(({ name, entry }) => [name, entry]),
      ),
    ).toEqual({
      default: 'flow:article-drafting',
      publishing: 'flow:article-drafting',
      community: 'comments',
      development: 'flow:software-change',
      editorial: 'flow:writing-request',
      governance: 'meta/flows',
    });
  });
});
