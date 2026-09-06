import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadPresentationSidecar } from './load';

afterEach(() => vi.unstubAllGlobals());

describe('bounded stored responsibility replan', () => {
  it('replans once through the existing request using the same subject, scope and abort signal', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'presentation-responsibility-stale' } }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json({ sidecar: { id: 'sidecar:repaired' } }))
      .mockResolvedValueOnce(Response.json({ sidecar: { version: 2 } }));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const result = await loadPresentationSidecar(
      'sidecar:old',
      'workspace:example',
      'research',
      signal,
    );
    expect(result.sidecarId).toBe('sidecar:repaired');
    expect(result.response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]![0]).toBe('/api/presentation?scope=research');
    const request = fetch.mock.calls[1]![1]!;
    expect(request.signal).toBe(signal);
    expect(JSON.parse(request.body)).toMatchObject({
      subject: 'workspace:example',
      intent: 'read',
      delivery: 'canvas',
    });
    expect(fetch.mock.calls[2]![0]).toContain('sidecar%3Arepaired');
  });

  it('does not retry a second coverage failure or turn it into success', async () => {
    const stale = () =>
      Response.json({ error: { code: 'presentation-responsibility-stale' } }, { status: 409 });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(stale())
      .mockResolvedValueOnce(Response.json({ sidecar: { id: 'sidecar:a' } }))
      .mockResolvedValueOnce(stale());
    vi.stubGlobal('fetch', fetch);
    const result = await loadPresentationSidecar(
      'sidecar:a',
      'reviews',
      undefined,
      new AbortController().signal,
    );
    expect(result.response.status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([403, 404, 500])('preserves HTTP %s without a replan request', async (status) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'unavailable' }, { status }));
    vi.stubGlobal('fetch', fetch);
    const result = await loadPresentationSidecar(
      'sidecar:a',
      'reviews',
      undefined,
      new AbortController().signal,
    );
    expect(result.response.status).toBe(status);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails honestly when the replan cannot produce a sidecar', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'presentation-responsibility-stale' } }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'failed' }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      loadPresentationSidecar('sidecar:a', 'reviews', undefined, new AbortController().signal),
    ).rejects.toThrow('replan');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
