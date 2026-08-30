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

function destinationOf(link: HTMLElement): URL {
  return new URL(link.getAttribute('href') ?? '', 'http://ui4a.local');
}

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

  it('collection 进入 Draft exact 时保留显式视角、工作线和返回目标', async () => {
    const collection: SirenEntity = {
      class: ['collection', 'meta/drafts'],
      properties: { rel: 'meta/drafts', count: 1 },
      actions: [],
      links: [],
      entities: [
        {
          class: ['meta', 'draft', 'agent-definition', 'invalid'],
          rel: ['item'],
          href: '/_meta/api/entity?rel=draft%3Acontinuity-d1',
          properties: {
            rel: 'draft:continuity-d1',
            target: 'writer-continuity',
            status: 'invalid',
          },
          actions: [],
          links: [],
        },
      ],
      'guard-results': [],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              protocolVersion: '1',
              version: 'collection-continuity-v1',
              site: 'meta',
              effectiveScope: 'governance',
              surfaces: [{ rel: 'meta/drafts', title: 'Drafts', collection: true }],
              authorizedScopes: ['publishing', 'governance'],
              authorizationMode: 'credential',
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(collection))),
    );

    render(
      await GenericMetaEntityPage({
        searchParams: Promise.resolve({
          rel: 'meta/drafts',
          scope: 'governance',
          thread: 'release-1',
          returnTo: '/meta?query=writer',
        }),
      }),
    );

    const target = destinationOf(await screen.findByRole('link', { name: /draft:continuity-d1/ }));
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      rel: 'draft:continuity-d1',
      scope: 'governance',
      thread: 'release-1',
      returnTo: '/meta?query=writer',
    });
  });

  it('Draft exact 返回 author/source 保留审查现场；无视角时继续不生成 scope', async () => {
    const draft: SirenEntity = {
      class: ['meta', 'draft', 'agent-definition', 'invalid'],
      properties: {
        rel: 'draft:continuity-unlocated',
        id: 'continuity-unlocated',
        kind: 'agent-definition',
        target: 'writer-unlocated',
        status: 'invalid',
        version: 1,
        maxVersion: 1,
        validation: { valid: false, issues: [] },
        provenance: { sources: ['agent-run:author-1'] },
      },
      actions: [],
      links: [
        {
          rel: ['source', 'author'],
          title: '返回候选作者修复',
          href: '/api/entity?rel=agent-run%3Aauthor-1',
        },
      ],
      'guard-results': [],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              protocolVersion: '1',
              version: 'draft-continuity-v1',
              site: 'meta',
              surfaces: [{ rel: 'draft:continuity-unlocated', title: 'Writer candidate' }],
              authorizedScopes: ['publishing', 'governance'],
              authorizationMode: 'credential',
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(draft))),
    );

    render(
      await GenericMetaEntityPage({
        searchParams: Promise.resolve({
          rel: 'draft:continuity-unlocated',
          thread: 'release-1',
          returnTo: '/meta?query=writer',
        }),
      }),
    );

    const target = destinationOf(await screen.findByRole('link', { name: '返回候选作者修复' }));
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      rel: 'agent-run:author-1',
      thread: 'release-1',
      returnTo: '/meta?query=writer',
    });
    expect(target.searchParams.has('scope')).toBe(false);
  });
});
