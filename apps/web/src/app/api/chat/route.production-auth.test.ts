import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BROWSER_SESSION_COOKIE_NAME } from '../../../auth/browser-session';

const HUMAN_ACCESS_TOKEN = 'human-access-token-fixture';
const EXCHANGED_ACCESS_TOKEN = 'turn-exchanged-token-fixture';
const AGENT_CLIENT_SECRET = 'agent-client-secret-fixture';
const APP_ORIGIN = 'https://ui4a.internal';
const INTERNAL_APP_ORIGIN = 'https://ui4a.home-linux.tail.styleofwong.com';
const AGENT_CLIENT_ID = 'ui4a-agent';

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(),
  browserSession: vi.fn(),
  dispatchDelegation: vi.fn(),
  exchangeDelegatedCredential: vi.fn(),
  fetcher: vi.fn(),
  getEngine: vi.fn(),
  preflight: vi.fn(),
  present: vi.fn(),
  readLog: vi.fn(),
  resolveIdentity: vi.fn(),
  runAgent: vi.fn(),
}));

vi.mock('@ui4a/db/events', () => ({
  appendEvent: mocks.appendEvent,
  readLog: mocks.readLog,
}));

vi.mock('../../../engine/service', () => ({
  getDb: () => ({ kind: 'test-db' }),
  getEngine: mocks.getEngine,
}));

vi.mock('../../../engine/presentation/runtime', () => ({
  getPresentationBroker: () => ({ present: mocks.present }),
  getPresentationCapabilities: () => ({ markdownWord: false }),
}));

vi.mock('../../../temporal/delegation', () => ({
  dispatchDelegation: mocks.dispatchDelegation,
}));

vi.mock('../../../auth/production/browser-authentication-runtime', () => ({
  getProductionBrowserAuthentication: () => ({ resolveSession: mocks.browserSession }),
}));

vi.mock('../../../auth/production-agent-token-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../auth/production-agent-token-provider')>();
  return {
    ...actual,
    getProductionAgentTokenProvider: () => ({
      exchangeDelegatedCredential: mocks.exchangeDelegatedCredential,
    }),
  };
});

vi.mock('../../../auth/request-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth/request-identity')>();
  return {
    ...actual,
    resolveTrustedRequestIdentity: mocks.resolveIdentity,
    authenticationErrorResponse: (error: unknown) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'credential_malformed';
      if (code.startsWith('agent_')) return undefined;
      const forbidden = ['scope_insufficient', 'delegation_actor_not_allowed'].includes(code);
      return Response.json({ error: { code } }, { status: forbidden ? 403 : 401 });
    },
  };
});

vi.mock('../../../production-deployment-preflight', () => ({
  runWebProductionDeploymentPreflight: mocks.preflight,
}));

vi.mock('@ui4a/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui4a/agent')>();
  return {
    ...actual,
    createDriver: vi.fn(() => ({ kind: 'test-driver' })),
    resolveLlmConfig: vi.fn(() => ({ kind: 'test-config' })),
    runAgent: mocks.runAgent,
  };
});

import { POST } from './route';

interface AgentRunContext {
  baseUrl: string;
  actor: string;
  principal: string;
  channel: string;
  app?: string;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  onPresentation?: (intent: Record<string, unknown>) => void;
}

function browserError(code: 'session_not_found' | 'session_cookie_invalid' | 'session_expired') {
  return Object.assign(new Error(code), { name: 'BrowserAuthenticationError', code });
}

