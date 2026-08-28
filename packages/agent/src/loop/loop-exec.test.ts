/**
 * agent 循环协议单测(T2 Phase D / Task D1)之场景分片(自 loop.test.ts 按 describe 拆分,
 * 行为不变):共享夹具见 ./loop-test-fixtures。
 */
import { describe, expect, it } from 'vitest';

import {
  BASE,
  GOAL,
  postWelcomeEntity,
  ScriptedDriver,
  contractTransport,
} from './loop-test-fixtures';
import { runAgent } from './loop';
import { createScriptedTransport, execUrl, instanceEntity, jsonResponse } from '../testkit/testkit';

describe('exec 操作与拒绝即数据', () => {
  it('exec 成功:POST 体携带 rel/action/params/actor/principal/channel,成功留痕', async () => {
    const transport = contractTransport({
      entities: { 'post:post-welcome': postWelcomeEntity },
      execResponses: [jsonResponse({ entity: postWelcomeEntity })],
    });
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'unpublish', params: { note: '委托' } },
      { kind: 'done', summary: 'ok' },
    ]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'post:post-welcome',
      principal: 'mike',
      channel: 'test',
    });

    const post = transport.calls.find((call) => call.url === execUrl(BASE))!;
    expect(post.method).toBe('POST');
    expect(post.body).toEqual({
      rel: 'post:post-welcome',
      action: 'unpublish',
      params: { note: '委托' },
      actor: 'agent',
      principal: 'mike',
      channel: 'test',
    });

    expect(result.steps[0]!.outcome).toBe('executed');
    expect(result.successes).toEqual([
      { rel: 'post:post-welcome', action: 'unpublish', params: { note: '委托' } },
    ]);
    expect(driver.contexts[1]!.successes).toEqual(result.successes);
  });

  it('actor/channel 缺省为 agent/http', async () => {
    const transport = contractTransport({
      entities: { 'post:post-welcome': postWelcomeEntity },
      execResponses: [jsonResponse({ entity: postWelcomeEntity })],
    });
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'unpublish' },
      { kind: 'done', summary: 'ok' },
    ]);

    await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'post:post-welcome',
    });

    const post = transport.calls.find((call) => call.url === execUrl(BASE))!;
    expect(post.body).toMatchObject({ actor: 'agent', channel: 'http' });
    expect(post.body).not.toHaveProperty('principal');
  });

  it('exec 被拒(422):lastRejection 携带 layer/reason 回流下一步,且只回流一步', async () => {
    const transport = contractTransport({
      entities: { 'post:post-welcome': postWelcomeEntity },
      execResponses: [
        jsonResponse({ layer: 'guard-failed', reason: 'guard 不满足: is-published=false' }, 422),
        jsonResponse({ entity: postWelcomeEntity }),
      ],
    });
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'unpublish' },
      { kind: 'exec', action: 'unpublish' },
      { kind: 'done', summary: 'ok' },
    ]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'post:post-welcome',
    });

    const rejectedStep = result.steps[0]!;
    expect(rejectedStep.outcome).toBe('rejected');
    expect(rejectedStep.rejection).toMatchObject({
      rel: 'post:post-welcome',
      action: 'unpublish',
      layer: 'guard-failed',
      reason: 'guard 不满足: is-published=false',
    });
    expect(driver.contexts[1]!.lastRejection).toMatchObject({ layer: 'guard-failed' });
    // 第二次 exec 成功后,第三步上下文不再携带旧拒绝(拒绝只影响紧接着的下一步)。
    expect(driver.contexts[2]!.lastRejection).toBeUndefined();
  });

  it('exec 网络故障按拒绝数据处理(原因回流),循环不崩', async () => {
    const transport = createScriptedTransport((url, init) => {
      if (init?.method === 'POST') {
        throw new Error('ECONNREFUSED');
      }
      return jsonResponse(postWelcomeEntity);
    });
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'unpublish' },
      { kind: 'fail', reason: '路已死' },
    ]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'post:post-welcome',
    });

    expect(result.outcome).toBe('failed');
    expect(result.summary).toBe('路已死');
    const step = result.steps[0]!;
    expect(step.outcome).toBe('rejected');
    expect(step.rejection?.reason).toContain('ECONNREFUSED');
    expect(driver.contexts[1]!.lastRejection?.reason).toContain('ECONNREFUSED');
    expect(result.successes).toEqual([]);
  });
});

