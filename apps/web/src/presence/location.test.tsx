// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  pathname: '/canvas',
  search: 'scope=publishing&thread=release-1&focus=post%3Aone',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
  useSearchParams: () => new URLSearchParams(routeState.search),
}));

import { useLocationObservation } from './location';

describe('location observation hook', () => {
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
});
