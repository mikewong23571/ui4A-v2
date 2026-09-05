// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

// F-07:401 跳转决策本体在 auth-redirect(自测覆盖);此处桩化,只钉接线。
const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('../auth-redirect', () => ({
  redirectToLoginOnAuthError: redirectMock,
}));

import {
  execMetaAction,
  fetchMetaEntity,
  fetchMetaSitemap,
  subscribeMetaScopeGeneration,
  useMetaEntity,
} from './meta-client';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
                href: '/api/internal/agent-run-callback',
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

  it('reuses a revision-aware exact entity across sequential section remounts but fresh reads bypass it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(exact), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchMetaEntity('draft:cache-test', 'governance', { revision: 'sitemap-v1' });
    await fetchMetaEntity('draft:cache-test', 'governance', { revision: 'sitemap-v1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fetchMetaEntity('draft:cache-test', 'governance', {
      revision: 'sitemap-v1',
      fresh: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates authorized exact, collection, and dashboard dependencies after a successful write', async () => {
    const scope = 'governance';
    const revision = 'cache-invalidation-v1';
    const exactRel = 'meta/activation:cache-invalidation-a1';
    const collectionRel = 'meta/activations';
    const dashboardCollectionRel = 'meta/drafts';
    const entityForRel = (rel: string): SirenEntity => ({
      class: rel === exactRel ? ['meta', 'activation'] : ['collection', rel],
      properties: { rel },
      actions:
        rel === exactRel
          ? [
              {
                name: 'approve',
                title: 'Approve',
                method: 'POST',
                href: '/_meta/api/exec',
                fields: { type: 'object', properties: {} },
              },
            ]
          : [],
      links: [],
      'guard-results': [],
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ entity: entityForRel(exactRel) }), { status: 200 });
      }
      const rel = new URL(String(input), 'http://ui4a.local').searchParams.get('rel');
      return new Response(JSON.stringify(entityForRel(rel ?? 'missing')), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchMetaEntity(exactRel, scope, { revision });
    await fetchMetaEntity(collectionRel, scope, { revision });
    await fetchMetaEntity(dashboardCollectionRel, scope, { revision });
    await fetchMetaEntity(exactRel, 'publishing', { revision });

    await execMetaAction({ rel: exactRel, action: 'approve', scope });

    await fetchMetaEntity(exactRel, scope, { revision });
    await fetchMetaEntity(collectionRel, scope, { revision });
    await fetchMetaEntity(dashboardCollectionRel, scope, { revision });
    await fetchMetaEntity(exactRel, 'publishing', { revision });

    const getRequests = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).flatMap(
      ([input, init]) =>
        init?.method === 'POST' ? [] : [new URL(String(input), 'http://ui4a.local')],
    );
    const reads = (rel: string, requestedScope: string) =>
      getRequests.filter(
        (request) =>
          request.searchParams.get('rel') === rel &&
          request.searchParams.get('scope') === requestedScope,
      );
    expect(reads(exactRel, scope)).toHaveLength(3);
    expect(reads(collectionRel, scope)).toHaveLength(2);
    expect(reads(dashboardCollectionRel, scope)).toHaveLength(2);
    expect(reads(exactRel, 'publishing')).toHaveLength(1);
  });

  it('does not let a pre-write in-flight read refill or serve the mutated scope cache', async () => {
    const scope = 'governance-race';
    const revision = 'cache-race-v1';
    const exactRel = 'meta/activation:cache-race-a1';
    const collectionRel = 'meta/activations';
    let resolveStale: ((response: Response) => void) | undefined;
    const staleResponse = new Promise<Response>((resolve) => {
      resolveStale = resolve;
    });
    let collectionReads = 0;
    const entityForRel = (rel: string, status: string): SirenEntity => ({
      class: rel === exactRel ? ['meta', 'activation'] : ['meta', 'collection'],
      properties: { rel, status },
      actions:
        rel === exactRel
          ? [
              {
                name: 'approve',
                title: 'Approve',
                method: 'POST',
                href: '/_meta/api/exec',
                fields: { type: 'object', properties: {} },
              },
            ]
          : [],
      links: [],
      'guard-results': [],
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ entity: entityForRel(exactRel, 'approved') }));
      }
      const rel = new URL(String(input), 'http://ui4a.local').searchParams.get('rel') ?? '';
      if (rel === collectionRel) {
        collectionReads += 1;
        if (collectionReads === 1) return staleResponse;
        return new Response(JSON.stringify(entityForRel(rel, 'after-write')));
      }
      return new Response(JSON.stringify(entityForRel(rel, 'pending-approval')));
    });
    vi.stubGlobal('fetch', fetchMock);

    const staleRead = fetchMetaEntity(collectionRel, scope, { revision });
    await execMetaAction({ rel: exactRel, action: 'approve', scope });
    const currentRead = fetchMetaEntity(collectionRel, scope, { revision });
    resolveStale?.(new Response(JSON.stringify(entityForRel(collectionRel, 'before-write'))));

    await expect(currentRead).resolves.toMatchObject({ properties: { status: 'after-write' } });
    await expect(staleRead).resolves.toMatchObject({ properties: { status: 'before-write' } });
    await expect(fetchMetaEntity(collectionRel, scope, { revision })).resolves.toMatchObject({
      properties: { status: 'after-write' },
    });
    expect(collectionReads).toBe(2);
  });

  it('notifies only the written scope generation and stops notifying after unsubscribe', async () => {
    const written: number[] = [];
    const untouched: number[] = [];
    const stopWritten = subscribeMetaScopeGeneration('governance-subscription', () =>
      written.push(written.length + 1),
    );
    const stopUntouched = subscribeMetaScopeGeneration('publishing-subscription', () =>
      untouched.push(untouched.length + 1),
    );
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ entity: { ...exact, actions: [] } }), { status: 200 })
        : new Response(JSON.stringify(exact), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await execMetaAction({
      rel: 'draft:d1',
      action: 'approve',
      scope: 'governance-subscription',
    });
    expect(written).toEqual([1]);
    expect(untouched).toEqual([]);

    stopWritten();
    stopUntouched();
    await execMetaAction({
      rel: 'draft:d1',
      action: 'approve',
      scope: 'governance-subscription',
    });
    expect(written).toEqual([1]);
    expect(untouched).toEqual([]);
  });

  it('F-07:sitemap 与 entity 读取遇 401 接入统一登录跳转,错误照常抛出', async () => {
    const body = { error: { code: 'credential_missing' } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    redirectMock.mockClear();

    await expect(fetchMetaSitemap('f07-scope')).rejects.toThrow('HTTP 401');
    await expect(fetchMetaEntity('draft:f07', 'f07-scope')).rejects.toThrow('HTTP 401');
    // 两条读路径都把 (status, body) 交给统一跳转决策(由它判定认证类 401)。
    expect(redirectMock).toHaveBeenCalledTimes(2);
    expect(redirectMock).toHaveBeenNthCalledWith(1, 401, body);
    expect(redirectMock).toHaveBeenNthCalledWith(2, 401, body);
  });

  it('F-07:404 仍返回 null(存在性隐藏语义不变),不触发登录跳转', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
    );
    redirectMock.mockClear();

    await expect(fetchMetaEntity('draft:ghost', 'f07-404')).resolves.toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

// T56 P1.3(US11/FR10):过期请求不覆盖新主体——同一 client 连续请求主体 A→B,
// B 慢 A 快时,A 的迟到响应不得覆盖 B 的主面/标题/成员卡(useMetaEntity 消费口径)。
describe('Meta entity hook stale-subject guard (T56 P1.3)', () => {
  it('a late response for the previous subject never overwrites the current subject', async () => {
    const entityFor = (rel: string): SirenEntity => ({
      class: ['meta', 'draft'],
      properties: { rel, identity: `identity-of-${rel}` },
      actions: [],
      links: [],
      'guard-results': [],
    });
    let resolveStale: ((response: Response) => void) | undefined;
    const staleResponse = new Promise<Response>((resolve) => {
      resolveStale = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const rel = new URL(String(input), 'http://ui4a.local').searchParams.get('rel') ?? '';
      if (rel === 'draft:p13-a') return staleResponse;
      return new Response(JSON.stringify(entityFor(rel)), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ rel }) => useMetaEntity(rel), {
      initialProps: { rel: 'draft:p13-a' },
    });
    expect(result.current.state).toBe('loading');
    rerender({ rel: 'draft:p13-b' });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.entity).toMatchObject({ properties: { rel: 'draft:p13-b' } });

    // A 的迟到响应落地:当前主面仍为 B(乱序 resolve 不回写)。
    await act(async () => {
      resolveStale?.(new Response(JSON.stringify(entityFor('draft:p13-a')), { status: 200 }));
    });
    expect(result.current.state).toBe('ready');
    expect(result.current.entity).toMatchObject({
      properties: { rel: 'draft:p13-b', identity: 'identity-of-draft:p13-b' },
    });
  });
});

it('preserves the pending confirmation returned by a governed Meta action', async () => {
  const rel = 'meta/application:pending-fixture';
  const current = {
    ...exact,
    class: ['meta', 'application'],
    properties: { rel },
    actions: [{ ...exact.actions[0]!, name: 'deprecate' }],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, init) =>
        new Response(
          JSON.stringify(
            init?.method === 'POST'
              ? { status: 'suspended', confirmation: { rel: 'confirmation:c6' } }
              : current,
          ),
          { status: init?.method === 'POST' ? 202 : 200 },
        ),
    ),
  );
  expect(await execMetaAction({ rel, action: 'deprecate', scope: 'governance' })).toMatchObject({
    ok: false,
    status: 202,
    layer: 'confirmation-required',
    confirmation: { rel: 'confirmation:c6' },
  });
});
