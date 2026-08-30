import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getAgentDefinitionCatalogForScopes: vi.fn(
    async (_db: unknown, _principal: string, scopes: readonly string[]) =>
      scopes.map((scope) => ({
        name: `${scope}-agent`,
        ref: `${scope}-agent@1`,
      })),
  ),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getMetaSitemap: vi.fn(() => ({
      site: 'meta',
      surfaces: [
        { rel: 'meta/self', title: 'Definition lifecycle' },
        { rel: 'meta/flows', title: 'Flow definitions', collection: true },
        { rel: 'meta/activations', title: 'Activation queue', collection: true },
        { rel: 'meta/applications', title: 'Application definitions', collection: true },
        { rel: 'meta/application:default', title: 'System fallback' },
        { rel: 'meta/application:publishing', title: 'Publishing workspace' },
        { rel: 'meta/application:community', title: 'Community moderation' },
        { rel: 'meta/application:development', title: 'Development workspace' },
        { rel: 'meta/flow:article-drafting', title: 'Article drafting' },
        { rel: 'meta/flow:comment-moderation', title: 'Comment moderation' },
        { rel: 'meta/flow:software-change', title: 'Software change' },
        { rel: 'meta/capabilities', title: 'Capability catalog', collection: true },
        { rel: 'meta/capability:draft', title: 'Draft capability' },
        { rel: 'meta/capability:clarify', title: 'Community clarification capability' },
        { rel: 'meta/capability:coding.execute', title: 'Coding execution capability' },
      ],
    })),
    getSitemap: vi.fn(() => ({
      applications: [
        { name: 'default', flows: [] },
        { name: 'publishing', flows: [{ name: 'article-drafting', app: 'publishing' }] },
        { name: 'community', flows: [{ name: 'comment-moderation', app: 'community' }] },
        { name: 'development', flows: [{ name: 'software-change', app: 'development' }] },
      ],
      flows: [
        { name: 'article-drafting', app: 'publishing' },
        { name: 'comment-moderation', app: 'community' },
        { name: 'software-change', app: 'development' },
      ],
      capabilities: [
        { name: 'draft', scope: { applications: ['publishing'] } },
        { name: 'clarify', scope: { applications: ['community'] } },
        { name: 'coding.execute', scope: { applications: ['development'] } },
      ],
    })),
    getSnapshot: vi.fn(() => ({
      applications: {
        default: { name: 'default' },
        publishing: { name: 'publishing' },
        community: { name: 'community' },
        development: { name: 'development' },
      },
    })),
  })),
  metaContextFromRequest: vi.fn(() => ({
    principal: 'local-user',
    effectiveScope: 'publishing',
    authorizedScopes: ['default', 'publishing', 'community', 'development'],
    authorizationMode: 'self-reported-local-demo',
  })),
  requestIdentityProfile: vi.fn((): 'local' | 'production' => 'production'),
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('../../../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
}));

