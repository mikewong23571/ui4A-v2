// T55/D75 四段提取:响应段(turn-response)的模块级测试。
// prepareTurnDispatch(baseUrl 口径/平面归属/显式 lens/AI-first 配置检查)与
// respondToTurn(configurationFailure/delegated/inline 三分支)的语义与既有
// route 行为零差异;SSE 帧序列细节由 route.render/route.step-frames 等覆盖。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchDelegation: vi.fn(),
  appendChatProjection: vi.fn(),
  resolveLlmConfig: vi.fn(),
}));

vi.mock('../temporal/delegation', () => ({ dispatchDelegation: mocks.dispatchDelegation }));
vi.mock('./session-events', () => ({
  appendChatProjection: mocks.appendChatProjection,
}));
vi.mock('@ui4a/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ui4a/agent')>();
  return {
    ...actual,
    resolveLlmConfig: mocks.resolveLlmConfig,
  };
});

import type { AgentGoal, FetchLike } from '@ui4a/agent';
import { LlmConfigurationError } from '@ui4a/agent';

import { prepareTurnDispatch, respondToTurn } from './turn-response';

const LOCAL = 'http://localhost:3100';

function turnFixture(overrides: Record<string, unknown> = {}) {
  return {
    principal: 'user:s1',
    presentationPrincipal: 'local-user',
    presentationContext: {},
    situation: { site: 'business', scope: 'default', thread: null, ...overrides },
  } as never;
}

function sessionFixture() {
  return {
    startRel: 'application:default',
    contextRel: undefined,
    agentConversation: { messages: [], context: [], clientView: undefined },
  } as never;
}

function dispatchArgs(overrides: Record<string, unknown> = {}) {
  return {
    requestUrl: new URL(`${LOCAL}/api/chat`),
    mode: 'inline' as const,
    goal: { verb: '列出文章' },
    situation: { site: 'business', scope: 'default', thread: null },
    ...overrides,
  };
}

describe('prepareTurnDispatch — baseUrl 口径(终审 M-2)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.APP_ORIGIN;
    mocks.resolveLlmConfig.mockImplementation(() => undefined);
  });

  it('生产 origin 优先;inline 本地回环用请求 origin', () => {
    expect(
      prepareTurnDispatch(dispatchArgs({ productionOrigin: 'https://ui4a.internal' })),
    ).toMatchObject({ baseUrl: 'https://ui4a.internal' });
    expect(prepareTurnDispatch(dispatchArgs())).toMatchObject({ baseUrl: LOCAL });
  });

  it('delegated:APP_ORIGIN 显式覆盖;本机 Host 放行请求 origin', () => {
    process.env.APP_ORIGIN = 'https://ui4a.internal';
    expect(prepareTurnDispatch(dispatchArgs({ mode: 'delegated' }))).toMatchObject({
      baseUrl: 'https://ui4a.internal',
    });
    delete process.env.APP_ORIGIN;
    expect(prepareTurnDispatch(dispatchArgs({ mode: 'delegated' }))).toMatchObject({
      baseUrl: LOCAL,
    });
  });

  it('delegated:非本机 Host 且未配置 APP_ORIGIN → 据实 400,拒绝派发', () => {
    const result = prepareTurnDispatch(
      dispatchArgs({ mode: 'delegated', requestUrl: new URL('https://evil.example/api/chat') }),
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
  });

  it('meta 平面:baseUrl 追加 /_meta,显式 lens 取 situation.scope', () => {
    const plan = prepareTurnDispatch(
      dispatchArgs({ goal: { verb: 'draft._meta.apply' }, situation: { site: 'meta', scope: 'governance', thread: null } }),
    );
    expect(plan).toMatchObject({ baseUrl: `${LOCAL}/_meta`, metaLens: 'governance' });
  });

  it('AI-first 配置检查:LLM 不可用时如实记录失败原因(不短路)', () => {
    mocks.resolveLlmConfig.mockImplementation(() => {
      throw new LlmConfigurationError(['UI4A_LLM_API_KEY'] as never);
    });
    const plan = prepareTurnDispatch(dispatchArgs());
    expect(plan).not.toBeInstanceOf(Response);
    expect((plan as { configurationFailure?: string }).configurationFailure).toContain('LLM 不可用');
  });

  it('非配置类异常不被吞掉(原样重抛)', () => {
    mocks.resolveLlmConfig.mockImplementation(() => {
      throw new Error('unexpected');
    });
    expect(() => prepareTurnDispatch(dispatchArgs())).toThrow('unexpected');
  });
});

describe('respondToTurn 三分支', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('configurationFailure + delegated:503 JSON 与 chat-turn failed 投影', async () => {
    const response = await respondToTurn({
      goal: { verb: '列出文章' } as never,
      sessionId: 's1',
      turnId: 't1',
      requested: 'auto',
      mode: 'delegated',
      turn: turnFixture(),
      session: sessionFixture(),
      plan: { baseUrl: LOCAL, configurationFailure: 'LLM 不可用: x' },
      turnFetch: vi.fn(),
    } as never);
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ sessionId: 's1', outcome: 'failed', error: 'LLM 不可用: x' });
    expect(mocks.appendChatProjection).toHaveBeenCalledWith(
      'chat-turn',
      's1',
      expect.objectContaining({ outcome: 'failed', driver: 'llm' }),
      'user:s1',
    );
  });

  it('delegated 成功:dispatchDelegation 派发 + 回执 JSON', async () => {
    mocks.dispatchDelegation.mockResolvedValue({ delegationId: 'delegation-abc123' });
    const response = await respondToTurn({
      goal: { verb: '列出文章' } as never,
      sessionId: 's1',
      turnId: 't1',
      requested: 'auto',
      mode: 'delegated',
      turn: turnFixture(),
      session: sessionFixture(),
      plan: { baseUrl: LOCAL },
      turnFetch: vi.fn(),
    } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: 'delegated',
      delegationId: 'delegation-abc123',
      statusUrl: '/api/delegations/delegation-abc123',
      sessionId: 's1',
    });
    expect(mocks.dispatchDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ driverKind: 'llm', principal: 'user:s1', baseUrl: LOCAL }),
    );
  });

  it('delegated 派发失败:据实 503(委托未出发)', async () => {
    mocks.dispatchDelegation.mockRejectedValue(new Error('temporal unreachable'));
    const response = await respondToTurn({
      goal: { verb: '列出文章' } as never,
      sessionId: 's1',
      turnId: 't1',
      requested: 'auto',
      mode: 'delegated',
      turn: turnFixture(),
      session: sessionFixture(),
      plan: { baseUrl: LOCAL },
      turnFetch: vi.fn(),
    } as never);
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ sessionId: 's1', error: '委托派发失败: temporal unreachable' });
  });

  it('inline:SSE 流式响应(text/event-stream)', async () => {
    const response = await respondToTurn({
      goal: { verb: '列出文章' } as never,
      sessionId: 's1',
      turnId: 't1',
      requested: 'auto',
      mode: 'inline',
      turn: turnFixture(),
      session: sessionFixture(),
      plan: { baseUrl: LOCAL },
      turnFetch: vi.fn(),
    } as never);
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
  });
});
