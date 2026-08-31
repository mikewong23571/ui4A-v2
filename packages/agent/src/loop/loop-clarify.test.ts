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
import { createRuleDriver } from '../testkit/rule-driver';
import type { AgentDriver, AgentOperation, DecideSink, DriverContext } from '../types';

describe('clarify 协议终态', () => {
  it('澄清终止本次 run，保留原目标延续且零 HTTP 写入', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const continuation = { verb: '总结用户指定的文章' };
    const driver = new ScriptedDriver([
      { kind: 'clarify', question: '你指的是哪一篇文章？', continuation },
      { kind: 'fail', reason: '不应进入下一步' },
    ]);

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
    });

    expect(result).toMatchObject({
      outcome: 'clarification-needed',
      summary: '你指的是哪一篇文章？',
      continuation,
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ outcome: 'clarification-needed' });
    expect(transport.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
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

/** 模拟增量通道的 llm driver:decide 时逐片回调 onReasoningDelta + 聚合终态。 */
class ReasoningDeltaDriver implements AgentDriver {
  constructor(private readonly script: AgentOperation[]) {}

  decide(context: DriverContext, sink?: DecideSink): AgentOperation {
    void context;
    sink?.onReasoningDelta?.('推理自述:');
    sink?.onReasoningDelta?.('先核对目标');
    sink?.onReasoning?.('推理自述:先核对目标');
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
      startRel: 'articles',
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
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onReasoning: () => {
        throw new Error('观测者爆炸');
      },
    });

    expect(result.outcome).toBe('done');
    expect(result.steps).toHaveLength(1);
  });

  it('onReasoningDelta 逐片转发给 options.onReasoningDelta,聚合 onReasoning 通道不变', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ReasoningDeltaDriver([{ kind: 'done', summary: 'ok' }]);
    const deltas: string[] = [];
    const full: string[] = [];

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onReasoning: (text) => full.push(text),
      onReasoningDelta: (piece) => deltas.push(piece),
    });

    expect(result.outcome).toBe('done');
    expect(deltas).toEqual(['推理自述:', '先核对目标']);
    expect(full).toEqual(['推理自述:先核对目标']);
  });

  it('仅提供 onReasoningDelta(无聚合回调)→ sink 仍构造并转发增量', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ReasoningDeltaDriver([{ kind: 'done', summary: 'ok' }]);
    const deltas: string[] = [];

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onReasoningDelta: (piece) => deltas.push(piece),
    });

    expect(result.outcome).toBe('done');
    expect(deltas).toEqual(['推理自述:', '先核对目标']);
  });

  it('onReasoningDelta 抛错不中断循环(观测者不得污染协议)', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ReasoningDeltaDriver([{ kind: 'done', summary: 'ok' }]);

    const result = await runAgent(driver, GOAL, {
      startRel: 'articles',
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      onReasoningDelta: () => {
        throw new Error('观测者爆炸');
      },
    });

    expect(result.outcome).toBe('done');
    expect(result.steps).toHaveLength(1);
  });

  it('rule driver 零回调(机械层无推理自述;端到端循环级证据)', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const seen: string[] = [];

    const result = await runAgent(
      createRuleDriver(),
      { verb: 'zzqqx 无交集' },
      {
        startRel: 'articles',
        baseUrl: BASE,
        fetchImpl: transport.fetch,
        onReasoning: (text) => seen.push(text),
      },
    );

    // 自由漫游无路 → fail 收尾;全程 reasoning 回调零次。
    expect(result.outcome).toBe('failed');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(seen).toEqual([]);
  });
});
