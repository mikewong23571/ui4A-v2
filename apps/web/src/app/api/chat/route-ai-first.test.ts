import { type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  articleCount,
  chat,
  createPublishingLlmStub,
  createUnauthorizedStub,
  eventKinds,
  PUBLISH_TEST_GOAL,
  chatRouteBase,
  startChatRouteFixtures,
  stopChatRouteFixtures,
} from './route-test-kit';

beforeEach(startChatRouteFixtures);
afterEach(stopChatRouteFixtures);

describe('T15 U22:product chat runtime is AI-first', () => {
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

  it('rejects the removed product rule driver without creating events', async () => {
    const response = await chat({ goal: { verb: PUBLISH_TEST_GOAL }, driver: 'rule' });

    expect(response.status).toBe(400);
    expect(response.json.error).toContain('rule driver 已退出产品运行时');
    expect(await eventKinds()).toEqual([]);
  });

  it.each([
    ['default', undefined],
    ['auto', 'auto'],
    ['llm', 'llm'],
  ] as const)(
    '%s request reports missing LLM config and never mutates business state',
    async (_, driver) => {
      const before = await articleCount();
      const response = await chat({
        sessionId: `u22-${driver ?? 'default'}`,
        goal: { verb: PUBLISH_TEST_GOAL },
        ...(driver === undefined ? {} : { driver }),
      });

      expect(response.status).toBe(200);
      expect(response.contentType).toContain('text/event-stream');
      expect(response.json).toMatchObject({
        driver: 'llm',
        requestedDriver: driver ?? 'auto',
        outcome: 'failed',
      });
      expect(response.json.summary).toContain('LLM 不可用');
      expect(response.json.summary).toContain('LLM_API_KEY, LLM_BASE_URL, LLM_MODEL');
      expect(response.json.summary).toContain('配置后可重试');
      expect(await articleCount()).toBe(before);
      expect(await eventKinds()).not.toContain('action-executed');
    },
  );

  it('does not bypass an unavailable LLM through a deterministic chat render shortcut', async () => {
    const response = await chat({
      sessionId: 'u22-render-unavailable',
      goal: { verb: '按分类展示文章' },
    });

    expect(response.json).toMatchObject({ driver: 'llm', outcome: 'failed' });
    expect(response.json.summary).toContain('LLM 不可用');
    expect(await eventKinds()).not.toContain('render-spec-frozen');
    expect(await eventKinds()).not.toContain('action-executed');
  });

  it('rejects delegated work before dispatch when the LLM profile is unavailable', async () => {
    const response = await chat({
      sessionId: 'u22-delegated-unavailable',
      mode: 'delegated',
      goal: { verb: PUBLISH_TEST_GOAL },
    });

    expect(response.status).toBe(503);
    expect(response.contentType).toContain('application/json');
    expect(response.json).toMatchObject({ driver: 'llm', outcome: 'failed' });
    expect(response.json.error).toContain('LLM 不可用');
    expect(await eventKinds()).not.toContain('delegation-requested');
    expect(await eventKinds()).not.toContain('action-executed');
  });
});

