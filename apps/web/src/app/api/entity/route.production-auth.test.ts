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
    assertRelInPolicyScope: vi.fn(),
    authenticationErrorResponse: vi.fn((error: unknown) => {
      const code = (error as { code?: string }).code;
      return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
    }),
    engine,
    enrichEntityWithAgentRuns: vi.fn(async (_db, projected) => projected),
    enrichEntityWithCapabilityRuns: vi.fn(async (_db, projected) => projected),
    filterEntityForPolicyScope: vi.fn((projected) => projected),
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

vi.mock('../../../engine/capability-runs', () => ({
  enrichEntityWithCapabilityRuns: mocks.enrichEntityWithCapabilityRuns,
  getCapabilityRunEntity: vi.fn(),
  isCapabilityRunRel: () => false,
}));

vi.mock('../../../engine/agent-runs', () => ({
  enrichEntityWithAgentRuns: mocks.enrichEntityWithAgentRuns,
  getAgentRunEntity: vi.fn(),
  isAgentRunRel: () => false,
}));

vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

vi.mock('../../../auth/application-scope', () => ({
  assertRelInPolicyScope: mocks.assertRelInPolicyScope,
  filterEntityForPolicyScope: mocks.filterEntityForPolicyScope,
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
  return new Request('https://ui4a.internal/api/entity?rel=post%3Afirst', {
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
      expect(mocks.assertRelInPolicyScope).not.toHaveBeenCalled();
      expect(mocks.engine.getEntity).not.toHaveBeenCalled();
      expect(mocks.enrichEntityWithCapabilityRuns).not.toHaveBeenCalled();
      expect(mocks.enrichEntityWithAgentRuns).not.toHaveBeenCalled();
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
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['development'],
      }),
    );
    expect(mocks.assertRelInPolicyScope).toHaveBeenCalledWith(
      expect.objectContaining({ rel: 'post:first', policyScope: 'development', plane: 'business' }),
    );
    expect(mocks.engine.getEntity).toHaveBeenCalledWith('post:first');
    expect(mocks.enrichEntityWithCapabilityRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'credential-subject',
      'development',
    );
    expect(mocks.filterEntityForPolicyScope).toHaveBeenCalledTimes(1);
  });
});
