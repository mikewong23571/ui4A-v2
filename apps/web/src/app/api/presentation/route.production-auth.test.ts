import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(async () => undefined),
  appendSidecarCommand: vi.fn(async () => ({
    aggregate: {
      id: 'sidecar:1',
      activeVersion: 2,
      versions: { 2: { retention: 'pinned' } },
    },
  })),
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getSnapshot: vi.fn(() => ({
      applications: { default: {}, publishing: {} },
      instances: { 'post:first': { flow: 'post-flow' } },
      definitions: { 'post-flow': { version: 1, definition: { app: 'publishing' } } },
    })),
    getSitemap: vi.fn(() => ({
      version: 'test-sitemap',
      surfaces: [],
      flows: [],
      applications: [],
      capabilities: [],
    })),
  })),
  getPresentationBroker: vi.fn(() => ({
    present: mocks.present,
  })),
  getSidecarById: vi.fn(async () => ({
    id: 'sidecar:1',
    activeVersion: 1,
    key: {
      principal: 'human-alice',
      subject: 'post:first',
      intent: 'read',
      deviceClass: 'any',
    },
    versions: {
      1: {
        surface: {
          schemaVersion: 1,
          root: {
            kind: 'layout',
            id: 'root',
            role: 'primary-content',
            layout: 'stack',
            dependencies: [],
            provenance: [],
            children: [
              {
                kind: 'slot',
                id: 'subject-region',
                role: 'primary-content',
                name: 'subject',
                dependencies: [],
                provenance: [],
                child: {
                  kind: 'diagnostic',
                  id: 'subject-diagnostic',
                  role: 'diagnostic',
                  code: 'fixture',
                  dependencies: [],
                  provenance: [],
                },
              },
            ],
          },
        },
        dependencies: [],
        retention: 'cache',
      },
    },
  })),
  loadPresentationSnapshot: vi.fn(async () => ({ sidecars: {} })),
  present: vi.fn(async () => ({ status: 'ready', sidecar: { id: 'sidecar:1', version: 1 } })),
  requestIdentityProfile: vi.fn((): 'local' | 'production' => 'production'),
  resolveTrustedRequestIdentity: vi.fn(),
}));

vi.mock('../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
}));

vi.mock('../../../engine/presentation/runtime', () => ({
  getPresentationBroker: mocks.getPresentationBroker,
}));

vi.mock('@ui4a/db/presentation', () => ({
  appendSidecarCommand: mocks.appendSidecarCommand,
  getSidecarById: mocks.getSidecarById,
  loadPresentationSnapshot: mocks.loadPresentationSnapshot,
}));

vi.mock('@ui4a/db/events', () => ({
  appendEvent: mocks.appendEvent,
}));

vi.mock('../../../auth/request-identity', () => ({
  authenticationErrorResponse: mocks.authenticationErrorResponse,
  requestIdentityProfile: mocks.requestIdentityProfile,
  resolveTrustedRequestIdentity: mocks.resolveTrustedRequestIdentity,
}));

vi.mock('../../../engine/presentation/sidecar-authorization', () => ({
  // B3 决策化返回:{ ok: true } 允许放行;deny 形状由 db 级 production-auth 锚覆盖。
  authorizeStoredSidecar: vi.fn(async () => ({ ok: true as const })),
  hasUnavailableRegion: vi.fn(() => false),
}));

import { POST as present } from './route';
import { GET as getSidecar, POST as sidecarLifecycle } from './sidecar/route';

// POST /api/presentation 与 /api/presentation/sidecar production 身份接线(T22 验证修复):
// - 无凭证 → 401(不触达 Broker/Sidecar 投影);
// - 合法凭证 → 已认证 principal 覆盖客户端自报 principal 作为 durable Sidecar 归属;
// - GET 需 ui4a:read,POST lifecycle 需 ui4a:write;
// - local profile 行为不变(固定 user:local,不做身份解析)。

const CREDENTIAL_IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'human-alice',
  scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:default'],
  grantedApplications: ['default'],
  channel: 'oidc',
  humanApprovalEligible: true,
};

function presentationBody() {
  return {
    schemaVersion: 1,
    requestId: 'direct:prod',
    principal: 'local-user',
    subject: 'post:first',
    intent: 'read',
    delivery: 'canvas',
    sourceMessageIds: [],
  };
}