describe('AI-first 路由循环:配置 LLM 完成 B1', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;
  let stub: Server & { port(): number };

  beforeEach(async () => {
    stub = await createPublishingLlmStub();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
  });

  afterEach(async () => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  it('default/auto → llm:发布目标三步填充 + publish,文章计数 2→3', async () => {
    expect(await articleCount()).toBe(2);

    const { status, json } = await chat({
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: {
          title: 'chat 的第三篇',
          category: 'tech',
          tags: 'chat',
          body: '第三篇正文:由 chat 路由(LLM)发布。',
        },
      },
    });

    expect(status).toBe(200);
    expect(json.driver).toBe('llm');
    expect(json.outcome, JSON.stringify(json.messages)).toBe('done');

    const trajectory = (json.messages ?? []).map((message) => message.text).join('\n');
    expect(trajectory.match(/执行 next/g)).toHaveLength(3);
    expect(trajectory).toContain('执行 publish');
    expect(trajectory).toContain('完成');

    expect(await articleCount()).toBe(3);
  });

  it('事件日志:chat 循环的 exec 带 actor=agent、channel=chat、principal', async () => {
    await chat({
      sessionId: 'sess-42',
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: { title: '留痕', category: 'essay', tags: '', body: '正文' },
      },
    });

    const response = await fetch(`${chatRouteBase()}/api/events`);
    const body = (await response.json()) as {
      events: { kind: string; actor: string; channel: string; principal: string }[];
    };
    const publish = body.events.filter(
      (event) =>
        event.kind === 'action-executed' &&
        (event as unknown as { action: string }).action === 'publish',
    );
    expect(publish).toHaveLength(1);
    expect(publish[0]).toMatchObject({
      actor: 'agent',
      channel: 'chat',
      principal: 'user:sess-42',
    });
  });

  it('SSE 帧协议:step 帧逐步先于 final,文本为 stepToMessage 口径', async () => {
    const { raw, frames, json, contentType } = await chat({
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: { title: '帧序', category: 'tech', tags: '', body: '正文' },
      },
    });

    expect(contentType).toContain('text/event-stream');
    // 帧序:若干 step → 恰好一条 final 收尾;终帧前无 final。
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[frames.length - 1]!.type).toBe('final');
    expect(
      frames
        .slice(0, -1)
        .every(
          (frame) => frame.type === 'step' || frame.type === 'session' || frame.type === 'focus',
        ),
    ).toBe(true);
    // step 帧文本口径与 trail.ts 一致(e2e 同一断言锚点)。
    const trajectory = frames
      .filter((frame) => frame.type === 'step')
      .map((frame) => frame.message!.text)
      .join('\n');
    expect(trajectory.match(/执行 next/g)).toHaveLength(3);
    expect(trajectory).toContain('执行 publish');
    expect(trajectory).toContain('完成');
    const refreshFocuses = frames.filter(
      (frame) => frame.type === 'focus' && frame.refresh === true,
    );
    expect(refreshFocuses).toHaveLength(4);
    expect(refreshFocuses.at(-1)?.rel).toBe('flow:article-drafting');
    expect(raw).toContain('data: ');
    expect(json.outcome).toBe('done');
  });

  it('chat-turn 落日志(T9 Phase B):inline 回合完成直写事件,rel=chat:<sessionId>', async () => {
    const { json } = await chat({
      sessionId: 'sess-turn',
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: { title: '回合留痕', category: 'essay', tags: '', body: '正文' },
      },
    });
    expect(json.outcome).toBe('done');

    const response = await fetch(`${chatRouteBase()}/api/events`);
    const body = (await response.json()) as {
      events: {
        kind: string;
        rel: string;
        actor: string;
        channel: string;
        principal: string;
        detail: {
          sessionId: string;
          goal: { verb: string };
          outcome: string;
          messages: { role: string; text: string }[];
          driver: string;
        };
      }[];
    };
    const turns = body.events.filter((event) => event.kind === 'chat-turn');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      rel: 'chat:sess-turn',
      actor: 'agent',
      channel: 'chat',
      principal: 'user:sess-turn',
    });
    expect(turns[0]!.detail.sessionId).toBe('sess-turn');
    expect(turns[0]!.detail.goal.verb).toBe(PUBLISH_TEST_GOAL);
    expect(turns[0]!.detail.outcome).toBe('done');
    expect(turns[0]!.detail.driver).toBe('llm');
    expect(turns[0]!.detail.messages.map((message) => message.text).join('\n')).toContain(
      '执行 publish',
    );
  });

  it('chat-turn detail 含结构化 steps(T11 Phase B):与回合 trail 逐条等值', async () => {
    const { json } = await chat({
      sessionId: 'sess-steps',
      goal: {
        verb: PUBLISH_TEST_GOAL,
        fields: { title: '结构化留痕', category: 'tech', tags: '', body: '正文' },
      },
    });
    expect(json.outcome).toBe('done');

    const response = await fetch(`${chatRouteBase()}/api/events`);
    const body = (await response.json()) as {
      events: {
        kind: string;
        rel: string;
        detail: {
          messages: { role: string; text: string }[];
          steps: {
            step: number;
            rel: string;
            op: { kind: string; action?: string; summary?: string };
            outcome: string;
          }[];
        };
      }[];
    };
    const turns = body.events.filter(
      (event) => event.kind === 'chat-turn' && event.rel === 'chat:sess-steps',
    );
    expect(turns).toHaveLength(1);
    const { steps, messages } = turns[0]!.detail;
    // 结构化原料与 final 帧载荷的 trail(result.steps)逐条等值——
    // messages 是人读投影,steps 是同一轨迹的机器可读原料(架构决定 2)。
    expect(steps).toEqual(json.steps);
    expect(steps.length).toBeGreaterThan(0);
    // done 结局无 max-steps 补条:steps 与 messages 一步一条对应。
    expect(steps).toHaveLength(messages.length);
    expect(steps[0]!.op.kind, '首步是协议操作(navigate 或直接 exec)').toMatch(/^(navigate|exec)$/);
    expect(steps[steps.length - 1]!.op.kind).toBe('done');
    expect(
      steps.filter((step) => step.op.kind === 'exec' && step.op.action === 'next'),
    ).toHaveLength(3);
    expect(steps.some((step) => step.op.kind === 'exec' && step.op.action === 'publish')).toBe(
      true,
    );
    expect(
      steps.every((step) => typeof step.step === 'number' && typeof step.rel === 'string'),
    ).toBe(true);
  });
});

describe('B4(路由级):坏 key → 401 原文进对话,route 不 5xx', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;
  let stub: Server & { port(): number };

  beforeEach(async () => {
    stub = await createUnauthorizedStub();
    process.env.LLM_API_KEY = 'invalid-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
  });

  afterEach(async () => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  it('llm driver 401 → 200 响应携带失败轨迹与 401 原文', async () => {
    const before = await articleCount();
    const { status, json } = await chat({
      goal: { verb: PUBLISH_TEST_GOAL },
      driver: 'llm',
    });

    expect(status).toBe(200); // 委托不崩溃:拒绝/失败也是合同的一部分
    expect(json.outcome).toBe('failed');
    expect(json.driver).toBe('llm');
    const trajectory = JSON.stringify(json);
    expect(trajectory).toContain('401');
    expect(trajectory).toContain('令牌无效或已过期');
    expect(await articleCount()).toBe(before);
    expect(await eventKinds()).not.toContain('action-executed');
  });

  it('同一 session 再发一次:循环存活,行为一致', async () => {
    const first = await chat({ goal: { verb: PUBLISH_TEST_GOAL }, sessionId: 'b4', driver: 'llm' });
    expect(first.status).toBe(200);

    const second = await chat({
      goal: { verb: PUBLISH_TEST_GOAL },
      sessionId: 'b4',
      driver: 'llm',
    });
    expect(second.status).toBe(200);
    expect(second.json.outcome).toBe('failed');
    expect(JSON.stringify(second.json)).toContain('401');
  });
});
