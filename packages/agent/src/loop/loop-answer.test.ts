/**
 * agent 循环协议单测(T2 Phase D / Task D1)之场景分片(自 loop.test.ts 按 describe 拆分,
 * 行为不变):共享夹具见 ./loop-test-fixtures。
 */
import { describe, expect, it } from 'vitest';

import {
  BASE,
  GOAL,
  articlesEntity,
  ScriptedDriver,
  contractTransport,
} from './loop-test-fixtures';
import { runAgent } from './loop';
import { instanceEntity } from '../testkit/testkit';

describe('授权观察 → 推理 → 临时 answer(U1–U4)', () => {
  it('U1:导航到 first-post 后可依据正文 answer + source,且不发出 POST', async () => {
    const firstPost = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: {
        title: '第一篇',
        body: '这是第一篇完整文章，用来验证具体查看、正文阅读和跨刷新恢复链路。',
      },
      collection: 'articles',
    });
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:first-post': firstPost },
    });
    const source = { rel: 'post:first-post', pointer: '/properties/fields/body' };
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:first-post' },
      { kind: 'answer', content: '用于验证文章阅读与刷新恢复链路。', sources: [source] },
    ]);

    const result = await runAgent(
      driver,
      { verb: '总结第一篇文章' },
      { startRel: 'articles', baseUrl: BASE, fetchImpl: transport.fetch },
    );

    expect(result.outcome).toBe('answered');
    expect(result.summary).toContain('刷新恢复');
    expect(result.sources).toEqual([source]);
    expect(result.steps.map((step) => step.outcome)).toEqual(['navigated', 'answered']);
    expect(driver.contexts[1]?.observations?.map((entry) => entry.rel)).toEqual([
      'articles',
      'post:first-post',
    ]);
    expect(transport.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('U2:count 是可回答的合同事实,不需要 read/count action 或成功写动作', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const source = { rel: 'articles', pointer: '/properties/count' };
    const driver = new ScriptedDriver([
      { kind: 'answer', content: '当前有 2 篇文章。', sources: [source] },
    ]);

    const result = await runAgent(
      driver,
      { verb: '当前有几篇文章？' },
      { startRel: 'articles', baseUrl: BASE, fetchImpl: transport.fetch },
    );

    expect(result).toMatchObject({ outcome: 'answered', sources: [source], successes: [] });
    expect(transport.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('U3:跨实体观察保留独立来源,answer 可引用两个实体', async () => {
    const first = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第一篇', body: '验证阅读链路。' },
      collection: 'articles',
    });
    const welcome = instanceEntity({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
      fields: { title: '欢迎', body: '介绍 UI4A。' },
      collection: 'articles',
    });
    const transport = contractTransport({
      entities: {
        articles: articlesEntity,
        'post:first-post': first,
        'post:post-welcome': welcome,
      },
    });
    const sources = [
      { rel: 'post:first-post', pointer: '/properties/fields/body' },
      { rel: 'post:post-welcome', pointer: '/properties/fields/body' },
    ];
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:first-post' },
      { kind: 'navigate', rel: 'post:post-welcome' },
      { kind: 'answer', content: '前者验证阅读链路，后者介绍 UI4A。', sources },
    ]);

    const result = await runAgent(
      driver,
      { verb: '比较这两篇文章' },
      { startRel: 'articles', baseUrl: BASE, fetchImpl: transport.fetch },
    );

    expect(result.outcome).toBe('answered');
    expect(result.sources).toEqual(sources);
    expect(driver.contexts[2]?.observations?.map((entry) => entry.rel)).toEqual([
      'articles',
      'post:first-post',
      'post:post-welcome',
    ]);
  });

  it('U4:正文缺失时可诚实 answer 信息不足,仍不执行状态 action', async () => {
    const withoutBody = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第一篇' },
      actions: [
        {
          name: 'archive',
          title: '归档',
          method: 'POST',
          href: '/api/exec',
          fields: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    });
    const transport = contractTransport({ entities: { 'post:first-post': withoutBody } });
    const source = { rel: 'post:first-post', pointer: '/properties/fields' };
    const driver = new ScriptedDriver([
      { kind: 'answer', content: '当前只有标题，没有正文，无法可靠总结。', sources: [source] },
    ]);

    const result = await runAgent(
      driver,
      { verb: '总结这篇文章' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        startRel: 'post:first-post',
      },
    );

    expect(result).toMatchObject({ outcome: 'answered', successes: [], sources: [source] });
    expect(transport.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('观察账本按最近访问的不同 rel 有界保留', async () => {
    const third = instanceEntity({ rel: 'post:third', flow: 'post-status', node: 'published' });
    const transport = contractTransport({
      entities: {
        articles: articlesEntity,
        'post:first-post': instanceEntity({
          rel: 'post:first-post',
          flow: 'post-status',
          node: 'published',
        }),
        'post:third': third,
      },
    });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:first-post' },
      { kind: 'navigate', rel: 'post:third' },
      { kind: 'answer', content: '已观察最近两个实体。', sources: [] },
    ]);

    await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      maxObservations: 2,
    });

    expect(driver.contexts[2]?.observations?.map((entry) => entry.rel)).toEqual([
      'post:first-post',
      'post:third',
    ]);
  });

  it('复合目标的 answer continue=true 保留消息步并继续下一次决策', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const first = {
      kind: 'answer' as const,
      content: '先给出摘要。',
      sources: [{ rel: 'articles', pointer: '/entities/0/properties/fields' }],
      continue: true,
    };
    const final = {
      kind: 'answer' as const,
      content: '后续阶段已完成。',
      sources: [{ rel: 'articles', pointer: '/properties/count' }],
    };

    const result = await runAgent(new ScriptedDriver([first, final]), GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result.outcome).toBe('answered');
    expect(result.steps.map((step) => step.op)).toEqual([first, final]);
  });
});
