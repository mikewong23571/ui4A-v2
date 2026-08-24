import { describe, expect, it, vi } from 'vitest';

import {
  AuthPrivateStoreCapacityError,
  createInMemoryAuthPrivateStore,
} from './in-memory-auth-private-store';
import { createBrowserAuthentication } from './browser-session';

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

  it('globally sweeps expired records before enforcing the fixed capacity', async () => {
    let now = NOW_MS;
    const store = createInMemoryAuthPrivateStore({ clock: () => now, maxEntries: 2 });
    const privateMarker = '__private_record_must_not_enter_capacity_error__';

    await store.put('expired-a', privateMarker, NOW_MS + 1_000);
    await store.put('expired-b', 'b', NOW_MS + 1_000);
    const capacityError = await store
      .put('full', 'blocked', NOW_MS + 2_000)
      .catch((error: unknown) => error);
    expect(capacityError).toEqual(new AuthPrivateStoreCapacityError());
    expect(JSON.stringify(capacityError)).not.toContain(privateMarker);

    now = NOW_MS + 1_000;
    await expect(store.put('replacement-a', 'a2', NOW_MS + 2_000)).resolves.toBeUndefined();
    await expect(store.put('replacement-b', 'b2', NOW_MS + 2_000)).resolves.toBeUndefined();
    await expect(store.get('replacement-a')).resolves.toBe('a2');
    await expect(store.get('replacement-b')).resolves.toBe('b2');
  });

  it('bounds repeated public login starts without evicting existing private records', async () => {
    let now = NOW_MS;
    let randomValue = 0;
    const store = createInMemoryAuthPrivateStore({ clock: () => now, maxEntries: 4 });
    const authentication = createBrowserAuthentication({
      policy: {
        issuer: 'https://auth.ui4a.internal/realms/ui4a',
        authorizationEndpoint:
          'https://auth.ui4a.internal/realms/ui4a/protocol/openid-connect/auth',
        clientId: 'ui4a-web',
        audience: 'ui4a-web',
        redirectUri: 'https://ui4a.internal/api/auth/callback',
        scopes: ['openid'],
        sessionCookieName: '__Host-ui4a_session',
        loginCookieName: '__Host-ui4a_login',
        sessionTtlMs: 60_000,
        loginTtlMs: 10_000,
        refreshBeforeExpiryMs: 1_000,
        defaultReturnTo: '/',
        allowedReturnOrigin: 'https://ui4a.internal',
      },
      sessionKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      clock: () => now,
      randomBytes: (size) => {
        randomValue += 1;
        return Uint8Array.from({ length: size }, (_, index) => randomValue + index);
      },
      sha256: (value) => value,
      loginTransactions: store,
      sessions: store,
      exchangeCode: vi.fn(),
      refresh: vi.fn(),
      revoke: vi.fn(),
      verifyIdToken: vi.fn(),
    });
    const request = new Request('https://ui4a.internal/auth/login');

    await authentication.beginLogin(request);
    await authentication.beginLogin(request);
    await expect(authentication.beginLogin(request)).rejects.toEqual(
      new AuthPrivateStoreCapacityError(),
    );

    now += 10_000;
    await expect(authentication.beginLogin(request)).resolves.toMatchObject({ status: 302 });
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
