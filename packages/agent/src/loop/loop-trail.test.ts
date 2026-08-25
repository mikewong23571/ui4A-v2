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
import { jsonResponse } from '../testkit/testkit';
import type { TrailStep } from '../types';

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
