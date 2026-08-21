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
import { createRuleDriver } from './rule-driver';
import {
  collectionEntity,
  createScriptedTransport,
  entityUrl,
  execUrl,
  instanceEntity,
  jsonResponse,
} from './testkit';
import type {
  AgentDriver,
  AgentGoal,
  AgentOperation,
  DecideSink,
  DriverContext,
  TrailStep,
} from './types';

const BASE = 'http://contract.test';

const GOAL: AgentGoal = { verb: '测试目标' };

const articlesEntity = collectionEntity({
  rel: 'articles',
  members: [
    { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
    { rel: 'post:first-post', flow: 'post-status', node: 'published' },
  ],
});

const postWelcomeEntity = instanceEntity({
  rel: 'post:post-welcome',
  flow: 'post-status',
  node: 'published',
});

/** 按脚本依次决策的 driver(耗尽后 fail,测试显式给出全部决策)。 */
class ScriptedDriver implements AgentDriver {
  readonly contexts: DriverContext[] = [];

  constructor(private readonly script: AgentOperation[]) {}

  decide(context: DriverContext): AgentOperation {
    this.contexts.push(context);
    return this.script.shift() ?? { kind: 'fail', reason: '脚本耗尽' };
  }
}

/** 异步决策 driver(Phase E:LLM driver 的 decide 是异步的,循环须 await)。 */
class AsyncScriptedDriver implements AgentDriver {
  constructor(private readonly script: AgentOperation[]) {}

  decide(context: DriverContext): Promise<AgentOperation> {
    void context; // 与 ScriptedDriver 对齐:刻意不读上下文
    return Promise.resolve(this.script.shift() ?? { kind: 'fail', reason: '脚本耗尽' });
  }
}

interface TransportOptions {
  entities?: Record<string, SirenEntity>;
  execResponses?: Response[];
  /** 在场时按 /.well-known/ui4a.json 响应(缺省 404,等价端点缺失)。 */
  sitemap?: unknown;
}

/** 契同路由:GET sitemap/entity 查表;POST /api/exec 依次出队。 */
function contractTransport(options: TransportOptions = {}) {
  const entities = options.entities ?? {};
  const execResponses = [...(options.execResponses ?? [])];
  return createScriptedTransport((url, init) => {
    if (init?.method === 'POST' || url === execUrl(BASE)) {
      const response = execResponses.shift();
      if (response !== undefined) return response;
      return jsonResponse({ error: '脚本耗尽:无更多 exec 响应' }, 500);
    }
    if (options.sitemap !== undefined && url.endsWith('/.well-known/ui4a.json')) {
      return jsonResponse(options.sitemap);
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

describe('onStep 流式轨迹回调(T9 Phase B)', () => {
  it('navigate/exec/done 每次 trail.push 后同步回调,顺序与最终轨迹一致', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:post-welcome': postWelcomeEntity },
      execResponses: [jsonResponse({ entity: postWelcomeEntity })],
    });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:post-welcome' },
      { kind: 'exec', action: 'unpublish' },
      { kind: 'done', summary: 'ok' },
    ]);
    const seen: TrailStep[] = [];

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onStep: (step) => seen.push(step),
    });

    expect(seen.map((step) => step.outcome)).toEqual(['navigated', 'executed', 'done']);
    expect(seen).toEqual(result.steps);
  });

  it('fail/not-found/rejected 各结局同样回调;观测者抛错不中断循环', async () => {
    const transport = contractTransport({
      entities: { 'post:post-welcome': postWelcomeEntity },
      execResponses: [
        jsonResponse({ layer: 'guard-failed', reason: 'guard 不满足' }, 422),
        jsonResponse({ entity: postWelcomeEntity }),
      ],
    });
    const driver = new ScriptedDriver([
      { kind: 'navigate', rel: 'post:ghost' },
      { kind: 'exec', action: 'unpublish' },
      { kind: 'exec', action: 'unpublish' },
      { kind: 'fail', reason: '收尾' },
    ]);
    const seen: string[] = [];

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'post:post-welcome',
      onStep: (step) => {
        seen.push(step.outcome);
        // 观测者异常(SSE 客户端断开等)不得污染协议循环。
        throw new Error('观察者爆炸');
      },
    });

    expect(seen).toEqual(['not-found', 'rejected', 'executed', 'failed']);
    expect(result.outcome).toBe('failed');
    expect(result.summary).toBe('收尾');
    expect(result.steps.map((step) => step.outcome)).toEqual(seen);
  });

  it('起始实体不可得(零轨迹步)不回调', async () => {
    const transport = contractTransport({});
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);
    const seen: TrailStep[] = [];

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'ghost',
      onStep: (step) => seen.push(step),
    });

    expect(result.outcome).toBe('failed');
    expect(seen).toEqual([]);
  });
});

// ---- 静态上下文:sitemap 按 app 分组(T10 Phase D / Task D1)------------------

