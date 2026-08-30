// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DefinitionManagementPage, { metadata } from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('定义管理入口文案', () => {
  it('导航目标是 sitemap 驱动的人类定义控制台', async () => {
    render(await DefinitionManagementPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('定义控制台');
    expect(screen.getByText(/Meta Human Control Plane/)).toBeTruthy();
    expect(metadata.title).toBe('定义控制台 · UI4A');
  });

  it('Dashboard 进入 collection 时保留显式视角、工作线和返回目标', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('.well-known')) {
          return new Response(
            JSON.stringify({
              protocolVersion: '1',
              version: 'continuity-v1',
              site: 'meta',
              effectiveScope: 'governance',
              authorizedScopes: ['publishing', 'governance'],
              authorizationMode: 'credential',
              surfaces: [{ rel: 'meta/drafts', title: 'Drafts', collection: true }],
            }),
          );
        }
        return new Response(
          JSON.stringify({
            class: ['collection', 'meta/drafts'],
            properties: { rel: 'meta/drafts', count: 1 },
            actions: [],
            links: [],
            entities: [],
            'guard-results': [],
          }),
        );
      }),
    );

    render(
      await DefinitionManagementPage({
        searchParams: Promise.resolve({
          scope: 'governance',
          thread: 'release-1',
          returnTo: '/threads?focus=thread:release-1',
        }),
      }),
    );

    const link = await screen.findByRole('link', { name: /Drafts/ });
    const target = new URL(link.getAttribute('href') ?? '', 'http://ui4a.local');
    expect(target.pathname).toBe('/meta/entity');
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      rel: 'meta/drafts',
      scope: 'governance',
      thread: 'release-1',
      returnTo: '/threads?focus=thread:release-1',
    });
  });
});
