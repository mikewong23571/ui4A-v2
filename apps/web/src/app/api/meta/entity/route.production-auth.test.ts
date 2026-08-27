import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const entity = {
    class: ['meta', 'flow'],
    properties: { rel: 'meta/flow:software-change' },
    actions: [],
    links: [],
    'guard-results': [],
  };
  const engine = {
    getMetaEntity: vi.fn(async () => entity),
    getSnapshot: vi.fn(() => ({
      applications: { development: {} },
      definitions: {
        'software-change': {
          definition: { name: 'software-change', app: 'development' },
          status: 'active',
          version: 1,
        },
      },
    })),
    getSitemap: vi.fn(() => ({
      version: 'test',
      surfaces: [],
      flows: [],
      applications: [],
      capabilities: [],
    })),
  };
  return {
    assertRelInPolicyScope: vi.fn(),
    authenticationErrorResponse: vi.fn((error: unknown) => {
      const code = (error as { code?: string }).code;
      return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
    }),
    engine,
    filterEntityForPolicyScope: vi.fn((projected) => projected),
    getAgentDefinitionMetaEntity: vi.fn(),
    getDb: vi.fn(() => ({ kind: 'mock-db' })),
    getDraftMetaEntity: vi.fn(),
    getEngine: vi.fn(async () => engine),
    relCoveredByPolicyScope: vi.fn(() => true),
    resolveTrustedRequestIdentity: vi.fn(),
  };
});

vi.mock('../../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
  isMetaRel: (rel: string) => rel.startsWith('meta/'),
}));

vi.mock('../../../../engine/drafts/drafts', () => ({
  getDraftMetaEntity: mocks.getDraftMetaEntity,
  isDraftMetaRel: () => false,
}));

vi.mock('../../../../engine/agent/agent-definitions', () => ({
  agentDefinitionDraftRegistryPort: {},
  getAgentDefinitionMetaEntity: mocks.getAgentDefinitionMetaEntity,
  isAgentDefinitionMetaRel: () => false,
}));

vi.mock('../../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

vi.mock('../../../../auth/application-scope', () => ({
  assertRelInPolicyScope: mocks.assertRelInPolicyScope,
  filterEntityForPolicyScope: mocks.filterEntityForPolicyScope,
  relCoveredByPolicyScope: mocks.relCoveredByPolicyScope,
}));

import { GET } from './route';

const TRUSTED_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'agent' as const,
  principal: 'credential-subject',
  scopes: ['ui4a:read', 'ui4a:policy:development'],
  policyScope: 'development',
  channel: 'oidc',
  humanApprovalEligible: false,
};

function request(): Request {
  return new Request('https://ui4a.internal/_meta/api/entity?rel=meta%2Fflow%3Asoftware-change', {
    headers: {
      authorization: 'Bearer verified-token',
      'x-ui4a-principal': 'forged-header-root',
      'x-ui4a-policy-scope': 'publishing',
    },
  });
}

describe('GET /_meta/api/entity production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(TRUSTED_IDENTITY);
  });

  it.each(['credential_missing', 'credential_expired'])(
    'returns stable 401 for %s without a Meta read',
    async (code) => {
      mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
        Object.assign(new Error('credential rejected'), { code }),
      );

      const response = await GET(request());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(mocks.assertRelInPolicyScope).not.toHaveBeenCalled();
      expect(mocks.engine.getMetaEntity).not.toHaveBeenCalled();
      expect(mocks.getDraftMetaEntity).not.toHaveBeenCalled();
      expect(mocks.getAgentDefinitionMetaEntity).not.toHaveBeenCalled();
      expect(mocks.filterEntityForPolicyScope).not.toHaveBeenCalled();
    },
  );

  it('uses credential identity and application scope instead of forged headers', async () => {
    const incoming = request();
    const response = await GET(incoming);

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'meta',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['development'],
        // T22 验证修复:路由向身份解析传入按 query rel 归属的 meta scopeCoverage 闭包。
        scopeCoverage: expect.any(Function),
      }),
    );
    expect(mocks.assertRelInPolicyScope).toHaveBeenCalledWith(
      expect.objectContaining({
        rel: 'meta/flow:software-change',
        policyScope: 'development',
        plane: 'meta',
      }),
    );
    expect(mocks.engine.getMetaEntity).toHaveBeenCalledWith('meta/flow:software-change');
    expect(mocks.filterEntityForPolicyScope).toHaveBeenCalledTimes(1);
    expect(response.headers.get('x-ui4a-effective-scope')).toBe('development');
    const options = mocks.resolveTrustedRequestIdentity.mock.calls[0]?.[1] as {
      scopeCoverage?: (policyScope: string) => boolean;
    };
    expect(options.scopeCoverage).toBeInstanceOf(Function);
    expect(options.scopeCoverage?.('development')).toBe(true);
    // meta/flow:software-change 归属 development:闭包以 meta 平面与 query rel 参与判定。
    expect(mocks.relCoveredByPolicyScope).toHaveBeenCalledWith(
      expect.objectContaining({ plane: 'meta' }),
      'meta/flow:software-change',
      'development',
    );
  });
});
