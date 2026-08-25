import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  chat,
  createOperationsLlmStub,
  eventKinds,
  chatRouteBase,
  startChatRouteFixtures,
  stopChatRouteFixtures,
} from './route-test-kit';

beforeEach(startChatRouteFixtures);
afterEach(stopChatRouteFixtures);

describe('请求形状', () => {
  it('缺 goal → 400;非法 driver → 400', async () => {
    expect((await chat({})).status).toBe(400);
    expect((await chat({ goal: { verb: '' } })).status).toBe(400);
    expect((await chat({ goal: { verb: '发布' }, driver: 'smarter' })).status).toBe(400);
  });
});

describe('T21 navigation completion audit', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;

  afterEach(() => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
  });

  it('persists a successful navigate before its client focus frame', async () => {
    const stub = await createOperationsLlmStub([
      { name: 'navigate', args: { rel: 'post:first-post' } },
      {
        name: 'answer',
        args: {
          content: '第一篇详情',
          sources: [{ rel: 'post:first-post', pointer: '/properties/fields' }],
        },
      },
    ]);
    try {
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
      process.env.LLM_MODEL = 'test-model';
      const result = await chat({
        sessionId: 't21-nav',
        goal: { verb: 'inspect' },
        clientView: {
          schemaVersion: 1,
          clientInstanceId: 'client:a',
          route: '/canvas?focus=articles',
          subject: 'articles',
        },
      });
      const focusIndex = result.frames.findIndex((frame) => frame.type === 'focus');
      expect(focusIndex).toBeGreaterThan(0);

      const body = (await (await fetch(`${chatRouteBase()}/api/events`)).json()) as {
        events: { kind: string; detail: Record<string, unknown> }[];
      };
      expect(body.events.filter((event) => event.kind === 'chat-navigation-completed')).toEqual([
        expect.objectContaining({
          detail: expect.objectContaining({
            navigationId: 'route-test-turn:navigate:1',
            source: 'agent-navigate',
            subject: 'post:first-post',
          }),
        }),
      ]);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('persists a ready/fallback Presentation receipt and never promotes pending/failed receipts', async () => {
    const stub = await createOperationsLlmStub([
      {
        name: 'present',
        args: { subject: 'articles', intent: 'browse', delivery: 'canvas' },
      },
      {
        name: 'answer',
        args: {
          content: '文章列表',
          sources: [{ rel: 'articles', pointer: '/entities' }],
        },
      },
    ]);
    try {
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
      process.env.LLM_MODEL = 'test-model';
      await chat({ sessionId: 't21-present', goal: { verb: 'browse' } });
      const body = (await (await fetch(`${chatRouteBase()}/api/events`)).json()) as {
        events: { kind: string; detail: Record<string, unknown> }[];
      };
      expect(
        body.events.filter(
          (event) =>
            event.kind === 'chat-navigation-completed' &&
            event.detail.source === 'presentation-receipt',
        ),
      ).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('rebuilds last navigation while selecting only the current message client instance', async () => {
    const stub = await createOperationsLlmStub([
      { name: 'navigate', args: { rel: 'post:first-post' } },
      {
        name: 'answer',
        args: {
          content: '详情',
          sources: [{ rel: 'post:first-post', pointer: '/properties/fields' }],
        },
      },
      {
        name: 'answer',
        args: {
          content: '当前位置',
          sources: [{ rel: 'articles', pointer: '/properties/rel' }],
        },
      },
    ]);
    try {
      process.env.LLM_API_KEY = 'test-key';
      process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
      process.env.LLM_MODEL = 'test-model';
      await chat({
        sessionId: 't21-replay',
        turnId: 'turn-a',
        goal: { verb: 'inspect' },
        clientView: {
          schemaVersion: 1,
          clientInstanceId: 'client:a',
          route: '/canvas?focus=articles',
          subject: 'articles',
        },
      });
      await chat({
        sessionId: 't21-replay',
        turnId: 'turn-b',
        goal: { verb: 'where' },
        clientView: {
          schemaVersion: 1,
          clientInstanceId: 'client:b',
          route: '/canvas?focus=articles',
          subject: 'articles',
        },
      });

      const body = (await (await fetch(`${chatRouteBase()}/api/events`)).json()) as {
        events: { kind: string; detail: { prompt?: { user?: string }; step?: number } }[];
      };
      const decisions = body.events.filter((event) => event.kind === 'agent-decision');
      const currentPrompt = decisions.at(-1)?.detail.prompt?.user ?? '';
      expect(currentPrompt).toContain('"navigationId": "turn-a:navigate:1"');
      expect(currentPrompt).toContain('"clientInstanceId": "client:b"');
      expect(currentPrompt).not.toContain('"clientInstanceId": "client:a"');
      expect(currentPrompt).toContain('本轮合同读取位置 rel(不是客户端当前页面)');
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('rejects malformed client view before appending the user message', async () => {
    const response = await chat({
      sessionId: 't21-invalid-view',
      goal: { verb: 'read' },
      clientView: {
        schemaVersion: 1,
        clientInstanceId: 'client:a',
        route: 'https://evil.example/canvas',
      },
    });
    expect(response.status).toBe(400);
    expect(response.json.error).toContain('clientView 无效');
    expect(await eventKinds()).toEqual([]);
  });
});
