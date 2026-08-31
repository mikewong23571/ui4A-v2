// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MetaDashboard } from './meta-dashboard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Meta dynamic dashboard', () => {
  it('discovers all top-level and future surfaces from sitemap with authorized scope context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (!url.includes('.well-known')) {
          const rel = new URL(url, 'http://ui4a.local').searchParams.get('rel');
          return new Response(
            JSON.stringify({
              class: ['collection', rel],
              properties: { rel, count: 0 },
              actions: [],
              links: [],
              entities: [],
              'guard-results': [],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            protocolVersion: '1',
            version: 'v1',
            site: 'meta',
            effectiveScope: 'governance',
            authorizedScopes: ['publishing', 'governance'],
            authorizationMode: 'self-reported-local-demo',
            surfaces: [
              { rel: 'meta/self', title: 'Lifecycle' },
              { rel: 'meta/applications', title: 'Applications', collection: true },
              { rel: 'meta/drafts', title: 'Drafts', collection: true },
              { rel: 'meta/widgets', title: 'Widgets', collection: true },
              { rel: 'meta/application:publishing', title: 'Publishing' },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    render(<MetaDashboard navigation={{ scope: 'governance' }} />);
    await screen.findByRole('heading', { name: '定义控制台' });
    expect(screen.getAllByTestId('meta-surface')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /Widgets/ }).getAttribute('href')).toBe(
      '/meta/entity?rel=meta%2Fwidgets&scope=governance',
    );
    expect(screen.getByRole('combobox', { name: '视角' })).toBeTruthy();
    expect(screen.queryByText(/凭证授予|不扩大或缩小权限/)).toBeNull();
    expect(screen.queryByText('当前 Scope')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Publishing' } });
    await waitFor(() => expect(screen.getByRole('link', { name: /Publishing/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '无效' }));
    expect(window.location.search).toContain('filter=invalid');
  });

  it('把无显式视角显示为全部已授权应用，不从 authorizedScopes 暗选首项', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('.well-known')) {
        return new Response(
          JSON.stringify({
            protocolVersion: '1',
            version: 'unlocated-v1',
            site: 'meta',
            authorizedScopes: ['publishing', 'governance'],
            authorizationMode: 'credential',
            surfaces: [{ rel: 'meta/drafts', title: 'Drafts', collection: true }],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          class: ['collection', 'meta/drafts'],
          properties: { rel: 'meta/drafts', count: 0 },
          actions: [],
          links: [],
          entities: [],
          'guard-results': [],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MetaDashboard />);
    await screen.findByTestId('meta-content-ready');

    const viewSelector = screen.getByRole('combobox', { name: '视角' }) as HTMLSelectElement;
    expect(viewSelector.value).toBe('');
    expect(viewSelector.selectedOptions[0]?.textContent).toBe('全部已授权应用');
    expect(screen.queryByText(/当前浏览全部已授权应用/)).toBeNull();
    expect(screen.queryByText(/未选择视角/)).toBeNull();
    expect(screen.queryByTestId('meta-current-view')).toBeNull();

    const collection = screen.getByRole('link', { name: /Drafts/ });
    expect(
      new URL(collection.getAttribute('href') ?? '', 'http://ui4a.local').searchParams.has('scope'),
    ).toBe(false);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/_meta/.well-known/ui4a.json',
      '/_meta/api/entity?rel=meta%2Fdrafts',
    ]);
  });

  it('当前视角只列出 sitemap 已授权应用，不额外堆叠权限说明', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('.well-known')) {
          return new Response(
            JSON.stringify({
              protocolVersion: '1',
              version: 'explicit-v1',
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
            properties: { rel: 'meta/drafts', count: 0 },
            actions: [],
            links: [],
            entities: [],
            'guard-results': [],
          }),
        );
      }),
    );

    render(<MetaDashboard navigation={{ scope: 'governance' }} />);
    await screen.findByTestId('meta-content-ready');

    const selector = screen.getByRole('combobox', { name: '视角' }) as HTMLSelectElement;
    expect(selector.value).toBe('governance');
    expect(within(selector).getByRole('option', { name: 'publishing' })).toBeTruthy();
    expect(within(selector).getByRole('option', { name: 'governance' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '可访问应用' })).toBeNull();
    expect(screen.queryByText(/由凭证授予|切换权限|不扩大或缩小权限/)).toBeNull();
    expect(screen.queryByText(/Scope/)).toBeNull();
  });
});
