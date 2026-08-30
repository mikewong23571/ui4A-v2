// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    render(<MetaDashboard requestedScope="governance" />);
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
});
