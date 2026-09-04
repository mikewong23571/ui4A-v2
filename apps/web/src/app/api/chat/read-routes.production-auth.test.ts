import type { StoredEvent } from '@ui4a/db/events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // 类型标注在 vi.hoisted 变换后仍然成立(编译期擦除,mock 运行时不受影响)。
  authenticationErrorResponse: vi.fn((error: unknown) => {
    const code = (error as { code?: string }).code;
    return code === undefined ? undefined : Response.json({ error: { code } }, { status: 401 });
  }),
  getDb: vi.fn(() => ({ kind: 'mock-db' })),
  getEngine: vi.fn(async () => ({
    getSnapshot: vi.fn(() => ({ applications: { default: {}, publishing: {} } })),
  })),
  listEvents: vi.fn(async (): Promise<StoredEvent[]> => []),
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

  // ---- T49 Phase 4(D68.3/D68.5):principal 收窄后的投影级锚定(FR4/FR6)-----------
  // mock listEvents 直接扮演「已按 principal='human-alice' 过滤后的日志切片」,
  // 断言落在两读端点的分组/聚合/空态投影上;跨 principal 的收窄本身由上组断言
  // 与 packages/db/src/events.test.ts 的 listEvents principal 过滤锚点共同覆盖。

  interface SessionRow {
    sessionId: string;
    turns: number;
    firstTs: string;
    lastTs: string;
    lastGoal: string;
    lastOutcome: string;
  }

  interface HistoryTurn {
    seq: number;
    turnId: string;
    sessionId: string;
    goal: { verb: string };
    outcome: string;
  }

  interface TurnFixture {
    seq: number;
    ts: string;
    sessionId: string;
    turnId: string;
    verb: string;
    outcome: string;
  }

  /** 旧形状(D68.5):升级前 sessionId 折叠为 principal 的存量会话行键。 */
  const preD68SessionId = 'human-alice';
  /** 新形状(D68.1):客户端铸发的 UUID 会话分组键,与旧形状同 principal 并存。 */
  const newSessionId = '11111111-2222-4333-8444-555555555555';
  const preD68FirstTs = '2026-09-04T10:00:00.000Z';
  const preD68LastTs = '2026-09-04T10:05:00.000Z';
  const newSessionTs = '2026-09-04T11:00:00.000Z';

  /** alice 名下一条已完成回合事件(行形状与 DB 读回一致;ts 为 ISO 字符串)。 */
  function aliceTurn(fixture: TurnFixture): StoredEvent {
    return {
      domain: 'core',
      seq: fixture.seq,
      ts: fixture.ts,
      actor: 'agent',
      principal: 'human-alice',
      channel: 'chat',
      kind: 'chat-turn',
      rel: `chat:${fixture.sessionId}`,
      action: null,
      params: {},
      reason: null,
      detail: {
        sessionId: fixture.sessionId,
        turnId: fixture.turnId,
        goal: { verb: fixture.verb },
        outcome: fixture.outcome,
        summary: `完成: ${fixture.verb}`,
        messages: [{ role: 'assistant', text: `完成: ${fixture.verb}` }],
        steps: [],
        driver: 'llm',
      },
    };
  }

  /** alice 的日志切片:旧形状会话 2 回合 + 新 UUID 会话 1 回合(seq 升序)。 */
  function aliceEvents(): StoredEvent[] {
    return [
      aliceTurn({
        seq: 1,
        ts: preD68FirstTs,
        sessionId: preD68SessionId,
        turnId: 'pre-d68-turn-1',
        verb: '发布第一篇文章',
        outcome: 'done',
      }),
      aliceTurn({
        seq: 2,
        ts: preD68LastTs,
        sessionId: preD68SessionId,
        turnId: 'pre-d68-turn-2',
        verb: '再发布一篇',
        outcome: 'done',
      }),
      aliceTurn({
        seq: 3,
        ts: newSessionTs,
        sessionId: newSessionId,
        turnId: 'new-turn-1',
        verb: '查看文章列表',
        outcome: 'done',
      }),
    ];
  }

  it('U1/U8: sessions 投影旧形状 principal 会话与新 UUID 会话并存(lastTs 倒序,聚合正确)', async () => {
    mocks.listEvents.mockResolvedValueOnce(aliceEvents());

    const response = await getSessions(new Request('https://ui4a.internal/api/chat/sessions'));
    const json = (await response.json()) as { sessions?: SessionRow[] };

    expect(response.status).toBe(200);
    const rows = json.sessions ?? [];
    expect(rows).toHaveLength(2);
    // lastTs 倒序:新 UUID 会话(11:00)在前,旧形状会话(10:05)在后(FR6 并存、无改写)。
    expect(rows.map((row) => row.sessionId)).toEqual([newSessionId, preD68SessionId]);
    expect(rows[0]).toMatchObject({
      sessionId: newSessionId,
      turns: 1,
      firstTs: newSessionTs,
      lastTs: newSessionTs,
      lastGoal: '查看文章列表',
      lastOutcome: 'done',
    });
    expect(rows[1]).toMatchObject({
      sessionId: preD68SessionId,
      turns: 2,
      firstTs: preD68FirstTs,
      lastTs: preD68LastTs,
      lastGoal: '再发布一篇',
      lastOutcome: 'done',
    });
    // U9:同 principal 名下总回合 3 不丢。
    expect(rows.reduce((total, row) => total + row.turns, 0)).toBe(3);
  });

  it('U8: history 可读回旧形状会话的全部回合,新 UUID 会话仅读回自身', async () => {
    mocks.listEvents.mockResolvedValueOnce(aliceEvents());
    mocks.listEvents.mockResolvedValueOnce(aliceEvents());

    const preD68 = await getHistory(
      new Request(`https://ui4a.internal/api/chat/history?sessionId=${preD68SessionId}`),
    );
    const preD68Json = (await preD68.json()) as { turns?: HistoryTurn[] };
    expect(preD68.status).toBe(200);
    // 2 条回合,seq 升序,sessionId 原样为旧形状键(D68.5 诚实投影)。
    expect(preD68Json.turns?.map((turn) => turn.seq)).toEqual([1, 2]);
    expect(preD68Json.turns?.map((turn) => turn.turnId)).toEqual([
      'pre-d68-turn-1',
      'pre-d68-turn-2',
    ]);
    expect(preD68Json.turns?.every((turn) => turn.sessionId === preD68SessionId)).toBe(true);
    expect(preD68Json.turns?.[1]?.goal).toEqual({ verb: '再发布一篇' });
    expect(preD68Json.turns?.[1]?.outcome).toBe('done');

    const fresh = await getHistory(
      new Request(`https://ui4a.internal/api/chat/history?sessionId=${newSessionId}`),
    );
    const freshJson = (await fresh.json()) as { turns?: HistoryTurn[] };
    expect(fresh.status).toBe(200);
    expect(freshJson.turns?.map((turn) => turn.turnId)).toEqual(['new-turn-1']);
  });

  it('U6: 跨 principal 会话不可达 → sessions/history 均为空态(非 403/404)', async () => {
    // 读取已按 credential principal 收窄:bob 名下事件对 alice 的读取不可达。
    mocks.listEvents.mockResolvedValueOnce([]);
    mocks.listEvents.mockResolvedValueOnce([]);

    const sessions = await getSessions(new Request('https://ui4a.internal/api/chat/sessions'));
    expect(sessions.status).toBe(200);
    expect(await sessions.json()).toEqual({ sessions: [] });

    // 即使请求显式携带 bob 形状的 sessionId,history 也读不到任何回合(空态非错误)。
    const history = await getHistory(
      new Request('https://ui4a.internal/api/chat/history?sessionId=human-bob'),
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({ turns: [] });
  });
});
