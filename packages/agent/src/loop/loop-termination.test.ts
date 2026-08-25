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
  AsyncScriptedDriver,
  contractTransport,
} from './loop-test-fixtures';
import { runAgent } from './loop';
import { instanceEntity, jsonResponse } from '../testkit/testkit';
import type { AgentOperation } from '../types';

describe('循环终止', () => {
  it('driver 返回 done 即终止,轨迹含终步与 summary', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'done', summary: '目标完成' }]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('目标完成');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.op).toEqual({ kind: 'done', summary: '目标完成' });
    expect(result.steps[0]!.outcome).toBe('done');
  });

  it('起始 rel 缺省 articles;第一步上下文携带该实体', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    expect(driver.contexts[0]!.currentRel).toBe('articles');
    expect(driver.contexts[0]!.entity).toEqual(articlesEntity);
    expect(driver.contexts[0]!.trail).toEqual([]);
    expect(driver.contexts[0]!.successes).toEqual([]);
  });

  it('异步 decide(LLM driver 形态)同样被循环接受', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new AsyncScriptedDriver([{ kind: 'done', summary: '异步完成' }]);

    const result = await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    expect(result.outcome).toBe('done');
    expect(result.summary).toBe('异步完成');
  });

  it('driver 返回 fail 即终止并携带原因', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'fail', reason: '无路可走' }]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result.outcome).toBe('failed');
    expect(result.summary).toBe('无路可走');
    expect(result.steps[0]!.outcome).toBe('failed');
  });

  it('exec 202 是挂起而非拒绝：单次提案后停止等待人类确认', async () => {
    const actionable = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      actions: [
        {
          name: 'archive',
          title: '归档',
          method: 'POST',
          href: '/api/exec',
          fields: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
      collection: 'articles',
    });
    const transport = contractTransport({
      entities: { 'post:first-post': actionable },
      execResponses: [
        jsonResponse({ status: 'suspended', confirmation: { rel: 'confirmation:c1' } }, 202),
      ],
    });
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'archive', params: {} },
      { kind: 'exec', action: 'archive', params: {} },
    ]);

    const result = await runAgent(
      driver,
      { verb: '把 first-post 归档' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        startRel: 'post:first-post',
      },
    );

    expect(result.outcome).toBe('suspended');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.outcome).toBe('suspended');
    expect(result.successes).toEqual([]);
    expect(result.summary).toContain('confirmation:c1');
    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('exec-plan 一次 HTTP 裁决完整计划，并把分步成功纳入 done 原料', async () => {
    const steps = [
      { rel: 'article-drafting:main', action: 'next', params: { title: '批量测试' } },
      { rel: 'article-drafting:main', action: 'publish', params: { title: '批量测试' } },
    ];
    const transport = contractTransport({
      entities: { articles: articlesEntity },
      execResponses: [jsonResponse({ plan: 'completed', results: [], entities: [] })],
    });
    const driver = new ScriptedDriver([
      { kind: 'exec-plan', steps },
      { kind: 'done', summary: '批量完成' },
    ]);

    const result = await runAgent(
      driver,
      { verb: '一次走完发布向导' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
      },
    );

    expect(result.outcome).toBe('done');
    expect(result.steps.map((step) => step.op.kind)).toEqual(['exec-plan', 'done']);
    expect(result.successes).toEqual(steps);
    const posts = transport.calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`${BASE}/api/exec-plan`);
  });

  it('exec-plan 拒绝把失败步的 reason 与逐步报告回流给下一轮', async () => {
    const results = [
      { step: 1, rel: 'article-drafting:main', action: 'next', outcome: 'executed' },
      {
        step: 2,
        rel: 'article-drafting:main',
        action: 'next',
        outcome: 'rejected',
        reason: '参数不符合动作字段 schema',
        detail: {
          layer: 'schema-invalid',
          judge: [{ message: "must have required property 'body'" }],
        },
      },
    ];
    const transport = contractTransport({
      entities: { articles: articlesEntity },
      execResponses: [jsonResponse({ plan: 'rejected', results, entities: [] })],
    });
    const driver = new ScriptedDriver([
      {
        kind: 'exec-plan',
        steps: [{ rel: 'article-drafting:main', action: 'next', params: { content: '正文' } }],
      },
      { kind: 'fail', reason: '已收到具体拒绝' },
    ]);

    await runAgent(
      driver,
      { verb: '一次走完发布向导' },
      { baseUrl: BASE, fetchImpl: transport.fetch },
    );

    expect(driver.contexts[1]?.lastRejection).toMatchObject({
      layer: 'plan',
      reason: '参数不符合动作字段 schema',
      detail: { results },
    });
  });

  it('超过 maxSteps 终止,结局为 max-steps', async () => {
    const actionable = instanceEntity({
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'basic-info',
      actions: [
        {
          name: 'next',
          title: '下一步',
          method: 'POST',
          href: '/api/exec',
          fields: { type: 'object', properties: {}, additionalProperties: true },
        },
      ],
      collection: 'articles',
    });
    const transport = contractTransport({
      entities: { 'article-drafting:main': actionable },
      execResponses: Array.from({ length: 5 }, () => jsonResponse({ entity: actionable })),
    });
    const driver = new ScriptedDriver(
      Array.from(
        { length: 10 },
        (_, index) =>
          ({ kind: 'exec', action: 'next', params: { title: `文章${index}` } }) as AgentOperation,
      ),
    );

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'article-drafting:main',
      maxSteps: 5,
    });

    expect(result.outcome).toBe('max-steps');
    expect(result.steps).toHaveLength(5);
    expect(result.steps.every((step) => step.outcome === 'executed')).toBe(true);
  });

  it('同一无进展合同处境第三次出现时机械失败,不等到 maxSteps', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:post-welcome': postWelcomeEntity },
    });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:post-welcome' },
      { kind: 'navigate', rel: 'articles' },
      { kind: 'navigate', rel: 'post:post-welcome' },
      { kind: 'navigate', rel: 'articles' },
      { kind: 'navigate', rel: 'post:post-welcome' },
    ]);

    const result = await runAgent(
      driver,
      { verb: '删除所有文章' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        maxSteps: 24,
      },
    );

    expect(result.outcome).toBe('failed');
    expect(result.steps).toHaveLength(5);
    expect(result.steps.at(-1)?.op).toMatchObject({
      kind: 'fail',
      reason: expect.stringContaining('无进展导航循环'),
      evidence: expect.arrayContaining(['重复处境:articles']),
    });
    // T24 Phase B Task 3(失败措辞分层):机械终止携带结构化 code 供上层
    // 组装 {code, evidence, tried};driver 自述 fail 无 code(上层归 driver_fail)。
    expect(result.steps.at(-1)?.op).toMatchObject({ code: 'no_progress_loop' });
  });

  it('driver 自述 fail 不携带 code(结构化 code 是循环机械终止的属性)', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'fail', reason: '无路可走' }]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result.outcome).toBe('failed');
    expect(result.steps[0]!.op).not.toHaveProperty('code');
  });

  it('起始实体不可得(404)立即失败并说明 rel', async () => {
    const transport = contractTransport({});
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'ghost',
    });

    expect(result.outcome).toBe('failed');
    expect(result.summary).toContain('ghost');
    expect(result.steps).toEqual([]);
    expect(driver.contexts).toHaveLength(0);
  });
});
