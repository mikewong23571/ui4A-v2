import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chat,
  createScriptedLlmStub,
  publishingApplicationView,
  pool,
  PUBLISH_TEST_AUTHORIZATION,
  PUBLISH_TEST_GOAL,
  chatRouteBase,
  startChatRouteFixtures,
  stopChatRouteFixtures,
} from './route-test-kit';

beforeEach(startChatRouteFixtures);
afterEach(stopChatRouteFixtures);

describe('T11 Phase B:agent-decision 审计事件(inline 每步决策一条)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
  });

  /** agent-decision 事件行(只取本测试关心的字段)。 */
  interface DecisionEvent {
    seq: number;
    rel: string;
    actor: string;
    channel: string;
    principal: string;
    detail: {
      step: number;
      driver: string;
      prompt: unknown;
      reasoning: string | null;
      op: { kind: string; action?: string; params?: Record<string, unknown>; summary?: string };
    };
  }

  async function decisionsOf(sessionId: string): Promise<DecisionEvent[]> {
    const response = await fetch(`${chatRouteBase()}/api/events`);
    const body = (await response.json()) as { events: (DecisionEvent & { kind: string })[] };
    return body.events.filter(
      (event) => event.kind === 'agent-decision' && event.rel === `chat:${sessionId}`,
    );
  }

  it('llm 回合(mock 端点):每步一条,prompt 为 system/user 全量原文,reasoning 填真值(T11 Phase C)', async () => {
    const stub = await createScriptedLlmStub();
    try {
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
      process.env.LLM_MODEL = 'test-model';

      const { json } = await chat({
        sessionId: 'sess-decision-llm',
        driver: 'llm',
        clientView: publishingApplicationView('client:sess-decision-llm'),
        goal: {
          verb: PUBLISH_TEST_GOAL,
          fields: { title: 't', category: 'tech', tags: '', body: 'b' },
        },
      });
      expect(json.outcome).toBe('done');
      expect(json.driver).toBe('llm');

      const decisions = await decisionsOf('sess-decision-llm');
      expect(decisions.map((event) => event.detail.step)).toEqual([1, 2]);
      for (const event of decisions) {
        expect(event).toMatchObject({
          actor: 'agent',
          channel: 'chat',
          principal: 'user:sess-decision-llm',
        });
        expect(event.detail.driver).toBe('llm');
      }
      // reasoning 真值(T11 Phase C):driver 经 raw 部件解析 delta.reasoning_content,
      // 由审计包装器的 sink 捕获落库——两步各携该步自述。
      expect(decisions[0]!.detail.reasoning).toBe('先补标题,再推进向导');
      expect(decisions[1]!.detail.reasoning).toBe('字段已齐,收尾收工');
      expect(decisions[0]!.detail.op).toEqual({
        kind: 'exec',
        action: 'next',
        params: { title: 'LLM 决策的标题' },
        authorization: PUBLISH_TEST_AUTHORIZATION,
      });
      expect(decisions[1]!.detail.op).toEqual({ kind: 'done', summary: 'LLM 完成' });
      // prompt 全量(架构决定 3:训练提取免回放重建)——system 为协议核心原文,
      // user 内嵌目标 JSON;端点不返回 reasoning 时如实 null(验收 4)。
      const prompt = decisions[0]!.detail.prompt as { system: string; user: string };
      expect(prompt.system).toContain('UI4A 合同 agent');
      expect(prompt.user).toContain(PUBLISH_TEST_GOAL);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('agent-decision 落库失败不阻断响应(同 chat-turn 口径)', async () => {
    const stub = await createScriptedLlmStub();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
    // 注入 PG 触发器让 agent-decision 的 INSERT 抛错(其它 kind 不受影响)——
    // 审计写失败只 console.error,回合照常完成且 chat-turn 仍落库。
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_reject_agent_decision() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test 注入:agent-decision 写入故障'; END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS test_reject_agent_decision ON events;
      CREATE TRIGGER test_reject_agent_decision
        BEFORE INSERT ON events FOR EACH ROW
        WHEN (NEW.kind = 'agent-decision')
        EXECUTE FUNCTION test_reject_agent_decision();
    `);
    try {
      const { status, json } = await chat({
        sessionId: 'sess-decision-fail',
        driver: 'llm',
        clientView: publishingApplicationView('client:sess-decision-fail'),
        goal: {
          verb: PUBLISH_TEST_GOAL,
          fields: { title: '写失败', category: 'essay', tags: '', body: '正文' },
        },
      });
      expect(status).toBe(200);
      expect(json.outcome).toBe('done');
      expect((json.steps ?? []).length).toBeGreaterThan(0);

      // 审计事件缺失(写失败),但 chat-turn 回合投影照常落库——响应才是合同。
      expect(await decisionsOf('sess-decision-fail')).toHaveLength(0);
      const response = await fetch(`${chatRouteBase()}/api/events`);
      const body = (await response.json()) as { events: { kind: string; rel: string }[] };
      expect(
        body.events.some(
          (event) => event.kind === 'chat-turn' && event.rel === 'chat:sess-decision-fail',
        ),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      await pool.query(`
        DROP TRIGGER IF EXISTS test_reject_agent_decision ON events;
        DROP FUNCTION IF EXISTS test_reject_agent_decision;
      `);
    }
  });
});

describe('T11 Phase C Task 2:thinking 帧(SSE 推理自述管道)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
  });

  it('llm 回合(mock 端点产 reasoning):thinking 帧携整段自述,先于同号 step 帧', async () => {
    const stub = await createScriptedLlmStub();
    try {
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
      process.env.LLM_MODEL = 'test-model';

      const { json, frames } = await chat({
        sessionId: 'sess-thinking-llm',
        driver: 'llm',
        clientView: publishingApplicationView('client:sess-thinking-llm'),
        goal: {
          verb: PUBLISH_TEST_GOAL,
          fields: { title: 't', category: 'tech', tags: '', body: 'b' },
        },
      });
      expect(json.outcome).toBe('done');
      expect(json.driver).toBe('llm');

      // 帧型序列(D22:reasoning 末尾齐发 → 整段一次性帧,逐步决策前推送即
      // 「先于同号 step 帧」):每步 thinking → step,final 收尾。
      expect(frames.filter((frame) => frame.type !== 'session').map((frame) => frame.type)).toEqual(
        ['thinking', 'focus', 'step', 'thinking', 'step', 'final'],
      );
      const thinking = frames.filter((frame) => frame.type === 'thinking');
      expect(thinking.every((frame) => frame.turnId === 'route-test-turn')).toBe(true);
      // 整段聚合:与脚本桩的 reasoning_content 逐字等值,步号从 1 递增。
      expect(thinking.map((frame) => [frame.step, frame.text])).toEqual([
        [1, '先补标题,再推进向导'],
        [2, '字段已齐,收尾收工'],
      ]);
      // step 号与对应 step 帧一致(便于客户端归步):第 N 条 thinking 紧贴
      // 第 N 条 step 之前。
      const stepFrames = frames.filter((frame) => frame.type === 'step');
      expect(stepFrames.every((frame) => frame.turnId === 'route-test-turn')).toBe(true);
      const final = frames.find((frame) => frame.type === 'final');
      expect(final?.turnId).toBe('route-test-turn');
      expect(final?.payload?.turnId).toBe('route-test-turn');
      thinking.forEach((frame, index) => {
        expect(frames.indexOf(frame)).toBeLessThan(frames.indexOf(stepFrames[index]!));
      });
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });
});
