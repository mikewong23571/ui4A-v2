import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import type { CredentialStore, StoredCredential } from './auth-credential.js';
import {
  defaultAuthDependencies,
  openBrowser,
  resolveStoredAccessCredential,
  runAuthCommand,
} from './commands-auth.js';
import type { CliConfig } from './config.js';

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

function store(initial?: StoredCredential): CredentialStore {
  let value = initial;
  return {
    async read() {
      return value;
    },
    async write(_key, next) {
      value = next;
    },
    async delete() {
      value = undefined;
    },
  };
}

function discovery() {
  return {
    issuer: config.issuer,
    device_authorization_endpoint: `${config.issuer}/protocol/openid-connect/auth/device`,
    token_endpoint: `${config.issuer}/protocol/openid-connect/token`,
    revocation_endpoint: `${config.issuer}/protocol/openid-connect/revoke`,
  };
}

describe('CLI auth commands', () => {
  it('wires default verification notice through injected stderr and browser adapters', async () => {
    const open = vi.fn();
    const writeStderr = vi.fn();
    const dependencies = defaultAuthDependencies({
      open,
      writeStderr,
      store: store(),
      fetch: vi.fn<typeof fetch>(),
    });
    await dependencies.notify?.({
      verificationUri: 'https://auth.ui4a.example/device',
      verificationUriComplete: 'https://auth.ui4a.example/device?user_code=SAFE-CODE',
      userCode: 'SAFE-CODE',
      expiresInSeconds: 600,
    });
    expect(writeStderr).toHaveBeenCalledWith(expect.stringContaining('SAFE-CODE'));
    expect(open).toHaveBeenCalledWith('https://auth.ui4a.example/device?user_code=SAFE-CODE');

    const child = { on: vi.fn(), unref: vi.fn() };
    openBrowser('https://auth.ui4a.example/device', () => child);
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(child.unref).toHaveBeenCalled();
  });

  it('reports status without exposing a credential or refreshing it', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await runAuthCommand(parseArgs(['auth', 'status']), config, {
      fetch: fetcher,
      store: store({ schemaVersion: 1, refreshToken: 'never-print-this' }),
    });

    expect(result).toMatchObject({
      ok: true,
      command: 'auth.status',
      data: {
        configured: true,
        stored: true,
        issuer: config.issuer,
        clientId: 'ui4a-cli',
        applications: ['development'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('never-print-this');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refreshes Keychain credential before constructing the effective Bearer config', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/.well-known/openid-configuration')) {
        return response(discovery());
      }
      return response({
        access_token: 'memory-only-access',
        refresh_token: 'rotated-refresh',
        token_type: 'Bearer',
        expires_in: 86_400,
        refresh_expires_in: 7_776_000,
        scope: 'ui4a:read ui4a:write ui4a:policy:development offline_access',
      });
    });

    const resolved = await resolveStoredAccessCredential(config, {
      fetch: fetcher,
      store: store({ schemaVersion: 1, refreshToken: 'stored-refresh' }),
    });

    expect(resolved.token).toBe('memory-only-access');
    expect(resolved.sources.token).toBe('keychain');
  });

  it('preserves one-off external Bearer precedence over Keychain', async () => {
    const external = {
      ...config,
      token: 'external-access',
      sources: { ...config.sources, token: 'env' as const },
    };
    const fetcher = vi.fn<typeof fetch>();
    const resolved = await resolveStoredAccessCredential(external, {
      fetch: fetcher,
      store: store({ schemaVersion: 1, refreshToken: 'stored-refresh' }),
    });
    expect(resolved).toBe(external);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('completes login and logout without returning credential material', async () => {
    const credentialStore = store();
    let devicePolls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) return response(discovery());
      if (url.endsWith('/auth/device')) {
        return response({
          device_code: 'device-secret',
          user_code: 'LOGIN-CODE',
          verification_uri: 'https://auth.ui4a.example/device',
          expires_in: 600,
          interval: 5,
        });
      }
      if (url.endsWith('/token')) {
        devicePolls += 1;
        return response({
          access_token: 'memory-access',
          refresh_token: 'stored-refresh',
          token_type: 'Bearer',
          expires_in: 86_400,
          refresh_expires_in: 7_776_000,
          scope: 'openid offline_access ui4a:read ui4a:write ui4a:policy:development',
        });
      }
      return response(null);
    });
    const notice = vi.fn(async () => {});
    const login = await runAuthCommand(parseArgs(['auth', 'login']), config, {
      fetch: fetcher,
      store: credentialStore,
      notify: notice,
      now: () => 0,
      sleep: async () => {},
    });
    expect(login).toMatchObject({ command: 'auth.login', data: { loggedIn: true } });
    expect(JSON.stringify(login)).not.toMatch(/device-secret|memory-access|stored-refresh/);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(devicePolls).toBe(1);

    const logout = await runAuthCommand(parseArgs(['auth', 'logout']), config, {
      fetch: fetcher,
      store: credentialStore,
    });
    expect(logout).toMatchObject({ command: 'auth.logout', data: { revoked: true } });
    expect(JSON.stringify(logout)).not.toContain('stored-refresh');
  });

  it('reports an unconfigured status and rejects unknown auth verbs', async () => {
    const local = { ...config, issuer: undefined };
    await expect(
      runAuthCommand(parseArgs(['auth', 'status']), local, {
        fetch: vi.fn<typeof fetch>(),
        store: store(),
      }),
    ).resolves.toMatchObject({ data: { configured: false, stored: false } });
    await expect(
      runAuthCommand(parseArgs(['auth', 'rotate']), config, {
        fetch: vi.fn<typeof fetch>(),
        store: store(),
      }),
    ).rejects.toMatchObject({ code: 'USAGE' });
  });
});
