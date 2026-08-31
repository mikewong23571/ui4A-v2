/**
 * agent 循环协议单测(T2 Phase D / Task D1)之场景分片(自 loop.test.ts 按 describe 拆分,
 * 行为不变):共享夹具见 ./loop-test-fixtures。
 */
import { describe, expect, it } from 'vitest';

import {
  BASE,
  GOAL,
  articlesEntity,
  postWelcomeEntity,
  ScriptedDriver,
  contractTransport,
} from './loop-test-fixtures';
import { runAgent } from './loop';
import { entityUrl } from '../testkit/testkit';
import type { PresentationIntent } from '../types';

describe('薄 Presentation 请求', () => {
  it('present 作为旁路意图交给 runtime，Chat 循环可继续独立回答且零业务 POST', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const presentation: PresentationIntent = {
      subject: 'articles',
      intent: '浏览全部文章',
      constraints: ['正文摘要优先'],
      delivery: 'canvas',
    };
    const driver = new ScriptedDriver([
      { kind: 'present', ...presentation },
      { kind: 'answer', content: '已请求在画布中浏览文章。', sources: [] },
    ]);
    const requested: PresentationIntent[] = [];

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onPresentation(intent) {
        requested.push(intent);
      },
    });

    expect(result.outcome).toBe('answered');
    expect(result.steps.map((step) => step.outcome)).toEqual([
      'presentation-requested',
      'answered',
    ]);
    expect(requested).toEqual([presentation]);
    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
});

describe('navigate 操作', () => {
  it('同一用户回合可在 navigate 后进行新的 LLM decision 并以 answer 结束', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:post-welcome': postWelcomeEntity },
    });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:post-welcome' },
      {
        kind: 'answer',
        content: '现在展示欢迎文章。',
        sources: [{ rel: 'post:post-welcome', pointer: '/properties/fields' }],
      },
    ]);

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result.outcome).toBe('answered');
    expect(result.steps.map((step) => step.outcome)).toEqual(['navigated', 'answered']);
    expect(driver.contexts).toHaveLength(2);
    expect(driver.contexts[1]?.currentRel).toBe('post:post-welcome');
    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('navigate 成功后下一步的当前实体即目标;轨迹记录目标实体摘要', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:post-welcome': postWelcomeEntity },
    });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:post-welcome' },
      { kind: 'done', summary: 'ok' },
    ]);

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result.outcome).toBe('done');
    expect(driver.contexts[1]!.currentRel).toBe('post:post-welcome');
    expect(driver.contexts[1]!.entity).toEqual(postWelcomeEntity);

    const navigateStep = result.steps[0]!;
    expect(navigateStep.op).toEqual({ kind: 'navigate', rel: 'post:post-welcome' });
    expect(navigateStep.outcome).toBe('navigated');
    expect(navigateStep.entity).toMatchObject({ rel: 'post:post-welcome', node: 'published' });
    expect(
      transport.calls.filter((call) => call.url === entityUrl(BASE, 'post:post-welcome')).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('navigate 404:当前实体不变,not-found 作为 lastRejection 回流下一步', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:ghost' },
      { kind: 'done', summary: 'ok' },
    ]);

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result.outcome).toBe('done');
    const step = result.steps[0]!;
    expect(step.outcome).toBe('not-found');
    expect(step.rejection).toMatchObject({ rel: 'post:ghost', layer: 'not-found' });
    expect(driver.contexts[1]!.currentRel).toBe('articles');
    expect(driver.contexts[1]!.lastRejection).toMatchObject({ rel: 'post:ghost' });
  });
});
