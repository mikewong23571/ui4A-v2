import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPresenceReporter, presenceObservationForLocation } from './client';

describe('client presence change reporter', () => {
  afterEach(() => vi.useRealTimers());

  it('derives only structured site/scope/thread/focus fields from a route', () => {
    expect(presenceObservationForLocation('/meta?scope=governance&thread=t1')).toEqual({
      site: 'meta',
      scope: 'governance',
      thread: 't1',
      focus: null,
    });
    expect(
      presenceObservationForLocation(
        '/meta/entity?rel=meta%2Fflow%3Aarticle-drafting&scope=governance',
      ),
    ).toMatchObject({
      site: 'meta',
      scope: 'governance',
      focus: 'meta/flow:article-drafting',
    });
    expect(
      presenceObservationForLocation('/meta/entity?rel=meta%2Fflow%3Arelease+flow'),
    ).toMatchObject({
      site: 'meta',
      focus: 'meta/flow:release flow',
    });
    expect(presenceObservationForLocation('/entity?rel=post%3Afirst-post')).toMatchObject({
      site: 'workstation',
      focus: 'post:first-post',
    });
    expect(presenceObservationForLocation('/meta/flow/article-drafting')).toMatchObject({
      site: 'meta',
      focus: null,
    });
    expect(presenceObservationForLocation('/canvas?focus=post%3Aone')).toEqual({
      site: 'workstation',
      scope: null,
      thread: null,
      focus: 'post:one',
    });
    expect(presenceObservationForLocation('/canvas?mode=raw')).toMatchObject({
      site: 'workstation',
    });
  });

  it('debounces changes and suppresses repeated values', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async () => undefined);
    const reporter = createPresenceReporter({ transport, debounceMs: 20 });
    const first = presenceObservationForLocation('/canvas');
    reporter.observe(first, 'client:one');
    reporter.observe(first, 'client:one');
    expect(transport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'site',
        value: 'workstation',
        clientInstanceId: 'client:one',
      }),
    );
  });

  it('coalesces a rapid route/focus transition into the latest change and fails silently', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async (change) => {
      if (change.kind === 'focus') throw new Error('offline');
    });
    const reporter = createPresenceReporter({ transport, debounceMs: 20 });
    reporter.observe(presenceObservationForLocation('/canvas'), 'client:one');
    reporter.observe(
      presenceObservationForLocation('/canvas?focus=post%3Aone&scope=publishing'),
      'client:one',
    );
    await vi.advanceTimersByTimeAsync(20);
    await reporter.flush();
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scope' }));
    await expect(reporter.flush()).resolves.toBeUndefined();
  });

  it('delivers one observation change point at a time so sibling writes cannot race', async () => {
    vi.useFakeTimers();
    let active = 0;
    const delivered: string[] = [];
    const transport = vi.fn(async (change) => {
      if (active !== 0) throw new Error('concurrent presence write');
      active += 1;
      await Promise.resolve();
      delivered.push(change.kind);
      active -= 1;
    });
    const reporter = createPresenceReporter({ transport, debounceMs: 20 });
    reporter.observe(
      presenceObservationForLocation('/canvas?scope=publishing&thread=release-1&focus=post%3Aone'),
      'client:one',
    );

    await vi.advanceTimersByTimeAsync(20);
    expect(delivered).toEqual(['site', 'scope', 'thread', 'focus']);
  });
});
