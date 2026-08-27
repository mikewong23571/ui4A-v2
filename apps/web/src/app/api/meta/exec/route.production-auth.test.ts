import type { ExecRequest } from '@ui4a/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const exec = vi.fn(async () => ({
    kind: 'accepted' as const,
    entity: { class: [], properties: { rel: 'meta/flow:software-change' }, actions: [], links: [] },
  }));
  const engine = {
    exec,
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
    assertReachable: vi.fn(),
    authenticationErrorResponse: vi.fn((error: unknown) => {
      const code = (error as { code?: string }).code;
      return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
    }),
    engine,
    exec,
    executeDraftMeta: vi.fn(),
    getDb: vi.fn(() => ({ kind: 'mock-db' })),
    getEngine: vi.fn(async () => engine),
    requireHumanApprovalScope: vi.fn(),
    resolveTrustedRequestIdentity: vi.fn(),
  };
});

vi.mock('../../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
  isMetaRel: (rel: string) => rel.startsWith('meta/'),
}));

vi.mock('../../../../engine/drafts/drafts', () => ({
  executeDraftMeta: mocks.executeDraftMeta,
  isDraftMetaRel: () => false,
}));

vi.mock('../../../../engine/agent/agent-definitions', () => ({
  agentDefinitionDraftRegistryPort: {},
}));

vi.mock('../../../../auth/request-identity', () => ({
  applyTrustedIdentity: mocks.applyTrustedIdentity,
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  requireHumanApprovalScope: mocks.requireHumanApprovalScope,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

vi.mock('../../../../auth/application-scope', () => ({
  assertReachable: mocks.assertReachable,
}));

import { POST } from './route';

const TRUSTED_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'agent' as const,
  principal: 'credential-subject',
  scopes: ['ui4a:write', 'ui4a:policy:development'],
  grantedApplications: ['development'],
  channel: 'oidc',
  humanApprovalEligible: false,
};

function request(): Request {
  return new Request('https://ui4a.internal/_meta/api/exec', {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-token',
      'content-type': 'application/json',
      'x-ui4a-principal': 'forged-header-root',
      'x-ui4a-policy-scope': 'publishing',
    },
    body: JSON.stringify({
      rel: 'meta/flow:software-change',
      action: 'revise',
      params: {},
      actor: 'human',
      principal: 'forged-body-root',
      channel: 'forged-channel',
    }),
  });
}

describe('POST /_meta/api/exec production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(TRUSTED_IDENTITY);
  });

  it.each(['credential_missing', 'credential_expired'])(
    'returns stable 401 for %s without Meta execution side effects',
    async (code) => {
      mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
        Object.assign(new Error('credential rejected'), { code }),
      );

      const response = await POST(request());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(mocks.assertReachable).not.toHaveBeenCalled();
      expect(mocks.applyTrustedIdentity).not.toHaveBeenCalled();
      expect(mocks.exec).not.toHaveBeenCalled();
      expect(mocks.executeDraftMeta).not.toHaveBeenCalled();
    },
  );

  it('overwrites forged body/header identity before scoped Meta execution', async () => {
    const incoming = request();
    const response = await POST(incoming);

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'meta',
        requiredScopes: ['ui4a:write'],
        untrusted: expect.objectContaining({ principal: 'forged-body-root' }),
      }),
    );
    expect(mocks.assertReachable).toHaveBeenCalledWith(
      expect.objectContaining({ plane: 'meta' }),
      'meta/flow:software-change',
      ['development'],
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
    // D51:身份解析不再携带会话级 scope 选择机器(defaultPolicyScope/scopeCoverage
    // 均已退役);Draft 目标槽位由显式 ?scope= 或授予集合首员决定。
    const options = mocks.resolveTrustedRequestIdentity.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(options.defaultPolicyScope).toBeUndefined();
    expect(options.scopeCoverage).toBeUndefined();
  });
});
