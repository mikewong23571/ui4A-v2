import { beforeEach, describe, expect, it, vi } from 'vitest';

type DraftOutcome =
  | {
      kind: 'accepted';
      entity: {
        class: string[];
        properties: Record<string, unknown>;
        actions: never[];
        links: never[];
      };
    }
  | { kind: 'rejected'; layer: string; reason: string };

const mocks = vi.hoisted(() => {
  // exec 前已装 development;approve 激活后 snapshot 生长出 todo(引擎内已重读)。
  const applicationsBefore: Record<string, unknown> = { development: {} };
  const applicationsAfter: Record<string, unknown> = { ...applicationsBefore, todo: {} };
  const exec = vi.fn(async () => ({
    kind: 'accepted' as const,
    entity: { class: ['draft'], properties: { rel: 'meta/draft:draft-1' }, actions: [], links: [] },
  }));
  const engine = {
    exec,
    getSnapshot: vi.fn((): { applications: Record<string, unknown> } => ({
      applications: applicationsAfter,
    })),
    getSitemap: vi.fn(() => ({
      version: 'test',
      surfaces: [],
      flows: [],
      applications: [],
      capabilities: [],
    })),
  };
  return {
    applyTrustedIdentity: vi.fn((request: Record<string, unknown>) => request),
    assertReachable: vi.fn(),
    authenticationErrorResponse: vi.fn(),
    browserLoginPolicyScopes: vi.fn<() => readonly string[] | undefined>(() => undefined),
    engine,
    exec,
    executeDraftMeta: vi.fn(async (): Promise<DraftOutcome> => ({
      kind: 'accepted',
      entity: {
        class: ['draft'],
        properties: { rel: 'meta/draft:draft-1' },
        actions: [],
        links: [],
      },
    })),
    getDb: vi.fn(() => ({ kind: 'mock-db' })),
    getEngine: vi.fn(async () => engine),
    requireHumanApprovalScope: vi.fn(),
    resolveTrustedRequestIdentity: vi.fn(),
    applicationsBefore,
  };
});

vi.mock('../../../../engine/service', () => ({
  getDb: mocks.getDb,
  getEngine: mocks.getEngine,
  isMetaRel: (rel: string) => rel.startsWith('meta/'),
}));

vi.mock('../../../../engine/drafts/drafts', () => ({
  executeDraftMeta: mocks.executeDraftMeta,
  isDraftMetaRel: (rel: string) => rel.startsWith('meta/draft:'),
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

vi.mock('../../../../auth/activation-disclosure', async (importActual) => ({
  // 披露推导用真实实现(纯函数已有独立单测);仅 profile 探测注入测试值。
  ...(await importActual<typeof import('../../../../auth/activation-disclosure')>()),
  browserLoginPolicyScopes: mocks.browserLoginPolicyScopes,
}));

import { POST } from './route';

const IDENTITY = {
  authorizationMode: 'credential' as const,
  actor: 'human' as const,
  principal: 'approver-subject',
  scopes: ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
  grantedApplications: ['development'],
  policyScope: 'development',
  channel: 'oidc',
  humanApprovalEligible: true,
};

function approveRequest(): Request {
  return new Request('https://ui4a.internal/_meta/api/exec?scope=development', {
    method: 'POST',
    headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
    body: JSON.stringify({ rel: 'meta/draft:draft-1', action: 'approve' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.engine.getSnapshot.mockReturnValue({ applications: { ...mocks.applicationsBefore } });
  mocks.resolveTrustedRequestIdentity.mockResolvedValue(IDENTITY);
});

describe('POST /_meta/api/exec activation disclosure wiring (D70.1)', () => {
  it('marks a new application visible to a governance-expanded approver immediately', async () => {
    mocks.engine.getSnapshot
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore } })
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore, todo: {} } });
    mocks.resolveTrustedRequestIdentity.mockResolvedValue({
      ...IDENTITY,
      scopes: [...IDENTITY.scopes, 'ui4a:policy:governance'],
      grantedApplications: ['development', 'governance', 'todo'],
    });

    const body = (await (await POST(approveRequest())).json()) as Record<string, unknown>;

    expect(body.disclosure).toEqual({
      kind: 'activation-visibility',
      applications: [{ application: 'todo', outcome: 'immediately-visible' }],
      grantedApplications: ['development', 'governance', 'todo'],
      governanceExpansion: true,
    });
  });

  it('recommends relogin when governance is in the runtime browser login scopes', async () => {
    mocks.engine.getSnapshot
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore } })
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore, todo: {} } });
    mocks.browserLoginPolicyScopes.mockReturnValueOnce([
      'openid',
      'ui4a:read',
      'ui4a:write',
      'ui4a:approve',
      'ui4a:policy:governance',
    ]);

    const body = (await (await POST(approveRequest())).json()) as Record<string, unknown>;

    expect(body.disclosure).toEqual({
      kind: 'activation-visibility',
      applications: [{ application: 'todo', outcome: 'visible-after-relogin' }],
      grantedApplications: ['development'],
      governanceExpansion: false,
      browserLoginScopes: [
        'openid',
        'ui4a:read',
        'ui4a:write',
        'ui4a:approve',
        'ui4a:policy:governance',
      ],
    });
  });

  it('requires an IdP grant when governance is absent from the browser login scopes', async () => {
    mocks.engine.getSnapshot
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore } })
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore, todo: {} } });
    mocks.browserLoginPolicyScopes.mockReturnValueOnce([
      'openid',
      'ui4a:read',
      'ui4a:write',
      'ui4a:approve',
      'ui4a:policy:development',
    ]);

    const body = (await (await POST(approveRequest())).json()) as Record<string, unknown>;

    expect(body.disclosure).toEqual(
      expect.objectContaining({
        applications: [{ application: 'todo', outcome: 'requires-idp-grant' }],
      }),
    );
  });

  it('omits the disclosure for accepted actions that install nothing new', async () => {
    // snapshot 前后一致(approve 未生长全集)。
    const response = await POST(approveRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect('disclosure' in body).toBe(false);
  });

  it('never attaches a disclosure for non-approve actions', async () => {
    const request = new Request('https://ui4a.internal/_meta/api/exec?scope=development', {
      method: 'POST',
      headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
      body: JSON.stringify({ rel: 'meta/draft:draft-1', action: 'revise' }),
    });
    mocks.engine.getSnapshot
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore } })
      .mockReturnValueOnce({ applications: { ...mocks.applicationsBefore, todo: {} } });

    const response = await POST(request);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect('disclosure' in body).toBe(false);
  });

  it('omits the disclosure when the approve outcome is rejected', async () => {
    mocks.executeDraftMeta.mockResolvedValueOnce({
      kind: 'rejected' as const,
      layer: 'guard-failed' as const,
      reason: 'guard rejected',
    });

    const response = await POST(approveRequest());

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect('disclosure' in body).toBe(false);
  });
});