vi.mock('../../../../../engine/agent/agent-definitions', () => ({
  getAgentDefinitionCatalogForScopes: mocks.getAgentDefinitionCatalogForScopes,
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
  scopes: ['ui4a:read', 'ui4a:policy:publishing'],
  grantedApplications: ['publishing'],
  channel: 'oidc',
  humanApprovalEligible: true,
};

interface MetaSitemapResponse {
  version: string;
  effectiveScope?: string;
  authorizedScopes: string[];
  authorizationMode: string;
  surfaces: Array<{ rel: string; title: string; collection?: boolean }>;
}

const GLOBAL_META_RELS = [
  'meta/self',
  'meta/flows',
  'meta/activations',
  'meta/applications',
  'meta/capabilities',
  'meta/drafts',
  'meta/agent-definitions',
];

function exactRels(body: MetaSitemapResponse, prefix: string): string[] {
  return body.surfaces.map((surface) => surface.rel).filter((rel) => rel.startsWith(prefix));
}

async function credentialSitemap(input: {
  grants: string[];
  scope?: string;
}): Promise<MetaSitemapResponse> {
  mocks.resolveTrustedRequestIdentity.mockImplementationOnce(async (request: Request) => {
    const requestedScope = new URL(request.url).searchParams.get('scope') ?? undefined;
    return {
      ...CREDENTIAL_IDENTITY,
      scopes: ['ui4a:read', ...input.grants.map((application) => `ui4a:policy:${application}`)],
      grantedApplications: input.grants,
      ...(requestedScope === undefined ? {} : { policyScope: requestedScope }),
    };
  });
  const query = input.scope === undefined ? '' : `?scope=${encodeURIComponent(input.scope)}`;
  const response = await GET(
    new Request(`https://ui4a.internal/_meta/.well-known/ui4a.json${query}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as MetaSitemapResponse;
}

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
    expect(mocks.getAgentDefinitionCatalogForScopes).not.toHaveBeenCalled();
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
    expect(body.effectiveScope).toBeUndefined();
    expect(body.authorizedScopes).toEqual(['publishing']);
    expect(body.authorizationMode).toBe('credential');
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'meta',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['default', 'publishing', 'community', 'development'],
      }),
    );
    // D51:身份解析不再携带会话级默认 scope 选择。
    const options = mocks.resolveTrustedRequestIdentity.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(options.defaultPolicyScope).toBeUndefined();
    expect(options.scopeCoverage).toBeUndefined();
    expect(mocks.metaContextFromRequest).not.toHaveBeenCalled();
    // Agent Definition 目录按 granted 并集(authorizedScopes)逐 scope 取,而非冻结在
    // effectiveScope 单 scope 上;多 scope 用户能看到所有已授权应用的 Agent。
    expect(mocks.getAgentDefinitionCatalogForScopes).toHaveBeenCalledWith(
      expect.anything(),
      'human-alice',
      ['publishing'],
    );
  });

  it('discloses only publishing-owned exact definitions plus global-safe catalogs', async () => {
    const body = await credentialSitemap({ grants: ['publishing'] });
    const rels = body.surfaces.map((surface) => surface.rel);

    expect(rels).toEqual(expect.arrayContaining(GLOBAL_META_RELS));
    expect(exactRels(body, 'meta/application:')).toEqual(['meta/application:publishing']);
    expect(exactRels(body, 'meta/flow:')).toEqual(['meta/flow:article-drafting']);
    expect(exactRels(body, 'meta/capability:')).toEqual(['meta/capability:draft']);
    expect(exactRels(body, 'meta/agent-definition:')).toEqual([
      'meta/agent-definition:publishing-agent@1',
    ]);

    const disclosed = JSON.stringify(body);
    expect(disclosed).not.toContain('Community moderation');
    expect(disclosed).not.toContain('Comment moderation');
    expect(disclosed).not.toContain('Community clarification capability');
    expect(disclosed).not.toContain('Development workspace');
    expect(disclosed).not.toContain('Software change');
    expect(disclosed).not.toContain('Coding execution capability');
  });

  it('returns the publishing and community ownership union without leaking development', async () => {
    const publishingOnly = await credentialSitemap({ grants: ['publishing'] });
    const grantedUnion = await credentialSitemap({ grants: ['publishing', 'community'] });

    expect(exactRels(grantedUnion, 'meta/application:')).toEqual([
      'meta/application:publishing',
      'meta/application:community',
    ]);
    expect(exactRels(grantedUnion, 'meta/flow:')).toEqual([
      'meta/flow:article-drafting',
      'meta/flow:comment-moderation',
    ]);
    expect(exactRels(grantedUnion, 'meta/capability:')).toEqual([
      'meta/capability:draft',
      'meta/capability:clarify',
    ]);
    expect(grantedUnion.surfaces.map((surface) => surface.rel)).not.toContain(
      'meta/application:development',
    );
    expect(grantedUnion.version).not.toBe(publishingOnly.version);
  });

  it('uses an explicit scope only as the effective lens without changing union content', async () => {
    const publishingLens = await credentialSitemap({
      grants: ['publishing', 'community'],
      scope: 'publishing',
    });
    const communityLens = await credentialSitemap({
      grants: ['publishing', 'community'],
      scope: 'community',
    });

    expect(publishingLens.effectiveScope).toBe('publishing');
    expect(communityLens.effectiveScope).toBe('community');
    expect(communityLens.authorizedScopes).toEqual(publishingLens.authorizedScopes);
    expect(communityLens.version).toBe(publishingLens.version);
    expect(communityLens.surfaces).toEqual(publishingLens.surfaces);
  });

  it('keeps an absent lens unlocated without changing granted-union discovery', async () => {
    const unlocated = await credentialSitemap({ grants: ['publishing', 'community'] });
    const located = await credentialSitemap({
      grants: ['publishing', 'community'],
      scope: 'publishing',
    });

    expect(unlocated.effectiveScope).toBeUndefined();
    expect(unlocated.authorizedScopes).toEqual(['publishing', 'community']);
    expect(unlocated.version).toBe(located.version);
    expect(unlocated.surfaces).toEqual(located.surfaces);
  });

  it('merges Agent Definition discovery across the same granted union', async () => {
    const body = await credentialSitemap({ grants: ['publishing', 'community'] });

    expect(mocks.getAgentDefinitionCatalogForScopes).toHaveBeenLastCalledWith(
      expect.anything(),
      'human-alice',
      ['publishing', 'community'],
    );
    expect(exactRels(body, 'meta/agent-definition:')).toEqual([
      'meta/agent-definition:publishing-agent@1',
      'meta/agent-definition:community-agent@1',
    ]);
  });

  it('keeps local profile behavior unchanged (self-reported adapter)', async () => {
    mocks.requestIdentityProfile.mockReturnValue('local');

    const incoming = new Request('http://localhost:3100/_meta/.well-known/ui4a.json');
    const response = await GET(incoming);

    expect(response.status).toBe(200);
    const body = (await response.json()) as MetaSitemapResponse;
    expect(body.authorizationMode).toBe('self-reported-local-demo');
    expect(mocks.resolveTrustedRequestIdentity).not.toHaveBeenCalled();
    expect(mocks.metaContextFromRequest).toHaveBeenCalledWith(incoming, [
      'default',
      'publishing',
      'community',
      'development',
    ]);
    expect(exactRels(body, 'meta/application:')).toEqual([
      'meta/application:default',
      'meta/application:publishing',
      'meta/application:community',
      'meta/application:development',
    ]);
  });
});
