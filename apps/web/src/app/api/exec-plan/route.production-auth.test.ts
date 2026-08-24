import type { ExecRequest } from '@ui4a/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const execPlan = vi.fn();
  const engine = {
    execPlan,
    getSnapshot: vi.fn(() => ({
      applications: { development: {}, publishing: {} },
      instances: {
        'comment:c1': { rel: 'comment:c1', flow: 'software-change', node: 'ready', fields: {} },
        'post:first': { rel: 'post:first', flow: 'software-change', node: 'ready', fields: {} },
        'post:publishing': {
          rel: 'post:publishing',
          flow: 'post-status',
          node: 'published',
          fields: {},
        },
      },
      definitions: {
        'software-change': {
          name: 'software-change',
          version: 1,
          status: 'active',
          definition: { name: 'software-change', app: 'development' },
        },
        'post-status': {
          name: 'post-status',
          version: 1,
          status: 'active',
          definition: { name: 'post-status', app: 'publishing' },
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
  const getDb = vi.fn(() => ({ kind: 'mock-db' }));
  const getEngine = vi.fn(async () => engine);
  const resolveTrustedRequestIdentity = vi.fn();
  const applyTrustedIdentity = vi.fn(
    (request: ExecRequest, identity: Record<string, unknown>): ExecRequest => ({
      ...request,
      actor: identity.actor as 'human' | 'agent',
      principal: identity.principal as string,
      channel: identity.channel as string,
      identity: {
        authorizationMode: identity.authorizationMode as 'credential',
        scopes: identity.scopes as string[],
        humanApprovalEligible: identity.humanApprovalEligible as boolean,
        delegation: identity.delegation as {
          subject: string;
          actorClientId: string;
          source: 'token-exchange-sub-azp';
        },
      },
    }),
  );
  const authenticationErrorResponse = vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined
      ? undefined
      : Response.json({ error: { code } }, { status: code === 'scope_insufficient' ? 403 : 401 });
  });
  return {
    applyTrustedIdentity,
    authenticationErrorResponse,
    engine,
    execPlan,
    getDb,
    getEngine,
    resolveTrustedRequestIdentity,
  };
});

vi.mock('../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
  isMetaRel: (rel: string) => rel.startsWith('meta/'),
}));

vi.mock('../../../auth/request-identity', () => ({
  applyTrustedIdentity: mocks.applyTrustedIdentity,
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { POST } from './route';

const AGENT_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'agent' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:write', 'development'],
  policyScope: 'development',
  channel: 'oidc',
  humanApprovalEligible: false,
  delegation: {
    subject: 'human-alice',
    actorClientId: 'ui4a-agent',
    source: 'token-exchange-sub-azp' as const,
  },
};

function request(body: unknown): Request {
  return new Request('https://ui4a.internal/api/exec-plan', {
    method: 'POST',
    headers: {
      authorization: 'Bearer delegated-agent-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function expectedTrustedStep(rel: string, action: string): ExecRequest {
  return {
    rel,
    action,
    params: {},
    actor: 'agent',
    principal: 'human-alice',
    channel: 'oidc',
    identity: {
      authorizationMode: 'credential',
      scopes: ['ui4a:read', 'ui4a:write', 'development'],
      humanApprovalEligible: false,
      delegation: AGENT_IDENTITY.delegation,
    },
  };
}

describe('POST /api/exec-plan production trusted identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(AGENT_IDENTITY);
    mocks.execPlan.mockResolvedValue({
      kind: 'plan-completed',
      results: [],
      entities: [],
    });
  });

  it('resolves one Bearer identity and applies it to every identity-free plan step', async () => {
    const response = await POST(
      request({
        steps: [
          { rel: 'comment:c1', action: 'approve', params: {} },
          { rel: 'post:first', action: 'unpublish', params: {} },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        plane: 'business',
        requiredScopes: ['ui4a:write'],
        authorizedPolicyScopes: ['development', 'publishing'],
        defaultPolicyScope: 'development',
      }),
    );
    expect(mocks.applyTrustedIdentity).toHaveBeenCalledTimes(2);
    expect(mocks.execPlan).toHaveBeenCalledWith([
      expectedTrustedStep('comment:c1', 'approve'),
      expectedTrustedStep('post:first', 'unpublish'),
    ]);
  });

  it('overwrites forged plan-level and step-level actor/principal/channel values', async () => {
    const response = await POST(
      request({
        actor: 'human',
        principal: 'root-admin',
        channel: 'forged-plan',
        steps: [
          {
            rel: 'post:first',
            action: 'unpublish',
            params: {},
            actor: 'human',
            principal: 'step-root',
            channel: 'forged-step',
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.applyTrustedIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'human',
        principal: 'step-root',
        channel: 'forged-step',
      }),
      AGENT_IDENTITY,
    );
    expect(mocks.execPlan).toHaveBeenCalledWith([expectedTrustedStep('post:first', 'unpublish')]);
  });

  it('returns a stable 401 authentication error and never executes the plan', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('do not expose the token'), { code: 'credential_missing' }),
    );

    const response = await POST(
      request({ steps: [{ rel: 'post:first', action: 'unpublish', params: {} }] }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'credential_missing' } });
    expect(mocks.authenticationErrorResponse).toHaveBeenCalledTimes(1);
    expect(mocks.applyTrustedIdentity).not.toHaveBeenCalled();
    expect(mocks.execPlan).not.toHaveBeenCalled();
  });

  it('rejects a plan step owned by another application before executing any step', async () => {
    const response = await POST(
      request({
        steps: [
          { rel: 'comment:c1', action: 'approve', params: {} },
          { rel: 'post:publishing', action: 'archive', params: {} },
        ],
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'scope_insufficient' } });
    expect(mocks.applyTrustedIdentity).not.toHaveBeenCalled();
    expect(mocks.execPlan).not.toHaveBeenCalled();
  });
});
