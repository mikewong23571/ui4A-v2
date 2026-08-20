/**
 * agent 循环协议单测(T2 Phase D / Task D1):
 * - 循环零智能:driver 决定一切,循环只负责取实体/执行操作/记录轨迹;
 * - 终止:done / fail / maxSteps / 起始实体不可得;
 * - 拒绝即数据:exec 4xx 与 navigate 404 都作为 lastRejection 回流下一步上下文(仅一步);
 * - exec 请求体携带 rel/action/params/actor/principal/channel。
 */
import type { SirenEntity } from '@ui4a/engine';
import { describe, expect, it } from 'vitest';

import { runAgent } from './loop';
import {
  collectionEntity,
  createScriptedTransport,
  entityUrl,
  execUrl,
  instanceEntity,
  jsonResponse,
} from './testkit';
import type { AgentDriver, AgentGoal, AgentOperation, DriverContext } from './types';

const BASE = 'http://contract.test';

const GOAL: AgentGoal = { verb: '测试目标' };

const articlesEntity = collectionEntity({
  rel: 'articles',
  members: [
    { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
    { rel: 'post:first-post', flow: 'post-status', node: 'published' },
  ],
});

const postWelcomeEntity = instanceEntity({ rel: 'post:post-welcome', flow: 'post-status', node: 'published' });

/** 按脚本依次决策的 driver(耗尽后 fail,测试显式给出全部决策)。 */
class ScriptedDriver implements AgentDriver {
  readonly contexts: DriverContext[] = [];

  constructor(private readonly script: AgentOperation[]) {}

  decide(context: DriverContext): AgentOperation {
    this.contexts.push(context);
    return this.script.shift() ?? { kind: 'fail', reason: '脚本耗尽' };
  }
}

interface TransportOptions {
  entities?: Record<string, SirenEntity>;
  execResponses?: Response[];
}

/** 契同路由:GET /api/entity 查表;POST /api/exec 依次出队。 */
function contractTransport(options: TransportOptions = {}) {
  const entities = options.entities ?? {};
  const execResponses = [...(options.execResponses ?? [])];
  return createScriptedTransport((url, init) => {
    if (init?.method === 'POST' || url === execUrl(BASE)) {
      const response = execResponses.shift();
      if (response !== undefined) return response;
      return jsonResponse({ error: '脚本耗尽:无更多 exec 响应' }, 500);
    }
    const rel = new URL(url).searchParams.get('rel') ?? '';
    const entity = entities[rel];
    if (entity !== undefined) return jsonResponse(entity);
    return jsonResponse({ error: `实体 "${rel}" 不存在` }, 404);
  });
}

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

  it('超过 maxSteps 终止,结局为 max-steps', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver(
      Array.from({ length: 10 }, () => ({ kind: 'navigate', rel: 'articles' }) as AgentOperation),
    );

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      maxSteps: 5,
    });

    expect(result.outcome).toBe('max-steps');
    expect(result.steps).toHaveLength(5);
    expect(result.steps.every((step) => step.outcome === 'navigated')).toBe(true);
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

describe('navigate 操作', () => {
  it('navigate 成功后下一步的当前实体即目标;轨迹记录目标实体摘要', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:post-welcome': postWelcomeEntity },
    });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:post-welcome' },
      { kind: 'done', summary: 'ok' },
    ]);

    const result = await runAgent(driver, GOAL, {
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