function request(
  body: Record<string, unknown>,
  options: { url?: string; host?: string; cookie?: string; forwardedProto?: string } = {},
): Request {
  return new Request(options.url ?? `${APP_ORIGIN}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.forwardedProto === undefined
        ? {}
        : { 'x-forwarded-proto': options.forwardedProto }),
      ...(options.cookie === undefined
        ? {}
        : { cookie: `${BROWSER_SESSION_COOKIE_NAME}=${options.cookie}` }),
    },
    body: JSON.stringify(body),
  });
}

async function frames(response: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await response.text();
  return raw
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
}

function successfulFetch(input: string | URL | Request): Response {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.endsWith('/.well-known/ui4a.json')) {
    return Response.json({ surfaces: [{ rel: 'articles', title: 'articles' }] });
  }
  return Response.json({ class: ['entity'], properties: { rel: 'articles' } });
}

function secretsIn(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Headers) return Object.fromEntries(item);
    if (item instanceof URLSearchParams) return item.toString();
    return item;
  });
}

beforeEach(() => {
  process.env.UI4A_DEPLOYMENT_PROFILE = 'production';
  process.env.APP_ORIGIN = APP_ORIGIN;
  process.env.LLM_API_KEY = 'test-llm-key';
  process.env.LLM_BASE_URL = 'https://llm.ui4a.internal/v1';
  process.env.LLM_MODEL = 'test-model';

  mocks.appendEvent.mockReset();
  mocks.appendEvent.mockImplementation(async () => ({ seq: 1 }));
  mocks.browserSession.mockReset();
  mocks.browserSession.mockResolvedValue({
    authorizationHeader: `Bearer ${HUMAN_ACCESS_TOKEN}`,
    expiresAtMs: Date.now() + 60_000,
  });
  mocks.dispatchDelegation.mockReset();
  mocks.dispatchDelegation.mockResolvedValue({ delegationId: 'delegation-production-fixture' });
  mocks.exchangeDelegatedCredential.mockReset();
  mocks.exchangeDelegatedCredential.mockResolvedValue({
    authorizationHeader: `Bearer ${EXCHANGED_ACCESS_TOKEN}`,
    expiresAtMs: Date.now() + 30_000,
  });
  mocks.fetcher.mockReset();
  mocks.fetcher.mockImplementation(async (input: string | URL | Request) => successfulFetch(input));
  vi.stubGlobal('fetch', mocks.fetcher);
  mocks.getEngine.mockReset();
  mocks.getEngine.mockResolvedValue({
    getSnapshot: () => ({
      instances: {},
      collections: {},
      applications: {
        default: { entry: { target: 'flow:article-drafting', role: 'primary-create' } },
        development: { entry: { target: 'flow:software-change', role: 'primary-task' } },
      },
    }),
    getSitemap: () => ({
      version: 'test',
      surfaces: [],
      flows: [],
      applications: [],
      capabilities: [],
    }),
  });
  mocks.preflight.mockReset();
  mocks.preflight.mockReturnValue({
    settings: {
      service: {
        publicOrigin: APP_ORIGIN,
        trustedRequestOrigins: [APP_ORIGIN, INTERNAL_APP_ORIGIN],
      },
      auth: {
        mode: 'oidc',
        oidc: {
          agentScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
          agentClientId: AGENT_CLIENT_ID,
        },
      },
    },
    secrets: {},
  });
  mocks.present.mockReset();
  mocks.present.mockResolvedValue({ schemaVersion: 1, requestId: 'req', status: 'ready' });
  mocks.readLog.mockReset();
  mocks.readLog.mockResolvedValue([]);
  mocks.resolveIdentity.mockReset();
  mocks.resolveIdentity.mockImplementation(async (identityRequest: Request) => {
    const authorization = identityRequest.headers.get('authorization');
    if (authorization === `Bearer ${HUMAN_ACCESS_TOKEN}`) {
      return {
        authorizationMode: 'credential',
        actor: 'human',
        principal: 'human-alice',
        scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
        grantedApplications: ['development'],
        channel: 'oidc',
        humanApprovalEligible: true,
      };
    }
    if (authorization === `Bearer ${EXCHANGED_ACCESS_TOKEN}`) {
      return {
        authorizationMode: 'credential',
        actor: 'agent',
        principal: 'human-alice',
        scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
        grantedApplications: ['development'],
        channel: 'oidc',
        humanApprovalEligible: false,
        delegation: {
          subject: 'human-alice',
          actorClientId: AGENT_CLIENT_ID,
          source: 'token-exchange-sub-azp',
        },
      };
    }
    throw Object.assign(new Error('unexpected credential'), { code: 'credential_malformed' });
  });
  mocks.runAgent.mockReset();
  mocks.runAgent.mockImplementation(
    async (_driver: unknown, _goal: unknown, context: AgentRunContext) => {
      await context.fetchImpl(`${context.baseUrl}/api/entity?rel=articles`, {
        headers: { authorization: 'Bearer attacker-controlled-header' },
      });
      await context.fetchImpl(`${context.baseUrl}/api/exec`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rel: 'article:first', action: 'archive' }),
      });
      await context.fetchImpl(`${context.baseUrl}/api/exec-plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ steps: [] }),
      });
      return { outcome: 'done', summary: 'done', steps: [], successes: [] };
    },
  );
});

