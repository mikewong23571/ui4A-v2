import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch as doesProxyMatch,
} from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config, proxy } from './proxy';

const nextConfig = {};

describe('production UI page authentication proxy', () => {
  beforeEach(() => vi.stubEnv('UI4A_DEPLOYMENT_PROFILE', 'production'));
  afterEach(() => vi.unstubAllEnvs());

  it.each(['/', '/applications', '/meta', '/entity?rel=inbox'])('covers the UI route %s', (url) => {
    expect(doesProxyMatch({ config, nextConfig, url })).toBe(true);
  });

  it.each([
    '/api/entity?rel=applications',
    '/_meta/api/entity?rel=meta%2Fflows',
    '/.well-known/ui4a.json',
    '/auth/login',
    '/api/auth/callback',
    '/_next/static/chunk.js',
    '/favicon.ico',
    '/live',
    '/version',
  ])('does not turn the contract or public route %s into a browser redirect', (url) => {
    expect(doesProxyMatch({ config, nextConfig, url })).toBe(false);
  });

  it('redirects a missing browser session before rendering the page shell', () => {
    const response = proxy(new NextRequest('https://ui4a.example/meta?query=draft'));

    expect(getRedirectUrl(response)).toBe(
      'https://ui4a.example/auth/login?returnTo=%2Fmeta%3Fquery%3Ddraft',
    );
  });

  it('lets a session-bearing page request continue to its route-level data checks', () => {
    const response = proxy(
      new NextRequest('https://ui4a.example/meta', {
        headers: { cookie: '__Host-ui4a_session=opaque.mac' },
      }),
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(getRedirectUrl(response)).toBeNull();
  });

  it('preserves the existing local demo without inventing a login requirement', () => {
    vi.stubEnv('UI4A_DEPLOYMENT_PROFILE', 'local');

    const response = proxy(new NextRequest('http://localhost:3100/meta'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
