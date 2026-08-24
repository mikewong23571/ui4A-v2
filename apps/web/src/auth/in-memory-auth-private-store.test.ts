import { describe, expect, it, vi } from 'vitest';

import { createInMemoryAuthPrivateStore } from './in-memory-auth-private-store';

const NOW_MS = 1_788_739_200_000;

describe('single-process AuthPrivateStore', () => {
  it('lazily expires records at their exact TTL boundary', async () => {
    let now = NOW_MS;
    const store = createInMemoryAuthPrivateStore({ clock: () => now });

    await store.put('live', { kind: 'session' }, NOW_MS + 1_000);
    await expect(store.get('live')).resolves.toEqual({ kind: 'session' });

    now = NOW_MS + 1_000;
    await expect(store.get('live')).resolves.toBeUndefined();
    await expect(store.take('live')).resolves.toBeUndefined();
  });

  it('atomically single-consumes a record within one Web process', async () => {
    const store = createInMemoryAuthPrivateStore({ clock: () => NOW_MS });
    const payload = { kind: 'browser-login', state: 'single-use' };
    await store.put('single-consume', payload, NOW_MS + 60_000);

    const results = await Promise.all([store.take('single-consume'), store.take('single-consume')]);

    expect(results.filter((value) => value !== undefined)).toEqual([payload]);
    await expect(store.get('single-consume')).resolves.toBeUndefined();
  });

  it('keeps token values in closure-private state and emits no token diagnostics', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createInMemoryAuthPrivateStore({ clock: () => NOW_MS });
    const marker = '__t22_private_refresh_token_must_not_be_output__';

    await expect(
      store.put('private-session', { refreshToken: marker }, NOW_MS + 60_000),
    ).resolves.toBeUndefined();

    expect(JSON.stringify(store)).not.toContain(marker);
    expect(Object.keys(store).sort()).toEqual(['delete', 'get', 'put', 'take']);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await store.delete('private-session');

    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
