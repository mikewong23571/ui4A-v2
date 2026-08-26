import { describe, expect, it } from 'vitest';

import {
  canvasEntityHref,
  entityPageHref,
  locationHrefWithChanges,
  withThreadTarget,
} from './navigation';

describe('explicit URL navigation', () => {
  it('adjusts or clears scope while preserving every other query field', () => {
    const route = '/canvas?mode=raw&scope=publishing&thread=release-1&focus=post%3Aone';

    expect(locationHrefWithChanges(route, { scope: 'development' })).toBe(
      '/canvas?mode=raw&scope=development&thread=release-1&focus=post%3Aone',
    );
    expect(locationHrefWithChanges(route, { scope: null })).toBe(
      '/canvas?mode=raw&thread=release-1&focus=post%3Aone',
    );
    expect(locationHrefWithChanges(route, { thread: null })).toBe(
      '/canvas?mode=raw&scope=publishing&focus=post%3Aone',
    );
  });

  it('attaches the canonical thread id to every thread target and leaves other targets alone', () => {
    expect(
      withThreadTarget('/entity?rel=thread%3Arelease-1&scope=publishing', 'thread:release-1'),
    ).toBe('/entity?rel=thread%3Arelease-1&scope=publishing&thread=release-1');
    expect(withThreadTarget('/canvas?focus=thread%3Arelease-1', 'thread:release-1')).toBe(
      '/canvas?focus=thread%3Arelease-1&thread=release-1',
    );
    expect(withThreadTarget('/entity?rel=post%3Aone&scope=publishing', 'post:one')).toBe(
      '/entity?rel=post%3Aone&scope=publishing',
    );
  });

  it('shares the thread rule across entity-page and Canvas member destinations', () => {
    expect(entityPageHref('thread:release-1', 'publishing')).toBe(
      '/entity?rel=thread%3Arelease-1&scope=publishing&thread=release-1',
    );
    expect(canvasEntityHref('thread:release-1')).toBe(
      '/canvas?focus=thread%3Arelease-1&thread=release-1',
    );
  });
});
