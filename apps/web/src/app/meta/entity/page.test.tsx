// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import GenericMetaEntityPage from './page';

const exact: SirenEntity = {
  class: ['meta', 'future-definition'],
  properties: { name: 'future' },
  actions: [],
  links: [],
  'guard-results': [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('canonical Meta entity lens', () => {
  it('keeps an omitted scope unlocated through both sitemap and exact reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            protocolVersion: '1',
            version: 'meta-v1',
            site: 'meta',
            surfaces: [{ rel: 'meta/future', title: 'Future definition' }],
            authorizedScopes: ['publishing', 'governance'],
            authorizationMode: 'self-reported-local-demo',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(exact), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      await GenericMetaEntityPage({
        searchParams: Promise.resolve({ rel: 'meta/future' }),
      }),
    );

    await waitFor(() => expect(screen.getByTestId('meta-content-ready')).toBeTruthy());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/_meta/.well-known/ui4a.json',
      '/_meta/api/entity?rel=meta%2Ffuture',
    ]);
  });

  it('preserves an explicit lens without deriving one from the granted union', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            protocolVersion: '1',
            version: 'meta-v1',
            site: 'meta',
            surfaces: [{ rel: 'meta/future', title: 'Future definition' }],
            effectiveScope: 'governance',
            authorizedScopes: ['publishing', 'governance'],
            authorizationMode: 'self-reported-local-demo',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(exact), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      await GenericMetaEntityPage({
        searchParams: Promise.resolve({ rel: 'meta/future', scope: 'governance' }),
      }),
    );

    await waitFor(() => expect(screen.getByTestId('meta-content-ready')).toBeTruthy());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/_meta/.well-known/ui4a.json?scope=governance',
      '/_meta/api/entity?rel=meta%2Ffuture&scope=governance',
    ]);
  });

  it('describes a missing exact entity as a view-local lookup failure, not a permission change', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              protocolVersion: '1',
              version: 'meta-v1',
              site: 'meta',
              surfaces: [{ rel: 'meta/future', title: 'Future definition' }],
              effectiveScope: 'publishing',
              authorizedScopes: ['publishing', 'governance'],
              authorizationMode: 'self-reported-local-demo',
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status: 404 })),
    );

    render(
      await GenericMetaEntityPage({
        searchParams: Promise.resolve({ rel: 'meta/future', scope: 'publishing' }),
      }),
    );

    expect(
      await screen.findByRole('heading', { name: '合同不存在或当前视角下定位失败' }),
    ).toBeTruthy();
    expect(screen.getByText(/当前视角已保留，但不会改变权限/)).toBeTruthy();
    expect(screen.queryByText(/当前 Scope/)).toBeNull();
  });
});
