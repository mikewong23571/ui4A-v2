import { afterEach, describe, expect, it, vi } from 'vitest';

import { redirectToLoginOnAuthError } from './auth-redirect';
import { execAction, fetchEntity } from './exec-client';

vi.mock('./auth-redirect', () => ({
  redirectToLoginOnAuthError: vi.fn(() => false),
}));

const entity = { class: ['meta'], properties: {}, actions: [], links: [] };

afterEach(() => vi.unstubAllGlobals());

describe('合同站路由', () => {
  it('meta focus 从 /_meta 读取，业务实体仍从业务站读取', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(entity), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchEntity('meta/flow:post-status');
    await fetchEntity('post:first-post');
    await fetchEntity('meta/agent-definition:author@1', undefined, 'governance');
    await fetchEntity('draft:d1', undefined, 'governance');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_meta/api/entity?rel=meta%2Fflow%3Apost-status');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/entity?rel=post%3Afirst-post');
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      '/_meta/api/entity?rel=meta%2Fagent-definition%3Aauthor%401&scope=governance',
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/_meta/api/entity?rel=draft%3Ad1&scope=governance');
  });

  it('meta action 写入 /_meta，身份仍是 renderer human', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entity }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await execAction({ rel: 'meta/activation:a1', action: 'approve' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_meta/api/exec');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      rel: 'meta/activation:a1',
      action: 'approve',
      actor: 'human',
      principal: 'local-user',
      channel: 'renderer',
    });
  });

  it('cross-plane human action carries the selected scope in the server-judged URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entity }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await execAction({ rel: 'agent-run:r1', action: 'cancel', scope: 'governance' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/exec?scope=governance');
  });
});

describe('401 认证错误跳转接线(T22 验证修复)', () => {
  it('fetchEntity 非 ok 时先解析 body 调跳转 helper 再抛错', async () => {
    const body = { error: { code: 'credential_missing' } };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(fetchEntity('post:first')).rejects.toThrow('HTTP 401');

    expect(redirectToLoginOnAuthError).toHaveBeenCalledWith(401, body);
  });

  it('execAction 非 ok 时调跳转 helper 后照常返回失败结果', async () => {
    const body = { error: { code: 'session_expired' } };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const result = await execAction({ rel: 'post:first', action: 'archive' });

    expect(redirectToLoginOnAuthError).toHaveBeenCalledWith(401, body);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});
