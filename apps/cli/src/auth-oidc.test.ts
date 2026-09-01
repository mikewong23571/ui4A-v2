import { describe, expect, it, vi } from 'vitest';

import type { CliConfig } from './config.js';
import {
  deviceLogin,
  refreshAccessCredential,
  revokeStoredCredential,
  type CredentialStore,
  type StoredCredential,
} from './auth-oidc.js';

const config: CliConfig = {
  baseUrl: 'https://ui4a.example',
  issuer: 'https://auth.ui4a.example/realms/ui4a',
  clientId: 'ui4a-cli',
  applications: ['development'],
  principal: 'local-user',
  policyScope: 'publishing',
  sources: {
    baseUrl: 'config',
    issuer: 'config',
    clientId: 'config',
    applications: 'config',
    token: 'missing',
    principal: 'local-demo-default',
    policyScope: 'local-demo-default',
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function discovery() {
  return {
    issuer: config.issuer,
    device_authorization_endpoint: `${config.issuer}/protocol/openid-connect/auth/device`,
    token_endpoint: `${config.issuer}/protocol/openid-connect/token`,
    revocation_endpoint: `${config.issuer}/protocol/openid-connect/revoke`,
  };
}

function memoryStore(initial?: StoredCredential): CredentialStore & { value?: StoredCredential } {
  return {
    value: initial,
    async read() {
      return this.value;
    },
    async write(_key, value) {
      this.value = value;
    },
    async delete() {
      this.value = undefined;
    },
  };
}

describe('OIDC Device credential lifecycle', () => {
  it('honors pending and slow_down, then stores only the offline refresh credential', async () => {
    const store = memoryStore();
    const sleeps: number[] = [];
    const notifications: unknown[] = [];
    const tokenBodies: URLSearchParams[] = [];
    let tokenPoll = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) return response(discovery());
      const body = new URLSearchParams(String(init?.body));
      if (url.endsWith('/auth/device')) {
        expect(body.get('scope')).toBe(
          'openid offline_access ui4a:read ui4a:write ui4a:policy:development',
        );
        return response({
          device_code: 'device-secret',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.ui4a.example/device',
          verification_uri_complete: 'https://auth.ui4a.example/device?user_code=ABCD-EFGH',
          expires_in: 600,
          interval: 5,
        });
      }
      tokenBodies.push(body);
      tokenPoll += 1;
      if (tokenPoll === 1) return response({ error: 'authorization_pending' }, 400);
      if (tokenPoll === 2) return response({ error: 'slow_down' }, 400);
      return response({
        access_token: 'access-secret',
        refresh_token: 'offline-secret',
        token_type: 'Bearer',
        expires_in: 86_400,
        refresh_expires_in: 7_776_000,
        scope: 'openid offline_access ui4a:read ui4a:write ui4a:policy:development',
      });
    });

    const result = await deviceLogin(config, {
      fetch: fetcher,
      store,
      now: () => 0,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      notify: async (notice) => {
        notifications.push(notice);
      },
    });

    expect(result).toEqual({
      expiresInSeconds: 86_400,
      refreshExpiresInSeconds: 7_776_000,
      scopes: ['openid', 'offline_access', 'ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
    });
    expect(store.value).toEqual({ schemaVersion: 1, refreshToken: 'offline-secret' });
    expect(sleeps).toEqual([5_000, 10_000]);
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toContain('device-secret');
    expect(tokenBodies.every((body) => body.get('client_secret') === null)).toBe(true);
  });

  it('refreshes, atomically stores the returned rotation, and returns access only in memory', async () => {
    const store = memoryStore({ schemaVersion: 1, refreshToken: 'old-refresh' });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) {
        return response(discovery());
      }
      return response({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 86_400,
        refresh_expires_in: 7_776_000,
        scope: 'ui4a:read ui4a:write ui4a:policy:development offline_access',
      });
    });

    await expect(refreshAccessCredential(config, { fetch: fetcher, store })).resolves.toBe(
      'new-access',
    );
    expect(store.value).toEqual({ schemaVersion: 1, refreshToken: 'new-refresh' });
    expect(JSON.stringify(store.value)).not.toContain('new-access');
  });

  it('revokes before deleting and rejects any approve scope returned by the issuer', async () => {
    const store = memoryStore({ schemaVersion: 1, refreshToken: 'offline-refresh' });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) {
        return response(discovery());
      }
      return response(null);
    });
    await expect(revokeStoredCredential(config, { fetch: fetcher, store })).resolves.toBe(true);
    expect(store.value).toBeUndefined();

    const unsafeStore = memoryStore({ schemaVersion: 1, refreshToken: 'offline-refresh' });
    const unsafeFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) {
        return response(discovery());
      }
      return response({
        access_token: 'unsafe-access',
        refresh_token: 'unsafe-refresh',
        token_type: 'Bearer',
        expires_in: 86_400,
        refresh_expires_in: 7_776_000,
        scope: 'ui4a:read ui4a:approve offline_access',
      });
    });
    await expect(
      refreshAccessCredential(config, { fetch: unsafeFetch, store: unsafeStore }),
    ).rejects.toMatchObject({ code: 'AUTH_SCOPE_INVALID' });
    expect(unsafeStore.value?.refreshToken).toBe('offline-refresh');
  });

  it('fails closed on denied Device authorization and cross-origin discovery', async () => {
    const deniedFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) {
        return response(discovery());
      }
      if (String(input).endsWith('/auth/device')) {
        return response({
          device_code: 'device-secret',
          user_code: 'DENY-CODE',
          verification_uri: 'https://auth.ui4a.example/device',
          expires_in: 600,
          interval: 5,
        });
      }
      return response({ error: 'access_denied' }, 400);
    });
    await expect(
      deviceLogin(config, {
        fetch: deniedFetch,
        store: memoryStore(),
        now: () => 0,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'AUTH_DEVICE_DENIED' });

    const crossOriginFetch = vi.fn<typeof fetch>(async () =>
      response({
        ...discovery(),
        token_endpoint: 'https://attacker.invalid/token',
      }),
    );
    await expect(
      refreshAccessCredential(config, {
        fetch: crossOriginFetch,
        store: memoryStore({ schemaVersion: 1, refreshToken: 'stored-refresh' }),
      }),
    ).rejects.toMatchObject({ code: 'OIDC_DISCOVERY_INVALID' });
  });

  it('requires login, bounds Device polling, and reports discovery outages', async () => {
    await expect(
      refreshAccessCredential(config, {
        fetch: vi.fn<typeof fetch>(),
        store: memoryStore(),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_LOGIN_REQUIRED' });

    let clock = 0;
    const pendingFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) {
        return response(discovery());
      }
      if (String(input).endsWith('/auth/device')) {
        return response({
          device_code: 'device-secret',
          user_code: 'WAIT-CODE',
          verification_uri: 'https://auth.ui4a.example/device',
          expires_in: 1,
          interval: 1,
        });
      }
      return response({ error: 'authorization_pending' }, 400);
    });
    await expect(
      deviceLogin(config, {
        fetch: pendingFetch,
        store: memoryStore(),
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_DEVICE_DENIED' });

    await expect(
      deviceLogin(config, {
        fetch: vi.fn<typeof fetch>(async () => {
          throw new Error('offline');
        }),
        store: memoryStore(),
      }),
    ).rejects.toMatchObject({ code: 'OIDC_UNAVAILABLE', retryable: true });
  });
});
