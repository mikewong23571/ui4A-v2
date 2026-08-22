/**
 * LLM driver 单测(T2 Phase E / Task E1;T11 Phase C 起 streamText 流式):
 * - 决策由 LLM 产出:OpenAI 兼容 tool calling 映射回循环操作;
 * - mock fetch 充当 LLM 传输(不触网;SSE chat.completion.chunk 序列);
 * - 坏 key → 401 错误原文如实进入 fail reason(B4 的委托不崩溃前提);
 * - 模型输出不合法(无工具调用/未知工具/保留动词)→ fail-safe 返回 fail;
 * - reasoning 经 raw 部件(delta.reasoning_content)解析累积,sink 一次性回调(D22);
 * - createDriver('auto'|'llm'):缺少配置时返回可恢复 fail,不抛出且不 fallback rule。
 */
import type { SirenAction } from '@ui4a/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSystemPrompt, createDriver, createLlmDriver, resolveDriverKind } from './llm-driver';
import {
  createScriptedTransport,
  instanceEntity,
  jsonResponse,
  type RecordedCall,
} from './testkit';
import type { AgentGoal, DriverContext, FetchLike } from './types';

const TEST_LLM_CONFIG = {
  apiKey: 'test-key',
  baseURL: 'https://provider.test/v1',
  model: 'test-model',
} as const;

const nextAction: SirenAction = {
  name: 'next',
  title: '下一步',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { title: { type: 'string', title: '标题' } },
    required: ['title'],
    additionalProperties: false,
  },
};

const wizardEntity = instanceEntity({
  rel: 'article-drafting:main',
  flow: 'article-drafting',
  node: 'basic-info',
  actions: [nextAction],
  collection: 'articles',
});

const GOAL: AgentGoal = { verb: '发布一篇文章', fields: { title: '测试标题' } };

function context(overrides: Partial<DriverContext> = {}): DriverContext {
  return {
    goal: GOAL,
    currentRel: 'article-drafting:main',
    entity: wizardEntity,
    trail: [],
    successes: [],
    ...overrides,
  };
}

