// T55/D75 四段提取:会话编排段(turn-context)的模块级测试。
// resolveTurnSituation(principal 双轴 + Situation)与 prepareTurnSession
// (起步 rel → 用户消息 → thread 附着 → 会话装载 → turn-started 投影)的
// 调用形状与既有 route 行为零差异;端到端由既有 9 个 route 测试覆盖。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  engine: {
    getSnapshot: vi.fn(() => ({ instances: {} })),
    getSitemap: vi.fn(() => ({ applications: [] })),
  },
  situation: vi.fn(),
  presentationContext: vi.fn(),
  resolveStartRel: vi.fn(),
  appendChatProjection: vi.fn(),
  appendConversationMessage: vi.fn(),
  loadAgentConversation: vi.fn(),
  attachChatMessageToThread: vi.fn(),
}));

vi.mock('../../engine/chat-situation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/chat-situation')>();
  return {
    ...actual,
    situationForChat: mocks.situation,
    presentationContextForIdentity: mocks.presentationContext,
  };
});
vi.mock('../../engine/chat-thread', () => ({ attachChatMessageToThread: mocks.attachChatMessageToThread }));
vi.mock('../../engine/service', () => ({
  getDb: () => ({ kind: 'test-db' }),
  getEngine: vi.fn(async () => mocks.engine),
}));
vi.mock('../session-events', () => ({
  appendChatProjection: mocks.appendChatProjection,
  appendConversationMessage: mocks.appendConversationMessage,
  loadAgentConversation: mocks.loadAgentConversation,
}));
vi.mock('../start-chain', () => ({ resolveStartRel: mocks.resolveStartRel }));

import { prepareTurnSession, resolveTurnSituation } from './turn-context';

const situationFixture = { site: 'business', scope: 'default', thread: 'thread:abc' };

describe('resolveTurnSituation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.situation.mockResolvedValue(situationFixture);
    mocks.presentationContext.mockReturnValue({ grantedApplications: [] });
  });

  it('local demo:principal 从 sessionId 派生,Sidecar principal 固定 local-user', async () => {
    const turn = await resolveTurnSituation({ sessionId: 's1' });
    expect(turn.principal).toBe('user:s1');
    expect(turn.presentationPrincipal).toBe('local-user');
    expect(mocks.situation).toHaveBeenCalledWith({
      principal: 'local-user',
      identity: undefined,
      clientView: undefined,
    });
    expect(turn.situation).toEqual(situationFixture);
  });

  it('production:principal 双轴都取认证 principal', async () => {
    const identity = { principal: 'human-alice' } as never;
    const turn = await resolveTurnSituation({ identity, sessionId: 's1' });
    expect(turn.principal).toBe('human-alice');
    expect(turn.presentationPrincipal).toBe('human-alice');
  });
});

describe('prepareTurnSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.situation.mockResolvedValue(situationFixture);
    mocks.resolveStartRel.mockReturnValue({ rel: 'application:default' });
    mocks.loadAgentConversation.mockResolvedValue({ messages: [], context: [] });
  });

  it('起步 rel 保留、thread 前缀归一、用户消息与 turn-started 依序落库', async () => {
    const turn = await resolveTurnSituation({ sessionId: 's1' });
    const session = await prepareTurnSession({
      goal: { verb: '列出文章' } as never,
      sessionId: 's1',
      turnId: 't1',
      mode: 'inline',
      turn,
    });

    expect(session.startRel).toBe('application:default');
    expect(session.contextRel).toBe('thread:abc');
    expect(mocks.resolveStartRel).toHaveBeenCalledWith(
      expect.objectContaining({ situation: situationFixture, granted: null }),
    );
    expect(mocks.appendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', turnId: 't1', messageId: 't1', role: 'user' }),
    );
    expect(mocks.attachChatMessageToThread).toHaveBeenCalledWith(
      mocks.engine,
      expect.objectContaining({ thread: 'thread:abc', messageId: 't1' }),
    );
    expect(mocks.loadAgentConversation).toHaveBeenCalledWith('s1', 'user:s1');
    expect(mocks.appendChatProjection).toHaveBeenCalledWith(
      'chat-turn-started',
      's1',
      expect.objectContaining({ turnId: 't1', driver: 'llm', mode: 'inline' }),
      'user:s1',
    );
  });

  it('situation 无 thread 时 contextRel 为 undefined', async () => {
    mocks.situation.mockResolvedValue({ ...situationFixture, thread: null });
    const turn = await resolveTurnSituation({ sessionId: 's1' });
    const session = await prepareTurnSession({
      goal: { verb: '列出文章' } as never,
      sessionId: 's1',
      turnId: 't1',
      mode: 'inline',
      turn,
    });
    expect(session.contextRel).toBeUndefined();
  });
});
