import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const entity = {
    class: ['flow-instance'],
    properties: { rel: 'post:first' },
    actions: [],
    links: [],
    'guard-results': [],
  };
  const engine = {
    getEntity: vi.fn(async () => entity),
    getSnapshot: vi.fn(() => ({
      applications: { development: {} },
      instances: {
        'post:first': {
          rel: 'post:first',
          flow: 'software-change',
          node: 'ready',
          fields: {},
        },
      },
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
    assertThreadOwner: vi.fn(),
    authenticationErrorResponse: vi.fn((error: unknown) => {
      const code = (error as { code?: string }).code;
      return code === undefined
        ? undefined
        : Response.json({ error: { code } }, { status: code === 'scope_insufficient' ? 403 : 401 });
    }),
    engine,
    enrichEntityWithAgentRuns: vi.fn(async (_db, projected) => projected),
    filterEntityForGrantedApplications: vi.fn((projected) => projected),
    filterThreadEntityForPrincipal: vi.fn((projected) => projected),
    getDb: vi.fn(() => ({ kind: 'mock-db' })),
    getEngine: vi.fn(async () => engine),
    resolveTrustedRequestIdentity: vi.fn(),
  };
});

vi.mock('../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
  isMetaRel: (rel: string) => rel.startsWith('meta/'),
}));

vi.mock('../../../engine/service-collection-query', () => ({
  // route 的 catch 判 instanceof 用;本套件不触查询拒绝路径,轻量同形类即可。
  CollectionQueryError: class CollectionQueryError extends Error {},
}));

vi.mock('../../../engine/agent/agent-runs', () => ({
  enrichEntityWithAgentRuns: mocks.enrichEntityWithAgentRuns,
  getAgentRunEntity: vi.fn(),
  isAgentRunRel: () => false,
}));

vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

vi.mock('../../../auth/application-scope', () => ({
  assertReachable: mocks.assertReachable,
  assertThreadOwner: mocks.assertThreadOwner,
  filterEntityForGrantedApplications: mocks.filterEntityForGrantedApplications,
  filterThreadEntityForPrincipal: mocks.filterThreadEntityForPrincipal,
}));

import { GET } from './route';

const TRUSTED_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'agent' as const,
  principal: 'credential-subject',
  scopes: ['ui4a:read', 'ui4a:policy:development'],
  // D51:identity 只携带凭证授予集合;不再产出会话冻结的单一 policyScope。
  grantedApplications: ['development'],
  channel: 'oidc',
  humanApprovalEligible: false,
};

function request(rel = 'post:first'): Request {
  return new Request(`https://ui4a.internal/api/entity?rel=${encodeURIComponent(rel)}`, {
    headers: {
      authorization: 'Bearer verified-token',
      'x-ui4a-principal': 'forged-header-root',
      'x-ui4a-policy-scope': 'publishing',
    },
  });
}

describe('GET /api/entity production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(TRUSTED_IDENTITY);
  });

  it.each(['credential_missing', 'credential_expired'])(
    'returns stable 401 for %s without a business read',
    async (code) => {
      mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
        Object.assign(new Error('credential rejected'), { code }),
      );

      const response = await GET(request());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(mocks.assertReachable).not.toHaveBeenCalled();
      expect(mocks.engine.getEntity).not.toHaveBeenCalled();
      expect(mocks.enrichEntityWithAgentRuns).not.toHaveBeenCalled();
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
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['development'],
      }),
    );
    expect(mocks.assertReachable).toHaveBeenCalledWith(
      expect.objectContaining({ plane: 'business' }),
      'post:first',
      ['development'],
    );
    expect(mocks.assertThreadOwner).toHaveBeenCalledWith(
      expect.anything(),
      'post:first',
      'credential-subject',
    );
    // T38:第二参为集合读面查询原始参数;无参读取显式传 undefined(全量承诺)。
    expect(mocks.engine.getEntity).toHaveBeenCalledWith('post:first', undefined);
    expect(mocks.enrichEntityWithAgentRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'credential-subject',
    );
    expect(mocks.filterEntityForGrantedApplications).toHaveBeenCalledTimes(1);
    expect(mocks.filterThreadEntityForPrincipal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'post:first',
      'credential-subject',
    );
    // D51:身份解析不再携带会话级 scope 选择机器(defaultPolicyScope/scopeCoverage
    // 均已退役);路由选项只有平面/范围/授权集。
    const options = mocks.resolveTrustedRequestIdentity.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(options.defaultPolicyScope).toBeUndefined();
    expect(options.scopeCoverage).toBeUndefined();
    expect(options.authorizedPolicyScopes).toEqual(['development']);
  });

  it('authorizes application:<name> from grantedApplications only and returns structured denial', async () => {
    const applicationEntity = {
      class: ['application'],
      properties: {
        rel: 'application:development',
        name: 'development',
        title: 'Software delivery',
        intent: 'Deliver governed software changes',
      },
      actions: [],
      links: [],
      'guard-results': [],
    };
    mocks.engine.getEntity.mockResolvedValueOnce(applicationEntity);
    const browserLens = new Request(
      'https://ui4a.internal/api/entity?rel=application%3Adevelopment&scope=community',
      { headers: { authorization: 'Bearer verified-token' } },
    );

    const granted = await GET(browserLens);

    expect(granted.status).toBe(200);
    expect(mocks.assertReachable).toHaveBeenCalledWith(
      expect.objectContaining({ plane: 'business' }),
      'application:development',
      ['development'],
    );
    expect(mocks.engine.getEntity).toHaveBeenCalledWith('application:development', undefined);

    mocks.assertReachable.mockImplementationOnce(() => {
      throw Object.assign(new Error('scope_insufficient'), { code: 'scope_insufficient' });
    });
    const denied = await GET(browserLens);

    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({ error: { code: 'scope_insufficient' } });
    expect(mocks.engine.getEntity).toHaveBeenCalledTimes(1);
  });

  it('wires trusted-principal filtering for the threads list before credential scope filtering', async () => {
    const threads = {
      class: ['collection', 'threads'],
      properties: { rel: 'threads', count: 2 },
      actions: [],
      links: [],
      'guard-results': [],
      entities: [],
    };
    mocks.engine.getEntity.mockResolvedValueOnce(threads);
    mocks.filterThreadEntityForPrincipal.mockReturnValueOnce({
      ...threads,
      properties: { ...threads.properties, count: 1 },
    });

    const response = await GET(request('threads'));

    expect(response.status).toBe(200);
    expect(mocks.assertThreadOwner).toHaveBeenCalledWith(
      expect.anything(),
      'threads',
      'credential-subject',
    );
    expect(mocks.filterThreadEntityForPrincipal).toHaveBeenCalledWith(
      threads,
      expect.anything(),
      'threads',
      'credential-subject',
    );
    expect(mocks.filterEntityForGrantedApplications).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ count: 1 }) }),
      expect.anything(),
    );
  });
});
