/**
 * 失败措辞分层(T24 Phase B Task 3)的机械层单测:
 * AgentRunResult(失败终局)→ 结构化 reason {code, evidence?, tried?},
 * 以及 LLM 在场时的 phrasing 生成 / 缺席时的诚实降级。
 *
 * 分层契约:机械层只产结构化数据;面向用户的表述由 LLM 生成(prompt 极简,
 * 零友好文案模板注入);LLM 不可用/调用失败 → 无 phrasing,不伪造、不静默。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentRunResult, TrailStep } from '@ui4a/agent';

import { failureReasonFromResult, phraseFailureWithLlm } from './failure-reason';

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
  vi.restoreAllMocks();
});

function failedResult(steps: TrailStep[], summary: string): AgentRunResult {
  return { goal: { verb: '发布一篇文章' }, outcome: 'failed', summary, steps, successes: [] };
}

function navigateStep(step: number, rel: string): TrailStep {
  return { step, rel, op: { kind: 'navigate', rel }, outcome: 'navigated' };
}

describe('failureReasonFromResult:失败终局 → 结构化 reason', () => {
  it('no_progress_loop:code 取机械终止码,evidence 含机器句子与协议事实,tried 为已尝试概要', () => {
    const failStep: TrailStep = {
      step: 5,
      rel: 'articles',
      op: {
        kind: 'fail',
        code: 'no_progress_loop',
        reason: '检测到无进展导航循环;当前合同未暴露完成目标所需的可执行能力',
        evidence: ['重复处境:articles', '可用动作:(无)', '已成功执行:0'],
      },
      outcome: 'failed',
    };
    const result = failedResult(
      [
        navigateStep(1, 'post:post-welcome'),
        navigateStep(2, 'articles'),
        navigateStep(3, 'post:post-welcome'),
        navigateStep(4, 'articles'),
        failStep,
      ],
      '检测到无进展导航循环;当前合同未暴露完成目标所需的可执行能力',
    );

    expect(failureReasonFromResult(result)).toEqual({
      code: 'no_progress_loop',
      evidence: [
        '检测到无进展导航循环;当前合同未暴露完成目标所需的可执行能力',
        '重复处境:articles',
        '可用动作:(无)',
        '已成功执行:0',
      ],
      tried: [
        '导航到 post:post-welcome',
        '导航到 articles',
        '导航到 post:post-welcome',
        '导航到 articles',
      ],
    });
  });

  it('driver 自述 fail(无 code)→ code=driver_fail;机器句子进 evidence', () => {
    const result = failedResult(
      [
        {
          step: 1,
          rel: 'articles',
          op: { kind: 'fail', reason: 'LLM 调用失败: HTTP 401 令牌无效' },
          outcome: 'failed',
        },
      ],
      'LLM 调用失败: HTTP 401 令牌无效',
    );

    expect(failureReasonFromResult(result)).toEqual({
      code: 'driver_fail',
      evidence: ['LLM 调用失败: HTTP 401 令牌无效'],
      tried: undefined,
    });
  });

  it('起始实体不可得(零轨迹步)→ code=start_entity_unavailable,evidence 携带 summary', () => {
    const result = failedResult([], '实体 "ghost" 不可得');

    expect(failureReasonFromResult(result)).toEqual({
      code: 'start_entity_unavailable',
      evidence: ['实体 "ghost" 不可得'],
      tried: undefined,
    });
  });

  it('非失败终局(done/answered/max-steps)→ undefined', () => {
    for (const outcome of ['done', 'answered', 'max-steps'] as const) {
      const result: AgentRunResult = {
        goal: { verb: 'x' },
        outcome,
        summary: 'ok',
        steps: [],
        successes: [],
      };
      expect(failureReasonFromResult(result)).toBeUndefined();
    }
  });

  it('tried 有界:超过上限只保留最近若干步(完整轨迹在 final.steps 审计)', () => {
    const steps: TrailStep[] = Array.from({ length: 10 }, (_, index) =>
      navigateStep(index + 1, `rel-${index + 1}`),
    );
    steps.push({
      step: 11,
      rel: 'rel-10',
      op: { kind: 'fail', reason: '无路可走' },
      outcome: 'failed',
    });

    const reason = failureReasonFromResult(failedResult(steps, '无路可走'));

    expect(reason?.tried).toHaveLength(6);
    expect(reason?.tried?.at(0)).toBe('导航到 rel-5');
    expect(reason?.tried?.at(-1)).toBe('导航到 rel-10');
  });
});

describe('phraseFailureWithLlm:LLM 表述(AI-first)', () => {
  const reason: {
    code: string;
    evidence: string[];
    tried: string[];
  } = {
    code: 'no_progress_loop',
    evidence: ['重复处境:articles'],
    tried: ['导航到 articles'],
  };

  function jsonResponse(content: string): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('LLM 在场:phrasing 来自 LLM 输出;prompt 携带结构化数据且不注入友好文案模板', async () => {
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'http://llm.test/v4';
    process.env.LLM_MODEL = 'test-model';
    const fetchImpl = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(jsonResponse('  这里没有可用的入口。 ')),
    );

    const phrasing = await phraseFailureWithLlm({
      reason,
      goal: { verb: '发布一篇文章' },
      summary: '检测到无进展导航循环',
      fetchImpl,
    });

    expect(phrasing).toBe('这里没有可用的入口。');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://llm.test/v4/chat/completions');
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('test-model');
    const user = body.messages.find((message) => message.role === 'user');
    expect(user?.content).toContain('no_progress_loop');
    expect(user?.content).toContain('发布一篇文章');
    // 极简指令:不得把「友好文案」样例/模板注入 prompt(红线)。
    const allText = body.messages.map((message) => message.content).join('\n');
    expect(allText).not.toMatch(/例如|比如|示例|e\.g\./);
  });

  it('LLM 缺席(配置缺失):零网络调用,返回 undefined(诚实降级)', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    // 零网络断言:该桩被调用即失败(悬置 Promise,不 resolve)。
    const fetchImpl = vi.fn(
      (_url: string, _init?: RequestInit) => new Promise<Response>(() => undefined),
    );

    const phrasing = await phraseFailureWithLlm({
      reason: { ...reason },
      goal: { verb: '发布一篇文章' },
      summary: '检测到无进展导航循环',
      fetchImpl,
    });

    expect(phrasing).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('LLM 调用失败(非 200 / 网络异常 / 空输出):undefined,不抛异常', async () => {
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'http://llm.test/v4';
    process.env.LLM_MODEL = 'test-model';

    const badStatus = vi.fn(() =>
      Promise.resolve(
        new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }),
      ),
    );
    await expect(
      phraseFailureWithLlm({
        reason: { ...reason },
        goal: { verb: 'x' },
        summary: 's',
        fetchImpl: badStatus,
      }),
    ).resolves.toBeUndefined();

    const networkError = vi.fn(() => Promise.reject(new Error('connection refused')));
    await expect(
      phraseFailureWithLlm({
        reason: { ...reason },
        goal: { verb: 'x' },
        summary: 's',
        fetchImpl: networkError,
      }),
    ).resolves.toBeUndefined();

    const empty = vi.fn(() => Promise.resolve(jsonResponse('   ')));
    await expect(
      phraseFailureWithLlm({
        reason: { ...reason },
        goal: { verb: 'x' },
        summary: 's',
        fetchImpl: empty,
      }),
    ).resolves.toBeUndefined();
  });
});
