import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPresenceReporter,
  presenceObservationForLocation,
} from './client';

describe('client presence change reporter', () => {
  afterEach(() => vi.useRealTimers());

  it('derives only structured site/scope/thread/focus fields from a route', () => {
    expect(presenceObservationForLocation('/meta?scope=governance&thread=t1')).toEqual({
      site: 'meta',
      scope: 'governance',
      thread: 't1',
      focus: null,
    });
    expect(presenceObservationForLocation('/canvas?focus=post%3Aone')).toEqual({
      site: 'business',
      scope: null,
      thread: null,
      focus: 'post:one',
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
      expect.objectContaining({ kind: 'site', value: 'business', clientInstanceId: 'client:one' }),
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
});
