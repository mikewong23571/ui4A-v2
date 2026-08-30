import { describe, expect, it } from 'vitest';

import {
  canvasEntityHref,
  citationCanvasHref,
  crossSiteFlowBridge,
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

  it('builds citation focus URLs from only scope/thread declarations', () => {
    expect(
      citationCanvasHref(
        '/meta/entity?rel=meta%2Fflow%3Aone&scope=governance&thread=release-1&mode=raw',
        'post:first-post',
      ),
    ).toBe('/canvas?focus=post%3Afirst-post&scope=governance&thread=release-1');
    expect(
      citationCanvasHref(
        '/canvas?focus=post%3Aold&scope=publishing&thread=release-1&refresh=9&roots=a,b',
        'thread:release-2',
      ),
    ).toBe('/canvas?focus=thread%3Arelease-2&scope=publishing&thread=release-2');
  });

  it('derives the workstation-to-meta bridge only from a canonical flow focus', () => {
    expect(
      crossSiteFlowBridge(
        '/canvas?focus=flow%3Arelease%20flow&scope=publishing&thread=release-1',
        'flow:release flow',
      ),
    ).toEqual({
      label: '在 meta 中编辑此定义',
      href: '/meta/entity?rel=meta%2Fflow%3Arelease+flow&scope=publishing&thread=release-1',
    });
    expect(
      crossSiteFlowBridge('/canvas?focus=flow%3Aarticle-drafting', 'flow:article-drafting'),
    ).toEqual({
      label: '在 meta 中编辑此定义',
      href: '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting',
    });
    expect(
      crossSiteFlowBridge(
        '/canvas?focus=flow%3Aarticle-drafting&scope=&thread=',
        'flow:article-drafting',
      ),
    ).toEqual({
      label: '在 meta 中编辑此定义',
      href: '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting',
    });
  });

  it('derives the meta-to-workstation bridge from an exact route or canonical meta focus', () => {
    expect(
      crossSiteFlowBridge(
        '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting&scope=publishing&thread=release-1',
        'meta/flow:article-drafting',
      ),
    ).toEqual({
      label: '查看活实例',
      href: '/canvas?focus=flow%3Aarticle-drafting&scope=publishing&thread=release-1',
    });
    expect(
      crossSiteFlowBridge(
        '/meta/entity?rel=meta%2Fflow%3Arelease%20flow',
        'meta/flow:release flow',
      ),
    ).toEqual({
      label: '查看活实例',
      href: '/canvas?focus=flow%3Arelease+flow',
    });
  });

  it('does not bridge selections, other entities, empty names, or non-canonical meta paths', () => {
    expect(crossSiteFlowBridge('/canvas?focus=post%3Aone', 'post:one')).toBeNull();
    expect(crossSiteFlowBridge('/canvas?roots=flow%3Aone', { selection: ['flow:one'] })).toBeNull();
    expect(crossSiteFlowBridge('/canvas?focus=flow%3A', 'flow:')).toBeNull();
    expect(crossSiteFlowBridge('/meta/flow/', null)).toBeNull();
    expect(crossSiteFlowBridge('/meta/flow/one/more', null)).toBeNull();
  });
});
