import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductionDeploymentConfig } from '@ui4a/shared';

const composition = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error('browser authentication must not request a database');
  }),
  preflight: vi.fn(),
}));

vi.mock('../engine/service', () => ({ getDb: composition.getDb }));
vi.mock('../production-deployment-preflight', () => ({
  runWebProductionDeploymentPreflight: composition.preflight,
}));

import { getProductionBrowserAuthentication } from './production/browser-authentication-runtime';

const CONFIG = {
  settings: {
    service: {
      publicOrigin: 'https://ui4a.mothership.internal',
      trustedRequestOrigins: ['https://ui4a.mothership.internal'],
    },
    auth: {
      mode: 'oidc',
      oidc: {
        issuer: 'https://auth.ui4a.mothership.internal/realms/ui4a',
        audience: 'ui4a-api',
        clientId: 'ui4a-web',
        clientSecretRef: 'oidc-client-secret',
        sessionSecretRef: 'oidc-session-secret',
        agentClientId: 'ui4a-agent',
        agentClientSecretRef: 'oidc-agent-client-secret',
        agentScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
        callbackUrl: 'https://ui4a.mothership.internal/api/auth/callback',
        scopes: ['openid', 'ui4a:read'],
      },
    },
  },
  secrets: {
    'oidc-client-secret': 'fixed-client-secret',
    'oidc-session-secret': 'fixed-independent-session-secret',
    'oidc-agent-client-secret': 'fixed-agent-client-secret',
  },
} as unknown as ProductionDeploymentConfig;

beforeEach(() => {
  vi.clearAllMocks();
  composition.preflight.mockReturnValue(CONFIG);
});

describe('single-process production browser composition', () => {
  it('reuses one process authentication instance without acquiring a database', () => {
    const first = getProductionBrowserAuthentication();
    const second = getProductionBrowserAuthentication();

    expect(first).toBe(second);
    expect(composition.preflight).toHaveBeenCalledOnce();
    expect(composition.getDb).not.toHaveBeenCalled();
  });

  it('has no production composition dependency on the database store or engine database', () => {
    const source = readFileSync(
      new URL('./production/browser-authentication-runtime.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/\.\.\/db\/auth-private-store|createPostgresAuthPrivateStore|getDb/);
    expect(source).toContain('createInMemoryAuthPrivateStore');
  });
});
