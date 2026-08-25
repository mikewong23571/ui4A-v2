import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const getAgentDefinitionCatalog = vi.fn(async () => []);
  const getDb = vi.fn(() => ({ kind: 'mock-db' }));
  const engine = {
    getSitemap: vi.fn(() => ({
      version: 'test-version',
      surfaces: [
        { rel: 'articles', title: 'Articles', app: 'publishing' },
        { rel: 'comments', title: 'Comments', app: 'community' },
      ],
      flows: [
        {
          name: 'article-drafting',
          title: 'Articles',
          app: 'publishing',
          initial: 'draft',
          nodes: [],
          edges: [],
        },
        {
          name: 'comment-moderation',
          title: 'Comments',
          app: 'community',
          initial: 'pending',
          nodes: [],
          edges: [],
        },
      ],
      applications: [
        { name: 'publishing', title: 'Publishing', intent: 'publish', flows: [] },
        { name: 'community', title: 'Community', intent: 'moderate', flows: [] },
      ],
      capabilities: [],
    })),
    getSnapshot: vi.fn(() => ({ applications: { publishing: {}, community: {} } })),
  };
  const getEngine = vi.fn(async () => engine);
  const resolveTrustedRequestIdentity = vi.fn(async (request: Request) => {
    if (process.env.UI4A_DEPLOYMENT_PROFILE === 'production') {
      if (request.headers.get('authorization') !== 'Bearer valid-agent-token') {
        throw Object.assign(new Error('credential rejected'), { code: 'credential_missing' });
      }
      return {
        authorizationMode: 'credential',
        actor: 'agent',
        principal: 'human-alice',
        scopes: ['ui4a:read', 'publishing'],
        policyScope: 'publishing',
        channel: 'oidc',
        humanApprovalEligible: false,
      };
    }
    return {
      authorizationMode: 'self-reported-local-demo',
      actor: 'human',
      principal: request.headers.get('x-ui4a-principal') ?? 'local-user',
      scopes: ['publishing', 'community'],
      policyScope: request.headers.get('x-ui4a-policy-scope') ?? 'publishing',
      channel: 'http',
      humanApprovalEligible: true,
    };
  });
  const authenticationErrorResponse = vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  });
  return {
    authenticationErrorResponse,
    engine,
    getAgentDefinitionCatalog,
    getDb,
    getEngine,
    resolveTrustedRequestIdentity,
  };
});

vi.mock('../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
}));

vi.mock('../../../engine/agent/agent-definitions', () => ({
  getAgentDefinitionCatalog: mocks.getAgentDefinitionCatalog,
}));

vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { GET } from './route';

const originalProfile = process.env.UI4A_DEPLOYMENT_PROFILE;

afterEach(() => {
  vi.clearAllMocks();
  if (originalProfile === undefined) delete process.env.UI4A_DEPLOYMENT_PROFILE;
  else process.env.UI4A_DEPLOYMENT_PROFILE = originalProfile;
});

describe('GET /.well-known/ui4a.json trusted entry', () => {
  it('requires production read identity, ignores forged headers, and preserves local demo access', async () => {
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    const missing = await GET(
      new Request('https://ui4a.mothership.internal/.well-known/ui4a.json'),
    );
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: { code: 'credential_missing' } });

    const authenticated = await GET(
      new Request('https://ui4a.mothership.internal/.well-known/ui4a.json', {
        headers: {
          authorization: 'Bearer valid-agent-token',
          'x-ui4a-principal': 'forged-root',
          'x-ui4a-policy-scope': 'community',
        },
      }),
    );
    expect(authenticated.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenLastCalledWith(
      expect.any(Request),
      expect.objectContaining({
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['publishing', 'community'],
        defaultPolicyScope: 'publishing',
      }),
    );
    expect(mocks.getAgentDefinitionCatalog).toHaveBeenLastCalledWith(
      expect.anything(),
      'human-alice',
      'publishing',
    );
    await expect(authenticated.json()).resolves.toEqual(
      expect.objectContaining({
        surfaces: [expect.objectContaining({ rel: 'articles' })],
        flows: [expect.objectContaining({ name: 'article-drafting' })],
        applications: [expect.objectContaining({ name: 'publishing' })],
      }),
    );

    delete process.env.UI4A_DEPLOYMENT_PROFILE;
    const local = await GET(
      new Request('http://localhost:3100/.well-known/ui4a.json', {
        headers: {
          'x-ui4a-principal': 'local-alice',
          'x-ui4a-policy-scope': 'community',
        },
      }),
    );
    expect(local.status).toBe(200);
    expect(mocks.getAgentDefinitionCatalog).toHaveBeenLastCalledWith(
      expect.anything(),
      'local-alice',
      'community',
    );
    await expect(local.json()).resolves.toEqual(
      expect.objectContaining({
        surfaces: [
          expect.objectContaining({ rel: 'articles' }),
          expect.objectContaining({ rel: 'comments' }),
        ],
      }),
    );
  });
});