describe('副作用来源与目标授权门(U10–U12)', () => {
  const actionable = instanceEntity({
    rel: 'post:first-post',
    flow: 'post-status',
    node: 'published',
    fields: { title: '第一篇' },
    actions: [
      {
        name: 'unpublish',
        title: '下线',
        method: 'POST',
        href: '/api/exec',
        fields: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'archive',
        title: '归档',
        method: 'POST',
        href: '/api/exec',
        fields: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
  });

  it('协议门不以 action 关键词规则替代 LLM 意图映射，只验证原话来源与目标', async () => {
    const transport = contractTransport({
      entities: { 'post:first-post': actionable },
      execResponses: [jsonResponse({ entity: actionable })],
    });
    const driver = new ScriptedDriver([
      {
        kind: 'exec',
        action: 'archive',
        authorization: { sourceMessageId: 'm1', quote: '总结第一篇文章' },
      },
      { kind: 'fail', reason: '未获授权' },
    ]);

    const result = await runAgent(
      driver,
      { verb: '总结第一篇文章' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        startRel: 'post:first-post',
        requireEffectAuthorization: true,
        conversationMessages: [{ messageId: 'm1', role: 'user', content: '总结第一篇文章' }],
      },
    );

    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(result.successes).toEqual([
      { rel: 'post:first-post', action: 'archive', params: undefined },
    ]);
    expect(result.steps[0]).toMatchObject({
      outcome: 'executed',
      op: { kind: 'exec', action: 'archive' },
    });
  });

  it('明确原话“下线第一篇”可以授权 unpublish', async () => {
    const transport = contractTransport({
      entities: { 'post:first-post': actionable },
      execResponses: [jsonResponse({ entity: actionable })],
    });
    const authorization = { sourceMessageId: 'm1', quote: '下线第一篇' };
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'unpublish', authorization },
      { kind: 'done', summary: '已下线' },
    ]);

    const result = await runAgent(
      driver,
      { verb: '下线第一篇' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        startRel: 'post:first-post',
        requireEffectAuthorization: true,
        conversationMessages: [{ messageId: 'm1', role: 'user', content: '请下线第一篇，谢谢' }],
      },
    );

    expect(result.outcome).toBe('done');
    expect(result.successes).toEqual([
      { rel: 'post:first-post', action: 'unpublish', params: undefined },
    ]);
    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('伪造 quote 不会发出 POST', async () => {
    const authorization = { sourceMessageId: 'm1', quote: '下线第二篇' };
    const action = 'unpublish';
    const rel = 'post:first-post';
    const target =
      rel === 'post:first-post'
        ? actionable
        : instanceEntity({
            rel,
            flow: 'post-status',
            node: 'published',
            fields: { title: '第二篇' },
            actions: actionable.actions,
          });
    const transport = contractTransport({
      entities: { [rel]: target },
      execResponses: [jsonResponse({ entity: target })],
    });
    const driver = new ScriptedDriver([
      { kind: 'exec', action, authorization },
      { kind: 'fail', reason: '拦截后终止' },
    ]);

    await runAgent(
      driver,
      { verb: '下线第一篇' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        startRel: rel,
        requireEffectAuthorization: true,
        conversationMessages: [{ messageId: 'm1', role: 'user', content: '请下线第一篇，谢谢' }],
      },
    );

    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('exec-plan 的计划级原话逐 step 绑定同一目标，action 语义由动态决策负责', async () => {
    const transport = contractTransport({
      entities: { 'post:first-post': actionable },
      execResponses: [jsonResponse({ plan: 'completed', results: [], entities: [] })],
    });
    const driver = new ScriptedDriver([
      {
        kind: 'exec-plan',
        steps: [
          { rel: 'post:first-post', action: 'unpublish' },
          { rel: 'post:first-post', action: 'archive' },
        ],
        authorization: { sourceMessageId: 'm1', quote: '下线第一篇' },
      },
      { kind: 'fail', reason: '计划未获完整授权' },
    ]);

    const result = await runAgent(
      driver,
      { verb: '下线第一篇' },
      {
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        startRel: 'post:first-post',
        requireEffectAuthorization: true,
        conversationMessages: [{ messageId: 'm1', role: 'user', content: '请下线第一篇' }],
      },
    );

    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      outcome: 'executed',
      op: { kind: 'exec-plan' },
    });
  });

  it('同一动作同一参数第二次被拒即机械收敛,不烧后续步数(T35 C5)', async () => {
    // exec 全部 409 拒绝(合同结构化拒绝)。
    const base = (url: string, init?: RequestInit): Response => {
      if (url === execUrl(BASE) && init?.method === 'POST') {
        return jsonResponse({ error: 'guard 不满足: is-published=false' }, 409);
      }
      return jsonResponse(postWelcomeEntity);
    };
    const scripted = createScriptedTransport(base);
    const driver = new ScriptedDriver([
      { kind: 'exec', action: 'unpublish' },
      { kind: 'exec', action: 'unpublish' },
      { kind: 'exec', action: 'unpublish' },
      { kind: 'done', summary: '不该到达' },
    ]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: scripted.fetch,
      startRel: 'post:post-welcome',
    });

    expect(result.outcome).toBe('failed');
    const rejected = result.steps.filter((step) => step.outcome === 'rejected');
    expect(rejected).toHaveLength(2);
    expect(result.steps.at(-1)?.op).toMatchObject({
      kind: 'fail',
      code: 'repeated_rejection',
      reason: expect.stringContaining('同一动作反复被拒'),
    });
    // driver 不再被询问第三遍。
    expect(driver.contexts.length).toBeLessThanOrEqual(3);
  });
});
