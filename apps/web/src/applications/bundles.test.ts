import { describe, expect, it } from 'vitest';

import { walkthroughApplicationBundle } from './bundles';

describe('walkthrough application entries', () => {
  it('parses structured default entries for every installed application scope', () => {
    expect(
      Object.fromEntries(
        walkthroughApplicationBundle.applications.map(({ name, entry }) => [name, entry]),
      ),
    ).toEqual({
      default: undefined,
      publishing: { target: 'flow:article-drafting', role: 'primary-create' },
      community: { target: 'comments', role: 'primary-collection' },
      development: { target: 'flow:software-change', role: 'primary-task' },
      editorial: { target: 'flow:writing-request', role: 'primary-task' },
      governance: { target: 'flow:agent-definition-authoring', role: 'primary-task' },
    });
  });
});
