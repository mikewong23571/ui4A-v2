/**
 * agent-decision 审计包装器单测(T11 Phase B 捕获方案 / Phase C reasoning 真值):
 * - 五要素形状不变(step/driver/prompt/reasoning/op);
 * - reasoning 通道:llm 形态 driver 经 DecideSink 产出自述 → detail 填真值并
 *   透传上游 sink;不产自述(rule 形态)→ detail.reasoning 恒 null;
 * - 观测者不得污染协议:collect/上游 sink 抛错,op 照常回流。
 */
import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';
import type { AgentDriver, AgentOperation, DecideSink, DriverContext } from '@ui4a/agent';

import { wrapDriverForAudit, type AgentDecisionDetail } from './decisions';

const ENTITY: SirenEntity = {
  class: ['flow-instance', 'article-drafting'],
  properties: { rel: 'article-drafting:main', flow: 'article-drafting', node: 'basic-info' },
  actions: [],
  links: [],
  'guard-results': [],
};

function context(overrides: Partial<DriverContext> = {}): DriverContext {
  return {
    goal: { verb: '发布一篇文章' },
    currentRel: 'article-drafting:main',
    entity: ENTITY,
    trail: [],
    successes: [],
    ...overrides,
  };
}

/** llm 决策形态:decide 时经 sink 一次性回调聚合整段自述(D22:末尾齐发)。 */
function reasoningDriver(reasoning: string, op: AgentOperation): AgentDriver {
  return {
    decide: (ctx, sink?: DecideSink) => {
      void ctx;
      sink?.onReasoning?.(reasoning);
      return op;
    },
  };
}

describe('wrapDriverForAudit:reasoning 捕获通道(T11 Phase C)', () => {
  it('base driver 产 reasoning → detail.reasoning 填真值,上游 sink 收到同文透传', async () => {
    const collected: AgentDecisionDetail[] = [];
    const upstream: string[] = [];
    const wrapped = wrapDriverForAudit(
      reasoningDriver('先核对目标,再调用 action_next', {
        kind: 'exec',
        action: 'next',
        params: { title: 'T' },
      }),
      'llm',
      (detail) => collected.push(detail),
    );

    const op = await wrapped.decide(context(), { onReasoning: (text) => upstream.push(text) });

    expect(op).toEqual({ kind: 'exec', action: 'next', params: { title: 'T' } });
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({
      step: 1,
      driver: 'llm',
      reasoning: '先核对目标,再调用 action_next',
      op: { kind: 'exec', action: 'next', params: { title: 'T' } },
    });
    // llm prompt 为 system/user 全量原文(五要素形状不变)。
    const prompt = collected[0]!.prompt as { system: string; user: string };
    expect(prompt.system).toContain('UI4A 合同 agent');
    expect(prompt.user).toContain('发布一篇文章');
    expect(upstream).toEqual(['先核对目标,再调用 action_next']);
  });

  it('base driver 不产 reasoning → detail.reasoning 恒 null,上游 sink 零回调', async () => {
    const collected: AgentDecisionDetail[] = [];
    const upstream: string[] = [];
    const wrapped = wrapDriverForAudit(
      { decide: () => ({ kind: 'done', summary: 'ok' }) },
      'llm',
      (detail) => collected.push(detail),
    );

    await wrapped.decide(context(), { onReasoning: (text) => upstream.push(text) });

    expect(collected[0]!.reasoning).toBeNull();
    expect(upstream).toEqual([]);
  });

  it('rule 路径:prompt 为决策输入结构化摘要,reasoning 恒 null(五要素齐全)', async () => {
    const collected: AgentDecisionDetail[] = [];
    const wrapped = wrapDriverForAudit(
      { decide: () => ({ kind: 'navigate', rel: 'articles' }) },
      'rule',
      (detail) => collected.push(detail),
    );

    const op = await wrapped.decide(context());

    expect(op).toEqual({ kind: 'navigate', rel: 'articles' });
    expect(collected[0]).toMatchObject({
      step: 1,
      driver: 'rule',
      reasoning: null,
      op: { kind: 'navigate', rel: 'articles' },
    });
    const prompt = collected[0]!.prompt as { goal: { verb: string }; currentRel: string };
    expect(prompt.goal.verb).toBe('发布一篇文章');
    expect(prompt.currentRel).toBe('article-drafting:main');
  });

  it('观测者不得污染协议:collect 与上游 sink 抛错,op 照常回流且留痕先捕获', async () => {
    const op = await wrapDriverForAudit(
      reasoningDriver('自述', { kind: 'done', summary: 'ok' }),
      'llm',
      () => {
        throw new Error('留痕构造爆炸');
      },
    ).decide(context(), {
      onReasoning: () => {
        throw new Error('上游观测者爆炸');
      },
    });

    expect(op).toEqual({ kind: 'done', summary: 'ok' });
  });
});
