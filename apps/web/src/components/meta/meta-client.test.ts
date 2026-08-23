// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { execMetaAction, fetchMetaEntity, fetchMetaSitemap } from './meta-client';

const exact: SirenEntity = {
  class: ['meta', 'draft'],
  properties: { rel: 'draft:d1' },
  actions: [
    {
      name: 'approve',
      title: 'Approve',
      method: 'POST',
      href: '/_meta/api/exec',
      fields: { type: 'object', properties: {} },
    },
  ],
  links: [],
  'guard-results': [],
};

afterEach(() => vi.unstubAllGlobals());

describe('Meta browser client', () => {
  it('carries the same URL scope through sitemap and entity reads without identity headers', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...exact, effectiveScope: 'governance' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchMetaSitemap('governance');
    await fetchMetaEntity('draft:d1', 'governance');

    expect(
      (fetchMock.mock.calls as unknown as [string, RequestInit?][]).map(([url]) => String(url)),
    ).toEqual([
      '/_meta/.well-known/ui4a.json?scope=governance',
      '/_meta/api/entity?rel=draft%3Ad1&scope=governance',
    ]);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit?])[1]).toBeUndefined();
  });

  it('rereads the exact entity, submits only a current declared action, and omits identity fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(exact), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entity: { ...exact, actions: [] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await execMetaAction({
      rel: 'draft:d1',
      action: 'approve',
      scope: 'governance',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[0])).toBe(
      '/_meta/api/exec?scope=governance',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      rel: 'draft:d1',
      action: 'approve',
    });
  });

  it('fails closed before POST when an action disappeared or is an internal callback', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...exact,
            actions: [
              {
                name: 'capability-callback',
                title: 'Internal',
                method: 'POST',
                href: '/api/internal/capability-callback',
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await execMetaAction({ rel: 'draft:d1', action: 'approve' });
    expect(result).toMatchObject({ ok: false, layer: 'stale-action' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
