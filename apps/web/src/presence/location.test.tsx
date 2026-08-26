// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  pathname: '/canvas',
  search: 'scope=publishing&thread=release-1&focus=post%3Aone' as string | null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
  useSearchParams: () =>
    routeState.search === null ? null : new URLSearchParams(routeState.search),
}));

import { useLocationObservation } from './location';

describe('location observation hook', () => {
  beforeEach(() => {
    routeState.pathname = '/canvas';
    routeState.search = 'scope=publishing&thread=release-1&focus=post%3Aone';
  });

  it('returns the same pure URL observation consumed by presence and Chat', () => {
    const { result } = renderHook(() => useLocationObservation());

    expect(result.current).toEqual({
      route: '/canvas?scope=publishing&thread=release-1&focus=post%3Aone',
      observation: {
        site: 'workstation',
        scope: 'publishing',
        thread: 'release-1',
        focus: 'post:one',
      },
    });
  });

  it('treats a migration-compatible null search-param hook as an empty query', () => {
    routeState.pathname = '/';
    routeState.search = null;

    const { result } = renderHook(() => useLocationObservation());

    expect(result.current).toEqual({
      route: '/',
      observation: { site: 'workstation', scope: null, thread: null, focus: null },
    });
  });
});
