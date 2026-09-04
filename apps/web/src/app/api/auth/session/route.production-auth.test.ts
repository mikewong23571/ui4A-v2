import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  browserLoginPolicyScopes: vi.fn((): readonly string[] | undefined => undefined),
  engine: {
    getSnapshot: vi.fn((): { applications: Record<string, unknown> } => ({
      applications: { development: {}, governance: {}, todo: {} },
    })),
  },
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => mocks.engine),
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('../../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
}));

vi.mock('../../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

vi.mock('../../../../auth/activation-disclosure', async (importActual) => ({
  ...(await importActual<typeof import('../../../../auth/activation-disclosure')>()),
  browserLoginPolicyScopes: mocks.browserLoginPolicyScopes,
}));

import { GET } from './route';

const CREDENTIAL_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'session-subject',
  scopes: ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
  grantedApplications: ['development'],
  channel: 'oidc',
  humanApprovalEligible: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
});

describe('GET /api/auth/session authorization projection (D70.3)', () => {
  it('projects the credential identity without leaking the installed universe', async () => {
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authorizationMode: 'credential',
      actor: 'human',
      principal: 'session-subject',
      scopes: ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
      grantedApplications: ['development'],
      governanceExpansion: false,
    });
    // 已安装全集(development/governance/todo)不得对非治理主体泄露:
    expect(body.grantedApplications).toEqual(['development']);
    expect(JSON.stringify(body.scopes)).not.toContain('todo');
  });

  it('annotates governance expansion and echoes browser login scopes for holders', async () => {
    mocks.resolveTrustedRequestIdentity.mockResolvedValue({
      ...CREDENTIAL_IDENTITY,
      scopes: [...CREDENTIAL_IDENTITY.scopes, 'ui4a:policy:governance'],
      grantedApplications: ['development', 'governance', 'todo'],
    });
    mocks.browserLoginPolicyScopes.mockReturnValueOnce([
      'openid',
      'ui4a:read',
      'ui4a:write',
      'ui4a:approve',
      'ui4a:policy:governance',
    ]);

    const body = (await (await GET()).json()) as Record<string, unknown>;

    expect(body.governanceExpansion).toBe(true);
    expect(body.grantedApplications).toEqual(['development', 'governance', 'todo']);
    expect(body.browserLoginScopes).toEqual([
      'openid',
      'ui4a:read',
      'ui4a:write',
      'ui4a:approve',
      'ui4a:policy:governance',
    ]);
  });

  it('projects the local self-reported identity without browser login scopes', async () => {
    mocks.resolveTrustedRequestIdentity.mockResolvedValue({
      authorizationMode: 'self-reported-local-demo',
      actor: 'human',
      principal: 'local-user',
      scopes: ['development', 'governance', 'todo'],
      grantedApplications: ['development', 'governance', 'todo'],
      channel: 'http',
      humanApprovalEligible: true,
    });

    const body = (await (await GET()).json()) as Record<string, unknown>;

    expect(body.authorizationMode).toBe('self-reported-local-demo');
    expect(body.governanceExpansion).toBe(false);
    expect('browserLoginScopes' in body).toBe(false);
  });

  it('maps identity failures through the shared authentication error envelope', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('session missing'), { code: 'session_not_found' }),
    );

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'session_not_found' } });
  });
});