/** OpenAI 兼容 SSE 流(chat.completion.chunk 序列 + [DONE];streamText 的传输形态)。 */
function sseResponse(chunks: unknown[]): Response {
  const body = `${[...chunks.map((entry) => `data: ${JSON.stringify(entry)}`), 'data: [DONE]'].join('\n\n')}\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 单个 chat.completion.chunk(delta + finish_reason;信封字段满足 SDK 校验)。 */
function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1755700000,
    model: 'glm-test',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/**
 * 单 tool call 的 SSE 响应(T11 Phase C:streamText 改造后的 mock 形态):
 * - arguments 可分片(argumentChunks)——验证 SDK 流式聚合后语义不变;
 * - reasoning 片段经 delta.reasoning_content 注入——D22 探针结论:SDK 层剥离
 *   该字段(zod strip),只能从 fullStream 的 raw 部件解析累积;
 * - 工具调用与 finish_reason=tool_calls 收尾,与 GLM 实测 chunk 序列同构。
 */
function openaiToolResponse(
  toolName: string,
  args: unknown,
  options: { reasoning?: string[]; argumentChunks?: string[] } = {},
): Response {
  const argumentChunks = options.argumentChunks ?? [JSON.stringify(args)];
  return sseResponse([
    ...(options.reasoning ?? []).map((text) => chunk({ reasoning_content: text })),
    ...argumentChunks.map((slice, index) =>
      chunk({
        tool_calls: [
          index === 0
            ? {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: toolName, arguments: slice },
              }
            : { index: 0, function: { arguments: slice } },
        ],
      }),
    ),
    chunk({}, 'tool_calls'),
  ]);
}

/** 纯文本回复的 SSE 响应(无工具调用 → fail-safe 用例)。 */
function openaiTextResponse(text: string): Response {
  return sseResponse([chunk({ role: 'assistant', content: text }), chunk({}, 'stop')]);
}

/** 用脚本化 LLM 传输构造 driver(单测不触网)。 */
function llmDriverWith(responder: (url: string, init?: RequestInit) => Response) {
  const transport = createScriptedTransport(responder);
  return {
    driver: createLlmDriver({ ...TEST_LLM_CONFIG, fetchImpl: transport.fetch }),
    calls: transport.calls,
  };
}

describe('LLM 工具调用 → 循环操作映射', () => {
  it('动态动作工具调用 → exec(参数即动作字段值)', async () => {
    const { driver, calls } = llmDriverWith(() =>
      openaiToolResponse('action_next', { title: 'LLM 编的标题' }),
    );

    const op = await driver.decide(context());

    expect(op).toEqual({ kind: 'exec', action: 'next', params: { title: 'LLM 编的标题' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/chat/completions');
    // 请求体携带工具投影(固定动词 + 动态动作工具);stream:true 标记流式传输(T11 Phase C)。
    const body = JSON.stringify(calls[0]!.body);
    expect(body).toContain('"navigate"');
    expect(body).toContain('"action_next"');
    expect(body).toContain('"stream":true');
  });

  it('navigate 工具调用 → navigate', async () => {
    const { driver } = llmDriverWith(() => openaiToolResponse('navigate', { rel: 'articles' }));
    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'navigate',
      rel: 'articles',
    });
  });

  it('done 工具调用 → done(summary 原样)', async () => {
    const { driver } = llmDriverWith(() => openaiToolResponse('done', { summary: '文章已发布' }));
    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'done',
      summary: '文章已发布',
    });
  });

  it('通用 exec 工具调用 → exec(action + params)', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('exec', { action: 'next', params: { title: '通用通道' } }),
    );
    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'exec',
      action: 'next',
      params: { title: '通用通道' },
    });
  });

  it('exec_plan 工具调用 → 单个批量操作，步骤原样保留', async () => {
    const steps = [
      { rel: 'article-drafting:main', action: 'next', params: { title: '批量测试' } },
      { rel: 'article-drafting:main', action: 'publish', params: { title: '批量测试' } },
    ];
    const { driver } = llmDriverWith(() => openaiToolResponse('exec_plan', { steps }));

    await expect(driver.decide(context())).resolves.toEqual({ kind: 'exec-plan', steps });
  });
});

describe('B4:失败如实呈现(委托不崩溃)', () => {
  it('401 → fail 携带 401 与错误原文,不抛异常', async () => {
    const { driver } = llmDriverWith(() =>
      jsonResponse({ error: { code: '1002', message: '令牌无效或已过期' } }, 401),
    );

    const op = await driver.decide(context());

    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') {
      expect(op.reason).toContain('401');
      expect(op.reason).toContain('令牌无效或已过期');
    }
  });

  it('网络故障 → fail 携带错误消息,不抛异常', async () => {
    const failing: FetchLike = async () => {
      throw new Error('fetch failed: connection refused');
    };
    const driver = createLlmDriver({ ...TEST_LLM_CONFIG, fetchImpl: failing });

    const op = await driver.decide(context());

    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') {
      expect(op.reason).toContain('fetch failed');
    }
  });
});

describe('fail-safe:模型输出不合法', () => {
  it('显式 fail 工具映射 reason/evidence,作为合同能力缺失的正常出口', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('fail', {
        reason: 'articles 合同没有 delete action',
        evidence: ['articles actions=(无)', 'post:first-post actions=republish'],
      }),
    );
    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'fail',
      reason: 'articles 合同没有 delete action',
      evidence: ['articles actions=(无)', 'post:first-post actions=republish'],
    });
  });

  it('无工具调用(纯文本回复)→ fail 附模型文本', async () => {
    const { driver } = llmDriverWith(() => openaiTextResponse('我认为应该…'));

    const op = await driver.decide(context());

    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') {
      expect(op.reason).toContain('我认为应该');
    }
  });

  it('未知工具 → fail-safe fail', async () => {
    const { driver } = llmDriverWith(() => openaiToolResponse('teleport', { to: 'moon' }));
    const op = await driver.decide(context());
    expect(op.kind).toBe('fail');
  });

  it('保留动词 clarify/render(T2 未实现)→ fail-safe fail', async () => {
    for (const verb of ['clarify', 'render']) {
      const { driver } = llmDriverWith(() => openaiToolResponse(verb, {}));
      const op = await driver.decide(context());
      expect(op.kind, `调用 ${verb} 应 fail-safe`).toBe('fail');
      if (op.kind === 'fail') {
        expect(op.reason).toContain('未实现');
      }
    }
  });

  it('navigate 参数缺 rel → fail-safe fail', async () => {
    const { driver } = llmDriverWith(() => openaiToolResponse('navigate', {}));
    const op = await driver.decide(context());
    expect(op.kind).toBe('fail');
  });
});

describe('createDriver 工厂(provider-neutral config)', () => {
  const env = {
    key: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
  };

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries({
      LLM_API_KEY: env.key,
      LLM_BASE_URL: env.baseURL,
      LLM_MODEL: env.model,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('auto 无配置仍解析为 llm,并返回明确且可恢复的不可用结果', async () => {
    expect(resolveDriverKind('auto')).toBe('llm');
    const driver = createDriver('auto');
    const op = await driver.decide(context());

    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') {
      expect(op.reason).toContain('LLM 不可用');
      expect(op.reason).toContain('LLM_API_KEY, LLM_BASE_URL, LLM_MODEL');
      expect(op.reason).toContain('配置后可重试');
    }
  });

  it('auto 有 key → llm driver(决策走 LLM 传输)', async () => {
    expect(resolveDriverKind('auto')).toBe('llm');
    const driver = createDriver('auto', {
      ...TEST_LLM_CONFIG,
      fetchImpl: async () => openaiToolResponse('done', { summary: 'LLM 通道' }),
    });
    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'done',
      summary: 'LLM 通道',
    });
  });

  it('显式 llm 配置缺项时返回可恢复 fail,不向调用方抛异常', async () => {
    expect(resolveDriverKind('llm')).toBe('llm');
    const driver = createDriver('llm');
    const op = await driver.decide(context());

    expect(op).toEqual({
      kind: 'fail',
      reason: 'LLM 不可用: LLM 配置缺失: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL。配置后可重试。',
    });
  });
});

// ---- SYSTEM_PROMPT role/app 上下文槽位(T10 Phase D / 架构决定 6)------------

/** 抓取脚本化传输首条 LLM 请求的 system prompt 文本(chat completions 首条 system 消息)。 */
function systemPromptOf(calls: RecordedCall[]): string | undefined {
  const messages = calls[0]?.body?.messages;
  if (!Array.isArray(messages)) return undefined;
  const entry = messages.find(
    (message): message is { role: string; content: string } =>
      typeof message === 'object' &&
      message !== null &&
      (message as { role?: unknown }).role === 'system' &&
      typeof (message as { content?: unknown }).content === 'string',
  );
  return entry?.content;
}

describe('SYSTEM_PROMPT role/app 上下文槽位(T10 Phase D)', () => {
  it('空槽 = 现状:无槽位/空槽位的 system prompt 逐字节一致', () => {
    const base = buildSystemPrompt();
    expect(buildSystemPrompt({})).toBe(base);
    expect(buildSystemPrompt({ role: undefined, app: undefined })).toBe(base);
    // 协议核心内容不变(既有规则原文)。
    expect(base).toContain('你是 UI4A 合同 agent');
    expect(base).toContain('完成判定');
  });

  it('槽位值在场:协议核心原样为前缀,role/app 以数据行追加', () => {
    const prompt = buildSystemPrompt({ role: '内容审核员', app: 'community' });
    expect(prompt.startsWith(buildSystemPrompt())).toBe(true);
    expect(prompt).toContain('内容审核员');
    expect(prompt).toContain('community');
  });

  it('槽位值经 DriverContext 注入 LLM 请求的 system prompt', async () => {
    const { driver, calls } = llmDriverWith(() => openaiToolResponse('done', { summary: 'ok' }));

    await driver.decide(context({ role: '内容审核员', app: 'community' }));

    const system = systemPromptOf(calls);
    expect(system).toContain('内容审核员');
    expect(system).toContain('community');
  });

  it('空槽 decide:请求的 system prompt 与协议核心逐字节一致(零行为变化)', async () => {
    const { driver, calls } = llmDriverWith(() => openaiToolResponse('done', { summary: 'ok' }));

    await driver.decide(context());

    expect(systemPromptOf(calls)).toBe(buildSystemPrompt());
  });
});

// ---- streamText 聚合与 reasoning 通道(T11 Phase C / 架构决定 4)------------

describe('streamText 聚合与 reasoning 通道(T11 Phase C)', () => {
  it('tool call arguments 分片到达 → SDK 聚合后映射语义不变', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse(
        'action_next',
        { title: '分片标题' },
        {
          argumentChunks: ['{"title":"分片', '标题"}'],
        },
      ),
    );

    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'exec',
      action: 'next',
      params: { title: '分片标题' },
    });
  });

  it('reasoning_content 经 raw 部件解析累积 → sink 一次性收到拼接整段,op 语义不变', async () => {
    // D22 探针结论:SDK 层剥离 reasoning_content(zod strip,fullStream 零 reasoning 部件),
    // 只能从 raw 部件解析;GLM 末尾齐发——sink 回调是聚合后一次性,不是打字机。
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('done', { summary: 'ok' }, { reasoning: ['先核对目标', ',再收尾。'] }),
    );
    const seen: string[] = [];

    const op = await driver.decide(context(), { onReasoning: (text) => seen.push(text) });

    expect(op).toEqual({ kind: 'done', summary: 'ok' });
    expect(seen).toEqual(['先核对目标,再收尾。']);
  });

  it('onReasoningDelta 逐片回调 + onReasoning 聚合终态一次(增量通道与审计通道并存)', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('done', { summary: 'ok' }, { reasoning: ['先核对目标', ',再收尾。'] }),
    );
    const deltas: string[] = [];
    const full: string[] = [];

    const op = await driver.decide(context(), {
      onReasoning: (text) => full.push(text),
      onReasoningDelta: (piece) => deltas.push(piece),
    });

    expect(op).toEqual({ kind: 'done', summary: 'ok' });
    expect(deltas).toEqual(['先核对目标', ',再收尾。']);
    expect(full).toEqual(['先核对目标,再收尾。']);
  });

  it('onReasoningDelta 抛错 → decide 不抛,聚合回调仍达(观测者不得污染协议)', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('done', { summary: 'ok' }, { reasoning: ['自述'] }),
    );
    const full: string[] = [];

    const op = await driver.decide(context(), {
      onReasoning: (text) => full.push(text),
      onReasoningDelta: () => {
        throw new Error('观测者爆炸');
      },
    });

    expect(op).toEqual({ kind: 'done', summary: 'ok' });
    expect(full).toEqual(['自述']);
  });

  it('fail-safe 决策同样携带 reasoning(输出不合法时自述仍是蒸馏原料)', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('teleport', { to: 'moon' }, { reasoning: ['想直接瞬移过去'] }),
    );
    const seen: string[] = [];

    const op = await driver.decide(context(), { onReasoning: (text) => seen.push(text) });

    expect(op.kind).toBe('fail');
    expect(seen).toEqual(['想直接瞬移过去']);
  });

  it('端点不返回 reasoning → sink 零回调(如实缺席,不发明)', async () => {
    const { driver } = llmDriverWith(() => openaiToolResponse('done', { summary: 'ok' }));
    const seen: string[] = [];

    await driver.decide(context(), { onReasoning: (text) => seen.push(text) });

    expect(seen).toEqual([]);
  });

  it('sink 回调抛错 → decide 不抛异常,op 原样返回(观测者不得污染协议)', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('done', { summary: 'ok' }, { reasoning: ['自述'] }),
    );

    const op = await driver.decide(context(), {
      onReasoning: () => {
        throw new Error('观测者爆炸');
      },
    });

    expect(op).toEqual({ kind: 'done', summary: 'ok' });
  });

  it('端点错误(401)→ fail 原文保持且 sink 零回调(B4 口径在流式下不变)', async () => {
    const { driver } = llmDriverWith(() =>
      jsonResponse({ error: { code: '1002', message: '令牌无效或已过期' } }, 401),
    );
    const seen: string[] = [];

    const op = await driver.decide(context(), { onReasoning: (text) => seen.push(text) });

    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') {
      expect(op.reason).toContain('401');
      expect(op.reason).toContain('令牌无效或已过期');
    }
    expect(seen).toEqual([]);
  });
});
