import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendPresenceChange: vi.fn(async () => ({ changed: true, seq: 7, presence: {} })),
  ensurePresenceTables: vi.fn(async () => undefined),
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getSnapshot: vi.fn(() => ({ applications: { default: {}, publishing: {} } })),
  })),
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('../../../db/presence', () => ({
  appendPresenceChange: mocks.appendPresenceChange,
  ensurePresenceTables: mocks.ensurePresenceTables,
  PresenceRateLimitError: class PresenceRateLimitError extends Error {},
}));
vi.mock('../../../engine/service', () => ({ getDb: mocks.getDb, getEngine: mocks.getEngine }));
vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { POST } from './route';

const identity = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:write', 'publishing'],
  policyScope: 'publishing',
  channel: 'oidc',
  humanApprovalEligible: true,
};

describe('POST /api/presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(identity);
  });

  it.each([
    ['site', 'meta'],
    ['scope', 'publishing'],
    ['thread', 'thread:one'],
    ['focus', 'post:one'],
  ])('binds %s to the trusted principal with ui4a:write', async (kind, value) => {
    const request = new Request('https://ui4a.internal/api/presence', {
      method: 'POST',
      body: JSON.stringify({ schemaVersion: 1, kind, value }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ plane: 'business', requiredScopes: ['ui4a:write'] }),
    );
    expect(mocks.appendPresenceChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind, value }),
      expect.objectContaining({ principal: 'human-alice', channel: 'oidc' }),
    );
  });

  it('returns stable 401 without touching projection when credentials are missing', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );
    const response = await POST(
      new Request('https://ui4a.internal/api/presence', {
        method: 'POST',
        body: JSON.stringify({ schemaVersion: 1, kind: 'site', value: 'meta' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.appendPresenceChange).not.toHaveBeenCalled();
  });

  // T31 R10(←T29):scope 校验允许集必须与消费方口径一致
  // ([...grantedPolicyScopes(identity.scopes), identity.policyScope],见
  // chat-situation.ts 与 api/entity/route.ts)。credential 身份可能 tokens 里没有
  // 裸 scope/policy 前缀声明、但服务端已把 policyScope 解析为授权值——该值必须放行。
  const scopeChange = (value: string): Request =>
    new Request('https://ui4a.internal/api/presence', {
      method: 'POST',
      body: JSON.stringify({ schemaVersion: 1, kind: 'scope', value }),
    });
  const derivedIdentity = {
    ...identity,
    scopes: ['ui4a:read', 'ui4a:write'],
    policyScope: 'publishing',
  };

  it('accepts a scope change matching the derived policyScope even without policy claims', async () => {
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce(derivedIdentity);
    const response = await POST(scopeChange('publishing'));
    expect(response.status).toBe(200);
    expect(mocks.appendPresenceChange).toHaveBeenCalled();
  });

  it('keeps rejecting a scope outside both the granted claims and the derived policyScope', async () => {
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce(derivedIdentity);
    const response = await POST(scopeChange('governance'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'scope_insufficient' } });
    expect(mocks.appendPresenceChange).not.toHaveBeenCalled();
  });
});