describe('POST /api/presentation production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
  });

  it('returns stable 401 for a missing credential without reaching the Broker', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );

    const response = await present(
      new Request('https://ui4a.internal/api/presentation', {
        method: 'POST',
        body: JSON.stringify(presentationBody()),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'credential_missing' } });
    expect(mocks.present).not.toHaveBeenCalled();
  });

  it('overrides the self-reported principal with the credential principal', async () => {
    const incoming = new Request('https://ui4a.internal/api/presentation', {
      method: 'POST',
      body: JSON.stringify(presentationBody()),
    });
    const response = await present(incoming);

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      incoming,
      expect.objectContaining({
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: ['default', 'publishing'],
      }),
    );
    // D51:授予集合随上下文下传 Broker,目标 rel 的授权在咽喉点按集合判定;
    // 身份解析不再携带会话级 scope 选择机器。
    const options = mocks.resolveTrustedRequestIdentity.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(options.defaultPolicyScope).toBeUndefined();
    expect(options.scopeCoverage).toBeUndefined();
    expect(mocks.present).toHaveBeenCalledWith(
      expect.objectContaining({ principal: 'human-alice' }),
      { grantedApplications: ['default'] },
    );
  });

  it('keeps local profile behavior unchanged (self-reported principal)', async () => {
    mocks.requestIdentityProfile.mockReturnValue('local');

    const response = await present(
      new Request('http://localhost:3100/api/presentation', {
        method: 'POST',
        body: JSON.stringify(presentationBody()),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).not.toHaveBeenCalled();
    expect(mocks.present).toHaveBeenCalledWith(
      expect.objectContaining({ principal: 'local-user' }),
    );
  });
});

describe('GET /api/presentation/sidecar production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
  });

  it('returns stable 401 for a missing credential without reading the Sidecar', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );

    const response = await getSidecar(
      new Request('https://ui4a.internal/api/presentation/sidecar?sidecarId=sidecar%3A1'),
    );

    expect(response.status).toBe(401);
    expect(mocks.getSidecarById).not.toHaveBeenCalled();
  });

  it('reads the Sidecar under the credential principal with ui4a:read', async () => {
    const response = await getSidecar(
      new Request('https://ui4a.internal/api/presentation/sidecar?sidecarId=sidecar%3A1'),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ plane: 'business', requiredScopes: ['ui4a:read'] }),
    );
    expect(mocks.getSidecarById).toHaveBeenCalledWith(
      expect.anything(),
      'sidecar:1',
      'human-alice',
    );
  });

  it('keeps local profile behavior unchanged (fixed local principal)', async () => {
    mocks.requestIdentityProfile.mockReturnValue('local');

    const response = await getSidecar(
      new Request('http://localhost:3100/api/presentation/sidecar?sidecarId=sidecar%3A1'),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).not.toHaveBeenCalled();
    expect(mocks.getSidecarById).toHaveBeenCalledWith(expect.anything(), 'sidecar:1', 'local-user');
  });
});

describe('POST /api/presentation/sidecar production authentication wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestIdentityProfile.mockReturnValue('production');
    mocks.resolveTrustedRequestIdentity.mockResolvedValue(CREDENTIAL_IDENTITY);
  });

  it('requires ui4a:write and mutates under the credential principal', async () => {
    const response = await sidecarLifecycle(
      new Request('https://ui4a.internal/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({ sidecarId: 'sidecar:1', action: 'pin', actor: 'human' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveTrustedRequestIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ plane: 'business', requiredScopes: ['ui4a:write'] }),
    );
    expect(mocks.getSidecarById).toHaveBeenCalledWith(
      expect.anything(),
      'sidecar:1',
      'human-alice',
    );
    expect(mocks.appendSidecarCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'pin', sidecarId: 'sidecar:1' }),
    );
  });

  it('returns stable 401 for a missing credential without mutating', async () => {
    mocks.resolveTrustedRequestIdentity.mockRejectedValueOnce(
      Object.assign(new Error('no credential'), { code: 'credential_missing' }),
    );

    const response = await sidecarLifecycle(
      new Request('https://ui4a.internal/api/presentation/sidecar', {
        method: 'POST',
        body: JSON.stringify({ sidecarId: 'sidecar:1', action: 'pin', actor: 'human' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.appendSidecarCommand).not.toHaveBeenCalled();
  });
});
