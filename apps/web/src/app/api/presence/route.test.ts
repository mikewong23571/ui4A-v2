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

vi.mock('@ui4a/db/presence', () => ({
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
  grantedApplications: ['publishing'],
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

  // T31 R10(←T29)在 D51 口径下的重述:presence scope 变更的允许集 =
  // 凭证授予集合(grantedApplications);显式导航偏好(policyScope)不再
  // 参与任何判定,更不能放宽越界值。
  const scopeChange = (value: string): Request =>
    new Request('https://ui4a.internal/api/presence', {
      method: 'POST',
      body: JSON.stringify({ schemaVersion: 1, kind: 'scope', value }),
    });

  it('rejects a scope outside the credential grant envelope', async () => {
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce(identity);
    const response = await POST(scopeChange('governance'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'scope_insufficient' } });
    expect(mocks.appendPresenceChange).not.toHaveBeenCalled();
  });

  it('never lets the navigation-preference scope widen the accepted set', async () => {
    mocks.resolveTrustedRequestIdentity.mockResolvedValueOnce({
      ...identity,
      policyScope: 'governance',
    });
    const response = await POST(scopeChange('governance'));
    expect(response.status).toBe(403);
    expect(mocks.appendPresenceChange).not.toHaveBeenCalled();
  });
});
