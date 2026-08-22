import { afterEach, describe, expect, it, vi } from 'vitest';

import { execAction, fetchEntity } from './exec-client';

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

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_meta/api/entity?rel=meta%2Fflow%3Apost-status');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/entity?rel=post%3Afirst-post');
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
});
