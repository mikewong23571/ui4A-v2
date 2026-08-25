import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getAgentDefinitionCatalog: vi.fn(async () => []),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getMetaSitemap: vi.fn(() => ({ site: 'meta', surfaces: [{ rel: 'meta/self' }] })),
    getSnapshot: vi.fn(() => ({ applications: { default: {}, publishing: {} } })),
  })),
  metaContextFromRequest: vi.fn(() => ({
    principal: 'local-user',
    effectiveScope: 'publishing',
    authorizedScopes: ['default', 'publishing'],
    authorizationMode: 'self-reported-local-demo',
  })),
  requestIdentityProfile: vi.fn((): 'local' | 'production' => 'production'),
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('../../../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
}));

vi.mock('../../../../../engine/agent-definitions', () => ({
  getAgentDefinitionCatalog: mocks.getAgentDefinitionCatalog,
}));

vi.mock('../../../../../engine/meta-authorization', () => ({
  metaContextFromRequest: mocks.metaContextFromRequest,
}));

vi.mock('../../../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  requestIdentityProfile: mocks.requestIdentityProfile,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { GET } from './route';

// GET /_meta/.well-known/ui4a.json production 身份接线(T22 验证修复):
// - 无凭证 → 401(不信任自报 header/query 身份);
// - 合法凭证 → 200:effectiveScope 取 credential policy scope,authorizedScopes 收窄为
//   granted policy scopes,authorizationMode='credential';
// - local profile 行为不变(self-reported 适配器)。

const CREDENTIAL_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:policy:default', 'ui4a:policy:publishing'],
  policyScope: 'publishing',
  channel: 'oidc',
  humanApprovalEligible: true,
};

describe('GET /_meta/.well-known/ui4a.json production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
  });

  it('returns stable 401 for a missing credential without serving the sitemap', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );

    const response = await GET(new Request('https://ui4a.internal/_meta/.well-known/ui4a.json'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'credential_missing' } });
    expect(mocks.getAgentDefinitionCatalog).not.toHaveBeenCalled();
  });

  it('resolves a credential identity and narrows the sitemap to granted scopes', async () => {
    const incoming = new Request('https://ui4a.internal/_meta/.well-known/ui4a.json');
    const response = await GET(incoming);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      effectiveScope: string;
      authorizedScopes: string[];
      authorizationMode: string;
    };
    expect(body.effectiveScope).toBe('publishing');
    expect(body.authorizedScopes).toEqual(['default', 'publishing']);
    expect(body.authorizationMode).toBe('credential');
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'meta',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['default', 'publishing'],
        defaultPolicyScope: 'publishing',
      }),
    );
    expect(mocks.metaContextFromRequest).not.toHaveBeenCalled();
    expect(mocks.getAgentDefinitionCatalog).toHaveBeenCalledWith(
      expect.anything(),
      'human-alice',
      'publishing',
    );
  });

  it('keeps local profile behavior unchanged (self-reported adapter)', async () => {
    mocks.requestIdentityProfile.mockReturnValue('local');

    const response = await GET(new Request('http://localhost:3100/_meta/.well-known/ui4a.json'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorizationMode: string };
    expect(body.authorizationMode).toBe('self-reported-local-demo');
    expect(mocks.resolveTrustedRequestIdentity).not.toHaveBeenCalled();
    expect(mocks.metaContextFromRequest).toHaveBeenCalled();
  });
});
