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
    assertReachable: vi.fn(),
    authenticationErrorResponse: vi.fn((error: unknown) => {
      const code = (error as { code?: string }).code;
      return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
    }),
    engine,
    filterEntityForGrantedApplications: vi.fn((projected) => projected),
    getAgentDefinitionMetaEntity: vi.fn(),
    getDb: vi.fn(() => ({ kind: 'mock-db' })),
    getDraftMetaEntity: vi.fn(),
    getEngine: vi.fn(async () => engine),
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
  assertReachable: mocks.assertReachable,
  filterEntityForGrantedApplications: mocks.filterEntityForGrantedApplications,
}));

import { GET } from './route';

const TRUSTED_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'agent' as const,
  principal: 'credential-subject',
  scopes: ['ui4a:read', 'ui4a:policy:development'],
  grantedApplications: ['development'],
  // 显式 ?scope= 导航偏好(D51,可缺省):此处声明以同时验证响应头透传。
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
      expect(mocks.assertReachable).not.toHaveBeenCalled();
      expect(mocks.engine.getMetaEntity).not.toHaveBeenCalled();
      expect(mocks.getDraftMetaEntity).not.toHaveBeenCalled();
      expect(mocks.getAgentDefinitionMetaEntity).not.toHaveBeenCalled();
      expect(mocks.filterEntityForGrantedApplications).not.toHaveBeenCalled();
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
      }),
    );
    expect(mocks.assertReachable).toHaveBeenCalledWith(
      expect.objectContaining({ plane: 'meta' }),
      'meta/flow:software-change',
      ['development'],
    );
    expect(mocks.engine.getMetaEntity).toHaveBeenCalledWith('meta/flow:software-change');
    expect(mocks.filterEntityForGrantedApplications).toHaveBeenCalledTimes(1);
    expect(response.headers.get('x-ui4a-effective-scope')).toBe('development');
    // D51:身份解析不再携带会话级 scope 选择机器(defaultPolicyScope/scopeCoverage
    // 均已退役)。
    const options = mocks.resolveTrustedRequestIdentity.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(options.defaultPolicyScope).toBeUndefined();
    expect(options.scopeCoverage).toBeUndefined();
  });
});
