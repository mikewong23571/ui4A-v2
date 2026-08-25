import type { ExecRequest } from '@ui4a/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const exec = vi.fn(async () => ({
    kind: 'accepted' as const,
    entity: { class: [], properties: { rel: 'post:first' }, actions: [], links: [] },
  }));
  const engine = {
    exec,
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
  const applyTrustedIdentity = vi.fn(
    (request: ExecRequest, identity: Record<string, unknown>): ExecRequest => ({
      ...request,
      actor: identity.actor as 'human' | 'agent',
      principal: identity.principal as string,
      channel: identity.channel as string,
    }),
  );
  return {
    applyTrustedIdentity,
    assertRelInPolicyScope: vi.fn(),
    authenticationErrorResponse: vi.fn((error: unknown) => {
      const code = (error as { code?: string }).code;
      return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
    }),
    engine,
    exec,
    executeAgentRunAction: vi.fn(),
    getDb: vi.fn(() => ({ kind: 'mock-db' })),
    getEngine: vi.fn(async () => engine),
    relCoveredByPolicyScope: vi.fn(() => true),
    requireHumanApprovalScope: vi.fn(),
    resolveTrustedRequestIdentity: vi.fn(),
  };
});

vi.mock('../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
  isMetaRel: (rel: string) => rel.startsWith('meta/'),
  LlmArtifactConfigurationError: class LlmArtifactConfigurationError extends Error {},
}));

vi.mock('../../../engine/agent-runs', () => ({
  executeAgentRunAction: mocks.executeAgentRunAction,
  isAgentRunRel: () => false,
}));

vi.mock('../../../auth/request-identity', () => ({
  applyTrustedIdentity: mocks.applyTrustedIdentity,
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  requireHumanApprovalScope: mocks.requireHumanApprovalScope,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

vi.mock('../../../auth/application-scope', () => ({
  assertRelInPolicyScope: mocks.assertRelInPolicyScope,
  relCoveredByPolicyScope: mocks.relCoveredByPolicyScope,
}));

import { POST } from './route';

const TRUSTED_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'agent' as const,
  principal: 'credential-subject',
  scopes: ['ui4a:write', 'ui4a:policy:development'],
  policyScope: 'development',
  channel: 'oidc',
  humanApprovalEligible: false,
};

function request(): Request {
  return new Request('https://ui4a.internal/api/exec', {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-token',
      'content-type': 'application/json',
      'x-ui4a-principal': 'forged-header-root',
      'x-ui4a-policy-scope': 'publishing',
    },
    body: JSON.stringify({
      rel: 'post:first',
      action: 'archive',
      params: {},
      actor: 'human',
      principal: 'forged-body-root',
      channel: 'forged-channel',
    }),
  });
}

describe('POST /api/exec production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(TRUSTED_IDENTITY);
  });

  it.each(['credential_missing', 'credential_expired'])(
    'returns stable 401 for %s without execution side effects',
    async (code) => {
      mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
        Object.assign(new Error('credential rejected'), { code }),
      );

      const response = await POST(request());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(mocks.assertRelInPolicyScope).not.toHaveBeenCalled();
      expect(mocks.applyTrustedIdentity).not.toHaveBeenCalled();
      expect(mocks.exec).not.toHaveBeenCalled();
      expect(mocks.executeAgentRunAction).not.toHaveBeenCalled();
    },
  );

  it('overwrites forged body/header identity before scoped execution', async () => {
    const incoming = request();
    const response = await POST(incoming);

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'business',
        requiredScopes: ['ui4a:write'],
        untrusted: expect.objectContaining({ principal: 'forged-body-root' }),
      }),
    );
    expect(mocks.assertRelInPolicyScope).toHaveBeenCalledWith(
      expect.objectContaining({ rel: 'post:first', policyScope: 'development', plane: 'business' }),
    );
    expect(mocks.applyTrustedIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'human',
        principal: 'forged-body-root',
        channel: 'forged-channel',
      }),
      TRUSTED_IDENTITY,
    );
    expect(mocks.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'agent',
        principal: 'credential-subject',
        channel: 'oidc',
      }),
    );
    // T22 验证修复:路由向 identity 解析传入按 body rel 归属的 scopeCoverage 闭包。
    const options = mocks.resolveTrustedRequestIdentity.mock.calls[0]?.[1] as {
      scopeCoverage?: (policyScope: string) => boolean;
    };
    expect(options.scopeCoverage).toBeInstanceOf(Function);
    expect(options.scopeCoverage?.('development')).toBe(true);
    expect(mocks.relCoveredByPolicyScope).toHaveBeenCalledWith(
      expect.objectContaining({ plane: 'business' }),
      'post:first',
      'development',
    );
  });
});
