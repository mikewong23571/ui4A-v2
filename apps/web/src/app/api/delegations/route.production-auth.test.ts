import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getEntity: vi.fn(async (rel: string) =>
      rel === 'delegations'
        ? { entities: [{ id: 'wf-a' }] }
        : rel === 'delegation:wf-a'
          ? { properties: { status: 'completed' } }
          : undefined,
    ),
    getSnapshot: vi.fn(() => ({ applications: { default: {}, publishing: {} } })),
  })),
  loadDelegationEvents: vi.fn(async () => [{ seq: 1, kind: 'delegation-started' }]),
  projectDelegationDetail: vi.fn(() => ({ id: 'wf-a', status: 'completed' })),
  requestIdentityProfile: vi.fn((): 'local' | 'production' => 'production'),
  resolveTrustedRequestIdentity: vi.fn(),
  toDelegationRow: vi.fn((entity: { id: string }) => ({ id: entity.id })),
}));

vi.mock('../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
}));

vi.mock('../../../delegations/projection', () => ({
  loadDelegationEvents: mocks.loadDelegationEvents,
  projectDelegationDetail: mocks.projectDelegationDetail,
  toDelegationRow: mocks.toDelegationRow,
}));

vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  requestIdentityProfile: mocks.requestIdentityProfile,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

import { GET as listDelegations } from './route';
import { GET as getDelegationDetail } from './[id]/route';

// GET /api/delegations 与 /api/delegations/[id] production 身份接线(T22 验证修复):
// - 无凭证 → 401(不读舰队/详情投影);
// - 合法凭证 → 200(ui4a:read;全局只读投影,无 per-principal 过滤);
// - local profile 行为不变(不做身份解析)。

const CREDENTIAL_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:policy:default'],
  grantedApplications: ['default'],
  channel: 'oidc',
  humanApprovalEligible: true,
};

function detailContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/delegations production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
  });

  it('returns stable 401 for a missing credential without projecting the fleet', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );

    const response = await listDelegations(new Request('https://ui4a.internal/api/delegations'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'credential_missing' } });
    expect(mocks.toDelegationRow).not.toHaveBeenCalled();
  });

  it('resolves a business credential identity and serves the fleet', async () => {
    const incoming = new Request('https://ui4a.internal/api/delegations');
    const response = await listDelegations(incoming);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ delegations: [{ id: 'wf-a' }] });
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['default', 'publishing'],
      }),
    );
  });

  it('keeps local profile behavior unchanged (no identity resolution)', async () => {
    mocks.requestIdentityProfile.mockReturnValue('local');

    const response = await listDelegations(new Request('http://localhost:3100/api/delegations'));

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).not.toHaveBeenCalled();
  });
});

describe('GET /api/delegations/[id] production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
  });

  it('returns stable 401 for a missing credential without reading the detail', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );

    const response = await getDelegationDetail(
      new Request('https://ui4a.internal/api/delegations/wf-a'),
      detailContext('wf-a'),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'credential_missing' } });
    expect(mocks.loadDelegationEvents).not.toHaveBeenCalled();
  });

  it('resolves a business credential identity and serves the detail', async () => {
    const response = await getDelegationDetail(
      new Request('https://ui4a.internal/api/delegations/wf-a'),
      detailContext('wf-a'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 'wf-a', status: 'completed' });
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ plane: 'business', requiredScopes: ['ui4a:read'] }),
    );
  });

  it('keeps local profile behavior unchanged (no identity resolution)', async () => {
    mocks.requestIdentityProfile.mockReturnValue('local');

    const response = await getDelegationDetail(
      new Request('http://localhost:3100/api/delegations/wf-a'),
      detailContext('wf-a'),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).not.toHaveBeenCalled();
  });
});
