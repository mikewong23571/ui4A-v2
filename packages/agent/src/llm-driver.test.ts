/**
 * LLM driver 单测(T2 Phase E / Task E1):
 * - 决策由 LLM 产出:OpenAI 兼容 tool calling 映射回循环操作;
 * - mock fetch 充当 LLM 传输(不触网);
 * - 坏 key → 401 错误原文如实进入 fail reason(B4 的委托不崩溃前提);
 * - 模型输出不合法(无工具调用/未知工具/保留动词)→ fail-safe 返回 fail;
 * - createDriver('auto'):无 key 回退 rule driver(I1 机械层)。
 */
import type { SirenAction } from '@ui4a/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSystemPrompt, createDriver, createLlmDriver, resolveDriverKind } from './llm-driver';
import { createRuleDriver } from './rule-driver';
import {
  createScriptedTransport,
  instanceEntity,
  jsonResponse,
  type RecordedCall,
} from './testkit';
import type { AgentGoal, DriverContext, FetchLike } from './types';

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

/** OpenAI 兼容 chat completion(单个 tool call;信封字段满足 SDK 校验)。 */
function openaiToolResponse(toolName: string, args: unknown): Response {
  return jsonResponse({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1755700000,
    model: 'glm-test',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

/** 用脚本化 LLM 传输构造 driver(单测不触网)。 */
function llmDriverWith(responder: (url: string, init?: RequestInit) => Response) {
  const transport = createScriptedTransport(responder);
  return {
    driver: createLlmDriver({ apiKey: 'test-key', fetchImpl: transport.fetch }),
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
    // 请求体携带工具投影(固定动词 + 动态动作工具)
    const body = JSON.stringify(calls[0]!.body);
    expect(body).toContain('"navigate"');
    expect(body).toContain('"action_next"');
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
    const driver = createLlmDriver({ apiKey: 'k', fetchImpl: failing });

    const op = await driver.decide(context());

    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') {
      expect(op.reason).toContain('fetch failed');
    }
  });
});

describe('fail-safe:模型输出不合法', () => {
  it('无工具调用(纯文本回复)→ fail 附模型文本', async () => {
    const { driver } = llmDriverWith(() =>
      jsonResponse({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1755700000,
        model: 'glm-test',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '我认为应该…' },
          },
        ],
      }),
    );

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

describe('createDriver 工厂(auto 回退 = I1 机械层)', () => {
  const envKey = process.env.GLM_API_KEY;

  beforeEach(() => {
    delete process.env.GLM_API_KEY;
  });

  afterEach(() => {
    if (envKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = envKey;
  });

  it('auto 无 key → rule driver(决策与 rule driver 完全一致,零 LLM 调用)', async () => {
    expect(resolveDriverKind('auto')).toBe('rule');
    const driver = createDriver('auto');
    const ctx = context();
    await expect(Promise.resolve(driver.decide(ctx))).resolves.toEqual(
      createRuleDriver().decide(ctx),
    );
  });

  it('auto 有 key → llm driver(决策走 LLM 传输)', async () => {
    expect(resolveDriverKind('auto', { apiKey: 'k' })).toBe('llm');
    const driver = createDriver('auto', {
      apiKey: 'k',
      fetchImpl: async () => openaiToolResponse('done', { summary: 'LLM 通道' }),
    });
    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'done',
      summary: 'LLM 通道',
    });
  });

  it('显式 llm 无 key 仍构造 LLM driver(空 key 由端点裁决,如实 401)', async () => {
    expect(resolveDriverKind('llm')).toBe('llm');
    const driver = createDriver('llm', {
      fetchImpl: async () => jsonResponse({ error: { message: 'no api key' } }, 401),
    });
    const op = await driver.decide(context());
    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') {
      expect(op.reason).toContain('401');
    }
  });

  it('rule 恒为 rule driver', () => {
    expect(resolveDriverKind('rule', { apiKey: 'k' })).toBe('rule');
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
