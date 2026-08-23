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
      vi.fn(
        async () =>
          new Response(
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
          ),
      ),
    );

    render(<MetaDashboard requestedScope="governance" />);
    await screen.findByRole('heading', { name: '定义控制台' });
    expect(screen.getAllByTestId('meta-surface')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /Widgets/ }).getAttribute('href')).toBe(
      '/meta/entity?rel=meta%2Fwidgets&scope=governance',
    );
    expect(screen.getByText(/本地演示身份/)).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Publishing' } });
    await waitFor(() => expect(screen.getByRole('link', { name: /Publishing/ })).toBeTruthy());
  });
});
