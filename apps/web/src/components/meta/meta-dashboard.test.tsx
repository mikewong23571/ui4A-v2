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
    expect(screen.getByRole('combobox', { name: '当前视角' })).toBeTruthy();
    expect(screen.getByText(/切换视角不扩大或缩小权限/)).toBeTruthy();
    expect(screen.queryByText('当前 Scope')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Publishing' } });
    await waitFor(() => expect(screen.getByRole('link', { name: /Publishing/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Invalid' }));
    expect(window.location.search).toContain('filter=invalid');
  });

  it('把无显式视角显示为未选择，不从 authorizedScopes 暗选首项', async () => {
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

    expect(screen.getByText('未选择视角')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: '当前视角' }) as HTMLSelectElement).value).toBe(
      '',
    );
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

  it('分离轻量当前视角与 sitemap 授予并集的只读说明', async () => {
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

    const currentView = screen.getByTestId('meta-current-view');
    expect(currentView.textContent).toContain('当前视角');
    expect(currentView.textContent).toContain('governance');
    expect(currentView.className).toContain('rounded-full');

    const applications = screen.getByRole('region', { name: '可访问应用' });
    expect(within(applications).getByText('publishing')).toBeTruthy();
    expect(within(applications).getByText('governance')).toBeTruthy();
    expect(within(applications).queryByRole('combobox')).toBeNull();
    expect(applications.textContent).toContain('由凭证授予');
    expect(applications.textContent).not.toContain('切换权限');
    expect(screen.queryByText(/Scope/)).toBeNull();
  });
});