/** 与 /.well-known/ui4a.json 真实输出同形的分组 sitemap(T10 Phase C 形状)。 */
const groupedSitemapBody = {
  version: 'v-apps',
  surfaces: [
    { rel: 'articles', title: '文章集合', app: 'publishing' },
    { rel: 'comments', title: '评论队列', app: 'community' },
  ],
  flows: [
    { name: 'article-drafting', title: '文章发布向导', app: 'publishing' },
    { name: 'comment-moderation', title: '评论审核', app: 'community' },
  ],
  applications: [
    {
      name: 'publishing',
      title: '发布',
      intent: '内容起草与发布',
      flows: [{ name: 'article-drafting', title: '文章发布向导', app: 'publishing' }],
    },
    {
      name: 'community',
      title: '社区',
      intent: '评论审核与社区互动',
      flows: [{ name: 'comment-moderation', title: '评论审核', app: 'community' }],
    },
  ],
};

describe('静态上下文:sitemap 按 app 分组呈现(T10 Phase D)', () => {
  it('applications 分组进入 DriverContext:name/intent 在场,组内 flows 摘要齐全,扁平 surfaces 保留', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity },
      sitemap: groupedSitemapBody,
    });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    const sitemap = driver.contexts[0]!.sitemap;
    expect(sitemap?.version).toBe('v-apps');
    // 两层发现第一层:app 分组与 intent 在场(选 app → 选 flow)。
    expect(sitemap?.applications.map((app) => app.name)).toEqual(['publishing', 'community']);
    const publishing = sitemap?.applications.find((app) => app.name === 'publishing');
    expect(publishing?.intent).toBe('内容起草与发布');
    expect(publishing?.flows).toEqual([{ name: 'article-drafting', title: '文章发布向导' }]);
    // 扁平信息保留(向后兼容:既有消费方零改动)。
    expect(sitemap?.surfaces.map((surface) => surface.rel)).toEqual(['articles', 'comments']);
  });

  it('旧形状 sitemap(无 applications 字段)→ 分组为空数组,扁平 surfaces 照常', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity },
      sitemap: { version: 'v-flat', surfaces: [{ rel: 'articles', title: '文章集合' }] },
    });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    const sitemap = driver.contexts[0]!.sitemap;
    expect(sitemap?.version).toBe('v-flat');
    expect(sitemap?.applications).toEqual([]);
    expect(sitemap?.surfaces).toEqual([{ rel: 'articles', title: '文章集合' }]);
  });
});

describe('role/app 上下文槽位:数据注入路径(T10 Phase D)', () => {
  it('RunAgentOptions 提供 role/app → 每步 DriverContext 原样携带', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      role: '内容审核员',
      app: 'community',
    });

    expect(driver.contexts[0]!.role).toBe('内容审核员');
    expect(driver.contexts[0]!.app).toBe('community');
  });

  it('空槽(未提供)→ DriverContext 的 role/app 缺席(零行为变化)', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    expect(driver.contexts[0]!.role).toBeUndefined();
    expect(driver.contexts[0]!.app).toBeUndefined();
  });
});

// ---- onReasoning 推理自述回调(T11 Phase C / 架构决定 4)--------------------

/** 模拟 llm driver 的 reasoning 产出:decide 时经 sink 回调聚合整段自述。 */
class ReasoningDriver implements AgentDriver {
  constructor(private readonly script: AgentOperation[]) {}

  decide(context: DriverContext, sink?: DecideSink): AgentOperation {
    void context; // 与 ScriptedDriver 对齐:刻意不读上下文
    sink?.onReasoning?.('推理自述:先核对目标,再调用工具');
    return this.script.shift() ?? { kind: 'fail', reason: '脚本耗尽' };
  }
}

describe('onReasoning 推理自述回调(T11 Phase C)', () => {
  it('driver 产 reasoning → 循环逐步经 sink 回调给 options.onReasoning(每步一次)', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity, 'post:post-welcome': postWelcomeEntity },
    });
    const driver = new ReasoningDriver([
      { kind: 'navigate', rel: 'post:post-welcome' },
      { kind: 'done', summary: 'ok' },
    ]);
    const seen: string[] = [];

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onReasoning: (text) => seen.push(text),
    });

    expect(result.outcome).toBe('done');
    expect(seen).toEqual(['推理自述:先核对目标,再调用工具', '推理自述:先核对目标,再调用工具']);
  });

  it('onReasoning 抛错不中断循环(观测者不得污染协议,同 onStep 口径)', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ReasoningDriver([{ kind: 'done', summary: 'ok' }]);

    const result = await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onReasoning: () => {
        throw new Error('观测者爆炸');
      },
    });

    expect(result.outcome).toBe('done');
    expect(result.steps).toHaveLength(1);
  });

  it('rule driver 零回调(机械层无推理自述;端到端循环级证据)', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const seen: string[] = [];

    const result = await runAgent(createRuleDriver(), { verb: 'zzqqx 无交集' }, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onReasoning: (text) => seen.push(text),
    });

    // 自由漫游无路 → fail 收尾;全程 reasoning 回调零次。
    expect(result.outcome).toBe('failed');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(seen).toEqual([]);
  });
});
