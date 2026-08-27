import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const getAgentDefinitionCatalogForScopes = vi.fn(async () => []);
  const getDb = vi.fn(() => ({ kind: 'mock-db' }));
  const engine = {
    getSitemap: vi.fn(() => ({
      version: 'test-version',
      surfaces: [
        { rel: 'overview', title: 'Overview', app: 'default' },
        { rel: 'articles', title: 'Articles', app: 'publishing' },
        { rel: 'comments', title: 'Comments', app: 'community' },
      ],
      flows: [
        {
          name: 'welcome',
          title: 'Welcome',
          app: 'default',
          initial: 'start',
          nodes: [],
          edges: [],
        },
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
        { name: 'default', title: 'Default', intent: 'overview', flows: [] },
        { name: 'publishing', title: 'Publishing', intent: 'publish', flows: [] },
        { name: 'community', title: 'Community', intent: 'moderate', flows: [] },
      ],
      capabilities: [],
    })),
    getSnapshot: vi.fn(() => ({
      applications: { default: {}, publishing: {}, community: {} },
    })),
  };
  const getEngine = vi.fn(async () => engine);
  const resolveTrustedRequestIdentity = vi.fn(async (request: Request) => {
    if (process.env.UI4A_DEPLOYMENT_PROFILE === 'production') {
      if (request.headers.get('authorization') !== 'Bearer valid-agent-token') {
        throw Object.assign(new Error('credential rejected'), { code: 'credential_missing' });
      }
      return CREDENTIAL_IDENTITY;
    }
    return {
      authorizationMode: 'self-reported-local-demo',
      actor: 'human',
      principal: request.headers.get('x-ui4a-principal') ?? 'local-user',
      scopes: ['ui4a:policy:publishing', 'ui4a:policy:community'],
      // D51:本地信任域 = 服务端已安装应用全集;查询/头中的 scope 不再进入授权。
      grantedApplications: ['publishing', 'community'],
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
    getAgentDefinitionCatalogForScopes,
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
  getAgentDefinitionCatalogForScopes: mocks.getAgentDefinitionCatalogForScopes,
}));

vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { GET } from './route';

const originalProfile = process.env.UI4A_DEPLOYMENT_PROFILE;

// 与生产身份解析同形状的 credential 身份;测试里通过 mockResolvedValueOnce 调整
// 授予集合组合,覆盖 D51 的授予并集口径。
const CREDENTIAL_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'agent' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:policy:publishing'],
  grantedApplications: ['publishing'],
  channel: 'oidc',
  humanApprovalEligible: false,
};

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
        authorizedPolicyScopes: ['default', 'publishing', 'community'],
      }),
    );
    expect(mocks.getAgentDefinitionCatalogForScopes).toHaveBeenLastCalledWith(
      expect.anything(),
      'human-alice',
      ['publishing'],
    );
    await expect(authenticated.json()).resolves.toEqual(
      expect.objectContaining({
        version: 'test-version:publishing',
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
    expect(mocks.getAgentDefinitionCatalogForScopes).toHaveBeenLastCalledWith(
      expect.anything(),
      'local-alice',
      ['publishing', 'community'],
    );
    await expect(local.json()).resolves.toEqual(
      expect.objectContaining({
        // 本地信任域返回全量 sitemap(全部已安装应用;fixture 含 default/publishing/community)。
        surfaces: [
          expect.objectContaining({ rel: 'overview' }),
          expect.objectContaining({ rel: 'articles' }),
          expect.objectContaining({ rel: 'comments' }),
        ],
      }),
    );
  });

  it('multi-scope credential: discovery document is the granted union, not one frozen scope', async () => {
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce({
      ...CREDENTIAL_IDENTITY,
      scopes: ['ui4a:read', 'ui4a:policy:publishing', 'ui4a:policy:community'],
      grantedApplications: ['publishing', 'community'],
    });

    const response = await GET(
      new Request('https://ui4a.mothership.internal/.well-known/ui4a.json', {
        headers: { authorization: 'Bearer valid-agent-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAgentDefinitionCatalogForScopes).toHaveBeenLastCalledWith(
      expect.anything(),
      'human-alice',
      ['publishing', 'community'],
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        // 并集顺序 = granted 顺序逐 scope 拼接后去重;两应用的 rel 都在。
        version: 'test-version:publishing+community',
        surfaces: [
          expect.objectContaining({ rel: 'articles' }),
          expect.objectContaining({ rel: 'comments' }),
        ],
        flows: [
          expect.objectContaining({ name: 'article-drafting' }),
          expect.objectContaining({ name: 'comment-moderation' }),
        ],
        applications: [
          expect.objectContaining({ name: 'publishing' }),
          expect.objectContaining({ name: 'community' }),
        ],
      }),
    );
  });

  // (D51-宽合同)CLI 三纪律锚:HTTP 发现文档恒按授予并集返回,不随 lens/处境
  // 窄化——"看不到"只发生在 prompt 披露层(对照锚:chat-situation.test.ts
  // '(D51-窄披露)')。本用例用 grantedApplications=['default','publishing'] 的
  // 身份显式锁定:两个已授予应用的 flows/surfaces 都在,未授予的 community 不在。
  it('(D51-宽合同) granted=[default,publishing] 身份返回两应用的 flows/surfaces 并集', async () => {
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce({
      ...CREDENTIAL_IDENTITY,
      scopes: ['ui4a:read', 'ui4a:policy:default', 'ui4a:policy:publishing'],
      grantedApplications: ['default', 'publishing'],
    });

    const response = await GET(
      new Request('https://ui4a.mothership.internal/.well-known/ui4a.json', {
        headers: { authorization: 'Bearer valid-agent-token' },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      version: string;
      surfaces: { rel: string }[];
      flows: { name: string }[];
      applications: { name: string }[];
    };
    expect(body.version).toBe('test-version:default+publishing');
    // surfaces/flows/applications 均为两应用并集(顺序 = granted 顺序)。
    expect(body.surfaces.map(({ rel }) => rel)).toEqual(['overview', 'articles']);
    expect(body.flows.map(({ name }) => name)).toEqual(['welcome', 'article-drafting']);
    expect(body.applications.map(({ name }) => name)).toEqual(['default', 'publishing']);
    // 并集边界:未授予的 community 不进发现文档。
    expect(body.surfaces.map(({ rel }) => rel)).not.toContain('comments');
    expect(body.flows.map(({ name }) => name)).not.toContain('comment-moderation');
  });

  it('union order follows granted claim order deterministically', async () => {
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce({
      ...CREDENTIAL_IDENTITY,
      scopes: ['ui4a:read', 'ui4a:policy:community', 'ui4a:policy:publishing'],
      grantedApplications: ['community', 'publishing'],
    });

    const response = await GET(
      new Request('https://ui4a.mothership.internal/.well-known/ui4a.json', {
        headers: { authorization: 'Bearer valid-agent-token' },
      }),
    );

    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ version: 'test-version:community+publishing' }),
    );
  });

  it('ignores granted claims outside the engine-known applications', async () => {
    process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce({
      ...CREDENTIAL_IDENTITY,
      scopes: ['ui4a:read', 'ui4a:policy:publishing'],
      grantedApplications: ['publishing', 'unknown-app'],
    });

    await GET(
      new Request('https://ui4a.mothership.internal/.well-known/ui4a.json', {
        headers: { authorization: 'Bearer valid-agent-token' },
      }),
    );

    expect(mocks.getAgentDefinitionCatalogForScopes).toHaveBeenLastCalledWith(
      expect.anything(),
      'human-alice',
      ['publishing'],
    );
  });
});
