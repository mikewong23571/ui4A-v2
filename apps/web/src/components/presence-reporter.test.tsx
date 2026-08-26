// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  dispose: vi.fn(),
  observation: {
    site: 'meta',
    scope: 'governance',
    thread: 'release-1',
    focus: 'meta/flow:article-drafting' as const,
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/presence/location', () => ({
  useLocationObservation: () => ({ route: '/meta', observation: mocks.observation }),
}));

vi.mock('@/presence/client', () => ({
  createPresenceReporter: () => ({
    observe: mocks.observe,
    dispose: mocks.dispose,
  }),
  postPresence: vi.fn(),
  presenceObservationForLocation: () => ({
    site: 'workstation',
    scope: null,
    thread: null,
    focus: null,
  }),
}));

import { PresenceReporter } from './presence-reporter';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.observe.mockClear();
  mocks.dispose.mockClear();
});

describe('PresenceReporter location source', () => {
  it('reports the exact observation returned by the shared location hook', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'client:test' });
    render(<PresenceReporter />);

    expect(mocks.observe).toHaveBeenCalledWith(mocks.observation, 'client:test');
  });
});
