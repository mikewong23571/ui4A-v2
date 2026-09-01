import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getSnapshot: vi.fn(() => ({
      applications: { default: {}, publishing: {}, security: {} },
      instances: {
        'post:first': { rel: 'post:first', flow: 'post-flow', node: 'ready', fields: {} },
        'cve:CVE-2026-0001': {
          rel: 'cve:CVE-2026-0001',
          flow: 'cve-flow',
          node: 'ready',
          fields: {},
        },
      },
      definitions: {
        'post-flow': { definition: { name: 'post-flow', app: 'publishing' } },
        'cve-flow': { definition: { name: 'cve-flow', app: 'security' } },
      },
    })),
    getSitemap: vi.fn(() => ({ surfaces: [] })),
  })),
  listEvents: vi.fn(
    async (): Promise<Array<{ seq: number; kind: string; rel: string; domain?: string }>> => [
      { seq: 1, kind: 'seed', rel: 'seed:a' },
    ],
  ),
  requestIdentityProfile: vi.fn((): 'local' | 'production' => 'production'),
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('@ui4a/db/events', () => ({
  listEvents: mocks.listEvents,
}));

vi.mock('../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
}));

vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  requestIdentityProfile: mocks.requestIdentityProfile,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { GET } from './route';

// GET /api/events production 身份接线(T22 验证修复):
// - 无凭证 → 401(不信任 x-ui4a-principal header / ?principal= query);
// - 合法凭证 → 200,审计端点语义保持(无过滤返回全部);
// - principal 过滤超出 credential → 403(沿用既有文案)。

const CREDENTIAL_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:policy:default'],
  grantedApplications: ['default'],
  channel: 'oidc',
  humanApprovalEligible: true,
};

function request(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`https://ui4a.internal/api/events${query}`, { headers });
}

describe('GET /api/events production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
  });

  it('returns stable 401 for a missing credential without reading events', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'credential_missing' } });
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it('resolves a business credential identity and serves the full audit read', async () => {
    const incoming = request();
    const response = await GET(incoming);

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['default', 'publishing', 'security'],
      }),
    );
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.not.objectContaining({ principal: expect.anything() }),
    );
  });

  it('rejects a principal filter exceeding the credential with 403', async () => {
    const response = await GET(request('?principal=other-user'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'principal filter cannot exceed credential scope',
    });
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it('accepts a principal filter equal to the credential and narrows the read', async () => {
    const response = await GET(request('', { 'x-ui4a-principal': CREDENTIAL_IDENTITY.principal }));

    expect(response.status).toBe(200);
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.objectContaining({ principal: 'human-alice' }),
    );
  });

  it('filters raw capability receipts by the credential Application grants', async () => {
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce({
      ...CREDENTIAL_IDENTITY,
      scopes: ['ui4a:read', 'ui4a:policy:publishing'],
      grantedApplications: ['publishing'],
    });
    mocks.listEvents.mockResolvedValueOnce([
      {
        seq: 1,
        domain: 'capability',
        kind: 'function-execution-finalized',
        rel: 'cve:CVE-2026-0001',
      },
      { seq: 2, domain: 'core', kind: 'action-executed', rel: 'post:first' },
    ]);

    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      events: [{ rel: 'post:first' }],
    });
  });

  it('keeps local profile behavior unchanged (no identity resolution)', async () => {
    mocks.requestIdentityProfile.mockReturnValue('local');

    const response = await GET(request('?principal=user:a'));

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).not.toHaveBeenCalled();
    expect(mocks.getEngine).not.toHaveBeenCalled();
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.objectContaining({ principal: 'user:a' }),
    );
  });
});
