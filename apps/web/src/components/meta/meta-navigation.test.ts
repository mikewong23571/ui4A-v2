import { describe, expect, it } from 'vitest';

import { metaNavigationContext, withMetaNavigationContext } from './meta-navigation';

describe('Meta navigation context', () => {
  it('accepts only explicit attention fields and a same-origin relative return target', () => {
    expect(
      metaNavigationContext({
        scope: 'governance',
        thread: 'release-1',
        returnTo: '/threads?focus=thread:release-1',
      }),
    ).toEqual({
      scope: 'governance',
      thread: 'release-1',
      returnTo: '/threads?focus=thread:release-1',
    });
    expect(metaNavigationContext({ returnTo: '//evil.example/review' })).toEqual({});
    expect(metaNavigationContext({ returnTo: 'https://evil.example/review' })).toEqual({});
  });

  it('preserves the destination contract query without inventing an omitted scope', () => {
    expect(
      withMetaNavigationContext('/meta/entity?rel=draft%3Ad1&cursor=opaque', {
        thread: 'release-1',
        returnTo: '/meta?query=writer',
      }),
    ).toBe(
      '/meta/entity?rel=draft%3Ad1&cursor=opaque&thread=release-1&returnTo=%2Fmeta%3Fquery%3Dwriter',
    );
  });

  it('fails closed for external destinations and unsafe return targets', () => {
    expect(withMetaNavigationContext('//evil.example/meta', { scope: 'governance' })).toBeNull();
    expect(
      withMetaNavigationContext('/meta', {
        scope: 'governance',
        returnTo: '//evil.example/review',
      }),
    ).toBe('/meta?scope=governance');
  });
});