afterEach(() => {
  delete process.env.UI4A_DEPLOYMENT_PROFILE;
  delete process.env.APP_ORIGIN;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  vi.unstubAllGlobals();
});

describe('production chat turn credential boundary', () => {
  it.each([
    ['missing', 'session_not_found'],
    ['invalid', 'session_cookie_invalid'],
    ['expired', 'session_expired'],
  ] as const)(
    'rejects a %s browser session before events, LLM, dispatch, exchange, or fetch',
    async (_name, code) => {
      mocks.browserSession.mockRejectedValueOnce(browserError(code));

      const response = await POST(
        request(
          { goal: { verb: 'browse articles' }, sessionId: 'attacker-session', turnId: 'turn-1' },
          { cookie: code === 'session_not_found' ? undefined : 'bad-session' },
        ),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: { code } });
      expect(mocks.appendEvent).not.toHaveBeenCalled();
      expect(mocks.runAgent).not.toHaveBeenCalled();
      expect(mocks.dispatchDelegation).not.toHaveBeenCalled();
      expect(mocks.exchangeDelegatedCredential).not.toHaveBeenCalled();
      expect(mocks.fetcher).not.toHaveBeenCalled();
    },
  );

  it('exchanges once and binds the narrowed credential to same-origin contract fetches for this turn', async () => {
    const response = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'display-only', turnId: 'turn-2' },
        { cookie: 'valid-session' },
      ),
    );
    expect(response.status).toBe(200);
    expect((await frames(response)).some((frame) => frame.type === 'final')).toBe(true);

    expect(mocks.browserSession).toHaveBeenCalledTimes(1);
    expect(mocks.resolveIdentity).toHaveBeenCalledTimes(2);
    const exchangedVerification = mocks.resolveIdentity.mock.calls[1]!;
    expect((exchangedVerification[0] as Request).headers.get('authorization')).toBe(
      `Bearer ${EXCHANGED_ACCESS_TOKEN}`,
    );
    expect(exchangedVerification[1]).toMatchObject({
      profile: 'production',
      requiredScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
      authorizedPolicyScopes: ['development'],
      plane: 'business',
    });
    expect(mocks.exchangeDelegatedCredential).toHaveBeenCalledTimes(1);
    expect(mocks.exchangeDelegatedCredential).toHaveBeenCalledWith({
      subjectToken: HUMAN_ACCESS_TOKEN,
      requestedScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
    });
    expect(
      (mocks.exchangeDelegatedCredential.mock.calls[0]![0] as { requestedScopes: string[] })
        .requestedScopes,
    ).not.toContain('ui4a:approve');

    const requestedPaths = mocks.fetcher.mock.calls.map(([input, init]) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const requestHeaders = input instanceof Request ? input.headers : new Headers(init?.headers);
      return { pathname: url.pathname, authorization: requestHeaders.get('authorization') };
    });
    expect(requestedPaths.map(({ pathname }) => pathname)).toEqual(
      expect.arrayContaining([
        '/.well-known/ui4a.json',
        '/api/entity',
        '/api/exec',
        '/api/exec-plan',
      ]),
    );
    expect(
      requestedPaths.every(
        ({ authorization }) => authorization === `Bearer ${EXCHANGED_ACCESS_TOKEN}`,
      ),
    ).toBe(true);

    expect(mocks.runAgent).toHaveBeenCalledTimes(1);
    expect((mocks.runAgent.mock.calls[0]![2] as AgentRunContext).principal).toBe('human-alice');
    expect((mocks.runAgent.mock.calls[0]![2] as AgentRunContext).channel).toBe('chat');
    expect((mocks.runAgent.mock.calls[0]![2] as AgentRunContext).app).toBeUndefined();
  });

  it('carries every granted agent policy scope into the exchange (rel coverage is per-request)', async () => {
    // D51:human 与 agentScopes 交集含两个 policy 应用时,交换请求必须全量携带——
    // 接收端授权按授予集合 × 归属逐请求判定。
    mocks.preflight.mockReturnValueOnce({
      settings: {
        service: {
          publicOrigin: APP_ORIGIN,
          trustedRequestOrigins: [APP_ORIGIN, INTERNAL_APP_ORIGIN],
        },
        auth: {
          mode: 'oidc',
          oidc: {
            agentScopes: [
              'ui4a:read',
              'ui4a:write',
              'ui4a:policy:development',
              'ui4a:policy:publishing',
            ],
            agentClientId: AGENT_CLIENT_ID,
          },
        },
      },
      secrets: {},
    });
    mocks.resolveIdentity.mockImplementationOnce(async () => ({
      authorizationMode: 'credential',
      actor: 'human',
      principal: 'human-alice',
      scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development', 'ui4a:policy:publishing'],
      grantedApplications: ['development', 'publishing'],
      channel: 'oidc',
      humanApprovalEligible: true,
    }));

    const response = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'multi-scope', turnId: 'turn-multi' },
        { cookie: 'valid-session' },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.exchangeDelegatedCredential).toHaveBeenCalledWith({
      subjectToken: HUMAN_ACCESS_TOKEN,
      requestedScopes: [
        'ui4a:read',
        'ui4a:write',
        'ui4a:policy:development',
        'ui4a:policy:publishing',
      ],
    });
    // 交换凭证的接收端校验白名单必须覆盖全部携带的 policy scopes(否则误报
    // delegation_scope_exceeded)。
    const delegatedVerification = mocks.resolveIdentity.mock.calls[1]!;
    expect(delegatedVerification[1]).toMatchObject({
      authorizedPolicyScopes: ['development', 'publishing'],
    });
    // 排空 SSE 流:回合的 chat 投影事件(chat-turn / chat-message-appended)
    // 在流体内异步落库;不读完,落库会越过本用例边界、在后续用例 mockReset
    // 之后到达,污染其 appendEvent 未调用断言。
    await response.text();
  });

  it('passes every granted policy scope to the Presentation Broker for per-rel coverage selection', async () => {
    // D51:present 携带凭证授予集合(grantedApplications):目标 rel(如 publishing
    // 的 post)在身份解析后才出现,授权由 Broker 咽喉点按授予集合 × 归属完成。
    mocks.preflight.mockReturnValueOnce({
      settings: {
        service: {
          publicOrigin: APP_ORIGIN,
          trustedRequestOrigins: [APP_ORIGIN, INTERNAL_APP_ORIGIN],
        },
        auth: {
          mode: 'oidc',
          oidc: {
            agentScopes: [
              'ui4a:read',
              'ui4a:write',
              'ui4a:policy:development',
              'ui4a:policy:publishing',
            ],
            agentClientId: AGENT_CLIENT_ID,
          },
        },
      },
      secrets: {},
    });
    mocks.resolveIdentity.mockImplementationOnce(async () => ({
      authorizationMode: 'credential',
      actor: 'human',
      principal: 'human-alice',
      scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development', 'ui4a:policy:publishing'],
      grantedApplications: ['development', 'publishing'],
      channel: 'oidc',
      humanApprovalEligible: true,
    }));
    mocks.runAgent.mockImplementationOnce(
      async (_driver: unknown, _goal: unknown, context: AgentRunContext) => {
        context.onPresentation?.({
          subject: 'post:first-post',
          intent: 'read',
          delivery: 'canvas',
        });
        return { outcome: 'done', summary: 'done', steps: [], successes: [] };
      },
    );

    const response = await POST(
      request(
        { goal: { verb: '看看第一篇' }, sessionId: 'multi-scope', turnId: 'turn-present' },
        { cookie: 'valid-session' },
      ),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.present).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'post:first-post' }),
      { principal: 'human-alice', grantedApplications: ['development', 'publishing'] },
    );
  });

  it('rejects a read-only human before exchange, database, or Agent execution', async () => {
    // D51 路由级收窄锚:交换请求的 scopes 必须是凭证 scopes 的子集(此处缺
    // ui4a:write)。无 policy 声明的空授予封套在身份解析层已 fail-closed(见
    // authentication-negative 的对应单元锚),不再由路由默认回退机器兜底。
    mocks.resolveIdentity.mockResolvedValueOnce({
      authorizationMode: 'credential',
      actor: 'human',
      principal: 'human-alice',
      scopes: ['ui4a:read', 'ui4a:policy:development'],
      grantedApplications: ['development'],
      channel: 'oidc',
      humanApprovalEligible: true,
    });

    const response = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'display-only', turnId: 'turn-scope' },
        { cookie: 'valid-session' },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'agent_scope_exceeded' } });
    expect(mocks.exchangeDelegatedCredential).not.toHaveBeenCalled();
    expect(mocks.getEngine).not.toHaveBeenCalled();
    expect(mocks.readLog).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong subject',
      {
        principal: 'human-mallory',
        scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
        delegation: {
          subject: 'human-mallory',
          actorClientId: AGENT_CLIENT_ID,
          source: 'token-exchange-sub-azp',
        },
      },
    ],
    [
      'wrong authorized party',
      {
        principal: 'human-alice',
        scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
        delegation: {
          subject: 'human-alice',
          actorClientId: 'unknown-agent',
          source: 'token-exchange-sub-azp',
        },
      },
    ],
    [
      'expanded scopes',
      {
        principal: 'human-alice',
        scopes: ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
        delegation: {
          subject: 'human-alice',
          actorClientId: AGENT_CLIENT_ID,
          source: 'token-exchange-sub-azp',
        },
      },
    ],
  ])('rejects an exchanged credential with %s before business effects', async (_name, patch) => {
    mocks.resolveIdentity.mockResolvedValueOnce({
      authorizationMode: 'credential',
      actor: 'human',
      principal: 'human-alice',
      scopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
      grantedApplications: ['development'],
      channel: 'oidc',
      humanApprovalEligible: true,
    });
    mocks.resolveIdentity.mockResolvedValueOnce({
      authorizationMode: 'credential',
      actor: 'agent',
      grantedApplications: ['development'],
      channel: 'oidc',
      humanApprovalEligible: false,
      ...patch,
    });

    const response = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'display-only', turnId: 'turn-result' },
        { cookie: 'valid-session' },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'agent_delegation_identity_invalid' },
    });
    expect(mocks.exchangeDelegatedCredential).toHaveBeenCalledTimes(1);
    expect(mocks.resolveIdentity).toHaveBeenCalledTimes(2);
    expect(mocks.readLog).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });

  it('rejects a spoofed Host before token exchange or network access', async () => {
    const spoofed = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'spoof', turnId: 'turn-3' },
        { cookie: 'valid-session', host: 'evil.internal' },
      ),
    );
    expect(spoofed.status).toBe(400);
    expect(mocks.fetcher).not.toHaveBeenCalled();
    expect(mocks.exchangeDelegatedCredential).not.toHaveBeenCalled();
  });

  it('reconstructs the external origin from x-forwarded-proto behind a TLS-terminating edge', async () => {
    // TLS 在 edge 终止时 pod 内 request.url 协议为 http;edge 覆写的
    // x-forwarded-proto + Host 重建的外部 origin 应与配置 publicOrigin 匹配。
    const behindEdge = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'edge', turnId: 'turn-edge' },
        {
          cookie: 'valid-session',
          url: 'http://ui4a.internal/api/chat',
          host: 'ui4a.internal',
          forwardedProto: 'https',
        },
      ),
    );
    expect(behindEdge.status).toBe(200);
  });

  it('accepts an internal trusted Host while retaining the public origin as canonical', async () => {
    const internal = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'internal', turnId: 'turn-internal' },
        {
          cookie: 'valid-session',
          url: 'http://web:3100/api/chat',
          host: new URL(INTERNAL_APP_ORIGIN).host,
          forwardedProto: 'https',
        },
      ),
    );

    expect(internal.status).toBe(200);
  });

  it('still rejects a plain http origin that matches neither forwarded proto nor config', async () => {
    const plain = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'plain', turnId: 'turn-plain' },
        { cookie: 'valid-session', url: 'http://ui4a.internal/api/chat', host: 'ui4a.internal' },
      ),
    );
    expect(plain.status).toBe(400);
  });

  it('rejects cross-origin and non-contract Agent fetches before either reaches the network', async () => {
    mocks.runAgent.mockImplementationOnce(
      async (_driver: unknown, _goal: unknown, context: AgentRunContext) => {
        await expect(
          context.fetchImpl('https://evil.internal/api/entity?rel=secrets'),
        ).rejects.toThrow(/origin|allowlist|forbidden/i);
        await expect(context.fetchImpl(`${APP_ORIGIN}/admin`)).rejects.toThrow(
          /path|allowlist|forbidden/i,
        );
        return { outcome: 'done', summary: 'bounded', steps: [], successes: [] };
      },
    );
    const bounded = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'display-only', turnId: 'turn-4' },
        { cookie: 'valid-session' },
      ),
    );
    expect(bounded.status).toBe(200);
    await bounded.text();
    expect(
      mocks.fetcher.mock.calls.some(([input]) =>
        String(input instanceof Request ? input.url : input).startsWith('https://evil.internal'),
      ),
    ).toBe(false);
    expect(
      mocks.fetcher.mock.calls.some(([input]) =>
        String(input instanceof Request ? input.url : input).endsWith('/admin'),
      ),
    ).toBe(false);
  });

  it('does not echo credentials when token exchange fails', async () => {
    mocks.exchangeDelegatedCredential.mockRejectedValueOnce(
      Object.assign(
        new Error(`exchange failed for Bearer ${HUMAN_ACCESS_TOKEN} via ${AGENT_CLIENT_SECRET}`),
        { code: 'agent_token_endpoint_unavailable' },
      ),
    );

    const response = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'display-only', turnId: 'turn-error' },
        { cookie: 'valid-session' },
      ),
    );
    expect(response.status).toBe(503);
    const payload = await response.text();
    expect(payload).toContain('agent_token_endpoint_unavailable');
    expect(payload).not.toContain(HUMAN_ACCESS_TOKEN);
    expect(payload).not.toContain(EXCHANGED_ACCESS_TOKEN);
    expect(payload).not.toContain(AGENT_CLIENT_SECRET);
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(mocks.runAgent).not.toHaveBeenCalled();
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });

  it('uses the trusted principal and never serializes human token, exchanged token, or client secret', async () => {
    const response = await POST(
      request(
        { goal: { verb: 'browse articles' }, sessionId: 'forged-root', turnId: 'turn-5' },
        { cookie: 'valid-session' },
      ),
    );
    const sse = await response.text();
    const eventInputs = mocks.appendEvent.mock.calls.map((call) => call[1]);
    expect(eventInputs.length).toBeGreaterThan(0);
    expect(eventInputs.every((event) => event.principal === 'human-alice')).toBe(true);

    const observable = secretsIn({
      sse,
      events: eventInputs,
      network: mocks.fetcher.mock.calls.map(([input, init]) => ({
        url: input instanceof Request ? input.url : String(input),
        body: init?.body,
      })),
      dispatch: mocks.dispatchDelegation.mock.calls,
    });
    expect(observable).not.toContain(HUMAN_ACCESS_TOKEN);
    expect(observable).not.toContain(EXCHANGED_ACCESS_TOKEN);
    expect(observable).not.toContain(AGENT_CLIENT_SECRET);
    expect(observable).not.toContain('forged-root');
  });

  it('keeps durable delegation token-free and leaves credential acquisition to the Worker Activity', async () => {
    const response = await POST(
      request(
        {
          goal: { verb: 'browse articles' },
          mode: 'delegated',
          sessionId: 'forged-root',
          turnId: 'turn-6',
          clientView: {
            schemaVersion: 2,
            presence: {
              clientInstanceId: 'production-delegated',
              site: 'workstation',
              scope: 'development',
              thread: null,
              focus: null,
            },
          },
        },
        { cookie: 'valid-session' },
      ),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.exchangeDelegatedCredential).not.toHaveBeenCalled();
    expect(mocks.dispatchDelegation).toHaveBeenCalledTimes(1);
    const dispatch = mocks.dispatchDelegation.mock.calls[0]![0] as Record<string, unknown>;
    expect(dispatch.principal).toBe('human-alice');
    expect(dispatch.scope).toBe('development');
    expect(secretsIn(dispatch)).not.toContain(HUMAN_ACCESS_TOKEN);
    expect(secretsIn(dispatch)).not.toContain(EXCHANGED_ACCESS_TOKEN);
    expect(secretsIn(dispatch)).not.toContain(AGENT_CLIENT_SECRET);
  });
});

describe('local demo profile', () => {
  it('retains the session-derived local principal and does not invoke production auth', async () => {
    delete process.env.UI4A_DEPLOYMENT_PROFILE;
    delete process.env.APP_ORIGIN;

    const response = await POST(
      request({ goal: { verb: 'browse articles' }, sessionId: 'local-demo', turnId: 'turn-local' }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.browserSession).not.toHaveBeenCalled();
    expect(mocks.resolveIdentity).not.toHaveBeenCalled();
    expect(mocks.exchangeDelegatedCredential).not.toHaveBeenCalled();
    expect((mocks.runAgent.mock.calls[0]![2] as AgentRunContext).principal).toBe('user:local-demo');
    expect((mocks.runAgent.mock.calls[0]![2] as AgentRunContext).app).toBeUndefined();
  });
});
