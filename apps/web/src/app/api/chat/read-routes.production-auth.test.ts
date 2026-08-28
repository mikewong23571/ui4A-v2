import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getSnapshot: vi.fn(() => ({ applications: { default: {}, publishing: {} } })),
  })),
  listEvents: vi.fn(async () => []),
  requestIdentityProfile: vi.fn((): 'local' | 'production' => 'production'),
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('@ui4a/db/events', () => ({ listEvents: mocks.listEvents }));
vi.mock('../../../engine/service', () => ({ getDb: mocks.getDb, getEngine: mocks.getEngine }));
vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  requestIdentityProfile: mocks.requestIdentityProfile,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { GET as getHistory } from './history/route';
import { GET as getSessions } from './sessions/route';

const identity = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:policy:default'],
  grantedApplications: ['default'],
  channel: 'oidc',
  humanApprovalEligible: true,
};

describe('chat history production authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(identity);
  });

  it.each([
    ['sessions', (request: Request) => getSessions(request)],
    ['history', (request: Request) => getHistory(request)],
  ])('returns 401 before reading %s when the browser credential is missing', async (_name, get) => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );
    const suffix = _name === 'history' ? '?sessionId=session-a' : '';

    const response = await get(new Request(`https://ui4a.internal/api/chat/${_name}${suffix}`));

    expect(response.status).toBe(401);
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it.each([
    ['sessions', (request: Request) => getSessions(request)],
    ['history', (request: Request) => getHistory(request)],
  ])('scopes the %s event read to the credential principal', async (_name, get) => {
    const suffix = _name === 'history' ? '?sessionId=session-a' : '';
    const request = new Request(`https://ui4a.internal/api/chat/${_name}${suffix}`);

    const response = await get(request);

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['default', 'publishing'],
      }),
    );
    expect(mocks.listEvents).toHaveBeenCalledWith(
      expect.anything(),
      0,
      expect.objectContaining({ principal: 'human-alice' }),
    );
  });
});
