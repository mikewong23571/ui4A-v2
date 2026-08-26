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
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildLlmMessages,
  buildSystemPrompt,
  buildUserPrompt,
  createDriver,
  createLlmDriver,
  resolveDriverKind,
} from './llm-driver';
import {
  createScriptedTransport,
  instanceEntity,
  jsonResponse,
  type RecordedCall,
} from '../testkit/testkit';
import type { AgentGoal, ConversationContext, DriverContext, FetchLike } from '../types';

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
    const authorization = { sourceMessageId: 'm1', quote: '发布这篇文章' };
    const { driver, calls } = llmDriverWith(() =>
      openaiToolResponse('action_next', { title: 'LLM 编的标题', authorization }),
    );

    const op = await driver.decide(context());

    expect(op).toEqual({
      kind: 'exec',
      action: 'next',
      params: { title: 'LLM 编的标题' },
      authorization,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/chat/completions');
    // 请求体携带工具投影(固定动词 + 动态动作工具);stream:true 标记流式传输(T11 Phase C)。
    const body = JSON.stringify(calls[0]!.body);
    expect(body).toContain('"navigate"');
    expect(body).toContain('"action_next"');
    expect(body).toContain('"stream":true');
  });

  it('下一次 prompt/tool build 自动投影实体中新激活的 action，不需要改 driver', async () => {
    const feature = { ...nextAction, name: 'feature', title: '加精' };
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      actions: [feature],
    });
    const { driver, calls } = llmDriverWith(() =>
      openaiToolResponse('answer', {
        content: '当前动作已发现。',
        sources: [{ rel: 'post:first-post', pointer: '/actions/0' }],
      }),
    );

    await driver.decide(context({ currentRel: 'post:first-post', entity }));

    const body = JSON.stringify(calls[0]!.body);
    expect(body).toContain('action_feature');
    expect(body).toContain('加精');
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

  it('answer 工具调用 → answer(content + FactRef sources 原样)', async () => {
    const sources = [{ rel: 'post:first-post', pointer: '/properties/fields/body' }];
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('answer', { content: '这是一篇验收文章。', sources }),
    );

    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'answer',
      content: '这是一篇验收文章。',
      sources,
    });
  });

  it('present 工具调用只映射模型提供的薄呈现意图', async () => {
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('present', {
        subject: 'post:first-post',
        intent: '阅读正文并突出文章身份',
        constraints: ['正文优先', '动作收纳'],
        delivery: 'canvas',
      }),
    );

    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'present',
      subject: 'post:first-post',
      intent: '阅读正文并突出文章身份',
      constraints: ['正文优先', '动作收纳'],
      delivery: 'canvas',
    });
  });

  it('通用 exec 工具调用 → exec(action + params)', async () => {
    const authorization = { sourceMessageId: 'm1', quote: '发布这篇文章' };
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('exec', {
        action: 'next',
        params: { title: '通用通道' },
        authorization,
      }),
    );
    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'exec',
      action: 'next',
      params: { title: '通用通道' },
      authorization,
    });
  });

  it('exec_plan 工具调用 → 单个批量操作，步骤原样保留', async () => {
    const steps = [
      { rel: 'article-drafting:main', action: 'next', params: { title: '批量测试' } },
      { rel: 'article-drafting:main', action: 'publish', params: { title: '批量测试' } },
    ];
    const authorization = { sourceMessageId: 'm1', quote: '一次走完发布向导' };
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('exec_plan', { steps, authorization }),
    );

    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'exec-plan',
      steps,
      authorization,
    });
  });

  it('exec/exec_plan/dynamic action 缺授权证据时 fail-safe', async () => {
    for (const [tool, input] of [
      ['exec', { action: 'next', params: {} }],
      ['exec_plan', { steps: [{ rel: 'article-drafting:main', action: 'next' }] }],
      ['action_next', { title: '无授权' }],
    ] as const) {
      const { driver } = llmDriverWith(() => openaiToolResponse(tool, input));
      await expect(driver.decide(context())).resolves.toMatchObject({ kind: 'fail' });
    }
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
  it('text-only 首次输出只触发一次真实 LLM repair，不机械转换原文本', async () => {
    let attempts = 0;
    const rejectedText = '这里是普通文本，不是协议调用';
    const { driver, calls } = llmDriverWith(() => {
      attempts += 1;
      return attempts === 1
        ? openaiTextResponse(rejectedText)
        : openaiToolResponse('answer', {
            content: '修复后的协议回答',
            sources: [{ rel: 'articles', pointer: '/properties/count' }],
          });
    });

    await expect(driver.decide(context())).resolves.toMatchObject({
      kind: 'answer',
      content: '修复后的协议回答',
    });
    expect(calls).toHaveLength(2);
    expect(
      calls.every((call) => JSON.stringify(call.body).includes('"tool_choice":"required"')),
    ).toBe(true);
    const repairBody = JSON.stringify(calls[1]?.body);
    expect(repairBody).toContain('协议修复');
    expect(repairBody).toContain('未输出工具调用');
    expect(repairBody).not.toContain(rejectedText);
  });

  it('未知工具或无效参数第二次仍非法时有界失败，不进行第三次调用', async () => {
    let attempts = 0;
    const { driver, calls } = llmDriverWith(() => {
      attempts += 1;
      return attempts === 1
        ? openaiToolResponse('teleport', { to: 'moon' })
        : openaiToolResponse('answer', { content: '' });
    });

    const op = await driver.decide(context());
    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') expect(op.reason).toContain('LLM 输出不合法');
    expect(calls).toHaveLength(2);
  });

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

  it('clarify 映射为带原目标延续的协议级终态', async () => {
    const continuation = { verb: '总结用户指定的文章' };
    const { driver } = llmDriverWith(() =>
      openaiToolResponse('clarify', {
        question: '你指的是第一篇还是欢迎文章？',
        continuation,
      }),
    );

    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'clarify',
      question: '你指的是第一篇还是欢迎文章？',
      continuation,
    });
  });

  it('clarify 缺问题或原目标延续时 fail-safe；旧 render 工具不可调用', async () => {
    for (const args of [{ continuation: GOAL }, { question: '需要澄清' }]) {
      const { driver } = llmDriverWith(() => openaiToolResponse('clarify', args));
      await expect(driver.decide(context())).resolves.toMatchObject({ kind: 'fail' });
    }

    const { driver } = llmDriverWith(() => openaiToolResponse('render', {}));
    const op = await driver.decide(context());
    expect(op.kind).toBe('fail');
    if (op.kind === 'fail') expect(op.reason).toContain('未知工具');
  });

  it('navigate 参数缺 rel → fail-safe fail', async () => {
    const { driver } = llmDriverWith(() => openaiToolResponse('navigate', {}));
    const op = await driver.decide(context());
    expect(op.kind).toBe('fail');
  });

  it('answer 缺 content 或来源不是 rel + JSON Pointer → fail-safe fail', async () => {
    for (const args of [
      { sources: [] },
      { content: '无来源', sources: [{ rel: 'post:first-post', pointer: 'properties/body' }] },
    ]) {
      const { driver } = llmDriverWith(() => openaiToolResponse('answer', args));
      const op = await driver.decide(context());
      expect(op.kind).toBe('fail');
    }
  });
});

describe('授权合同观察进入 LLM prompt', () => {
  it('当前实体的完整 properties.fields 正文与 count 可见,不再压成 action-only 摘要', () => {
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: {
        title: '第一篇',
        body: '这是第一篇完整文章，用来验证具体查看、正文阅读和跨刷新恢复链路。',
      },
    });
    const prompt = buildUserPrompt(
      context({
        currentRel: 'post:first-post',
        entity,
        observations: [{ rel: 'post:first-post', entity }],
      }),
    );

    expect(prompt).toContain('这是第一篇完整文章');
    expect(prompt).toContain('"fields"');
    expect(prompt).toContain('"body"');
  });

  it('比较任务能看到有界观察账本中的两个实体及各自正文', () => {
    const first = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第一篇', body: '第一篇正文' },
    });
    const welcome = instanceEntity({
      rel: 'post:post-welcome',
      flow: 'post-status',
      node: 'published',
      fields: { title: '欢迎', body: '欢迎正文' },
    });
    const prompt = buildUserPrompt(
      context({
        currentRel: 'post:post-welcome',
        entity: welcome,
        observations: [
          { rel: 'post:first-post', entity: first },
          { rel: 'post:post-welcome', entity: welcome },
        ],
      }),
    );

    expect(prompt).toContain('第一篇正文');
    expect(prompt).toContain('欢迎正文');
    expect(prompt).toContain('post:first-post');
    expect(prompt).toContain('post:post-welcome');
  });

  it('prompt 同时披露目标约束、facts/links/actions/guards 与 app-bounded capability/action 处境', () => {
    const entity = instanceEntity({
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: { title: '第一篇', body: '正文' },
      actions: [nextAction],
      collection: 'articles',
    });
    const prompt = buildUserPrompt(
      context({
        currentRel: 'post:first-post',
        entity,
        observations: [{ rel: 'post:first-post', entity }],
        conversation: {
          activeGoal: { verb: '保存摘要', targetRel: 'post:first-post' },
          focus: { currentRel: 'post:first-post' },
          referents: [],
          constraints: [{ text: '不要发布', sourceMessageId: 'm1' }],
        },
        app: 'publishing',
        sitemap: {
          version: 'v-capability',
          surfaces: [{ rel: 'articles', title: '文章集合' }],
          applications: [
            {
              name: 'publishing',
              intent: '内容发布',
              flows: [
                {
                  name: 'post-status',
                  title: '文章状态',
                  actions: [
                    { name: 'feature', title: '新激活动作', node: 'published', guards: [] },
                  ],
                },
              ],
            },
          ],
          capabilities: [
            {
              name: 'draft',
              title: '工件起草',
              kind: 'extract',
              intent: '生成候选草稿',
              input: '文章字段 schema',
              output: '候选草稿',
              inputSchema: { type: 'object', required: ['body'] },
              outputSchema: { type: 'object', required: ['summary'] },
              scope: { applications: ['publishing'], flows: ['post-status'] },
            },
          ],
        },
      }),
    );

    expect(prompt).toContain('不要发布');
    expect(prompt).toContain('"fields"');
    expect(prompt).toContain('"links"');
    expect(prompt).toContain('"actions"');
    expect(prompt).toContain('"guard-results"');
    expect(prompt).toContain('"feature"');
    expect(prompt).toContain('"draft"');
    expect(prompt).toContain('"scope"');
    expect(prompt).not.toContain('"inputSchema"');
    expect(prompt).not.toContain('"outputSchema"');
  });

  it('动态 action/capability 发现不在 system prompt 中硬编码故事动作名', () => {
    const source = readFileSync(new URL('./llm-driver.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('action_feature');
    expect(source).not.toContain('action_generate-summary');
    expect(source).not.toContain('capability:summarize');
  });
});

describe('多轮会话进入 LLM messages', () => {
  const conversation: ConversationContext = {
    activeGoal: { verb: '总结第一篇文章', targetRel: 'post:first-post' },
    focus: {
      currentRel: 'post:first-post',
      history: [{ rel: 'articles' }, { rel: 'post:first-post', sourceMessageId: 'm1' }],
    },
    referents: [
      { text: '第一篇', rel: 'post:first-post', sourceMessageId: 'm1' },
      { text: '它', rel: 'post:first-post', sourceMessageId: 'm3' },
    ],
    constraints: [
      { text: '只在对话中回答', sourceMessageId: 'm3' },
      { text: '不保存', sourceMessageId: 'm3' },
    ],
  };

  it('并列披露合同读取位置、最近导航和当前客户端视图及各自 provenance', () => {
    const prompt = buildUserPrompt(
      context({
        currentRel: 'articles',
        lastNavigation: {
          schemaVersion: 1,
          navigationId: 'turn:a:navigate:1',
          source: 'agent-navigate',
          sessionId: 'session:a',
          turnId: 'turn:a',
          subject: 'post:first-post',
          route: '/canvas?focus=post%3Afirst-post',
          sourceMessageIds: ['message:a'],
          step: 1,
          completedAtSeq: 10,
        },
        clientView: {
          schemaVersion: 2,
          presence: {
            clientInstanceId: 'client:b',
            site: 'business',
            scope: null,
            thread: null,
            focus: 'articles',
          },
          sourceMessageId: 'message:b',
          observedAtSeq: 12,
        },
      }),
    );

    expect(prompt).toContain('本轮合同读取位置 rel(不是客户端当前页面)\narticles');
    expect(prompt).toContain('最近成功导航/呈现(历史完成事实，不是客户端当前页面)');
    expect(prompt).toContain('"navigationId": "turn:a:navigate:1"');
    expect(prompt).toContain('当前消息的客户端可见视图(客户端观察，不是业务事实或授权)');
    expect(prompt).toContain('"clientInstanceId": "client:b"');
  });

  it('客户端或导航事实缺失时显式披露 null，不从 currentRel 猜测', () => {
    const prompt = buildUserPrompt(context({ currentRel: 'articles' }));
    expect(prompt).toMatch(/最近成功导航\/呈现[^\n]*\nnull/);
    expect(prompt).toMatch(/当前消息的客户端可见视图[^\n]*\nnull/);
  });

  it('原始 user/assistant 内容保留 role 与顺序，处境作为末尾 user message 输入', () => {
    const messages = buildLlmMessages(
      context({
        conversationMessages: [
          { role: 'user', content: '总结一下第一篇文章' },
          { role: 'assistant', content: '我已定位到第一篇文章。' },
          { role: 'user', content: '你自己总结就行，不用保存。' },
        ],
        conversation,
      }),
    );

    expect(messages.slice(0, 3)).toEqual([
      { role: 'user', content: '总结一下第一篇文章' },
      { role: 'assistant', content: '我已定位到第一篇文章。' },
      { role: 'user', content: '你自己总结就行，不用保存。' },
    ]);
    expect(messages.at(-1)?.role).toBe('user');
    expect(messages.at(-1)?.content).toContain('"activeGoal"');
    expect(messages.at(-1)?.content).toContain('post:first-post');
    expect(messages.at(-1)?.content).toContain('不保存');
  });

  it('effect 引用只暴露有 id 的 user 原话，SDK 历史消息仍只有 role/content', () => {
    const messages = buildLlmMessages(
      context({
        conversationMessages: [
          { messageId: 'm1', role: 'user', content: '下线第一篇' },
          { messageId: 'a1', role: 'assistant', content: '我可以帮你归档第一篇' },
        ],
      }),
    );

    expect(messages[0]).toEqual({ role: 'user', content: '下线第一篇' });
    expect(messages[1]).toEqual({ role: 'assistant', content: '我可以帮你归档第一篇' });
    expect(messages.at(-1)?.content).toContain('m1: "下线第一篇"');
    expect(messages.at(-1)?.content).not.toContain('a1:');
  });

  it('实际 Chat Completions 请求使用 system + role-preserving messages', async () => {
    const { driver, calls } = llmDriverWith(() =>
      openaiToolResponse('answer', {
        content: '这是一篇验收文章。',
        sources: [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
      }),
    );
    await driver.decide(
      context({
        conversationMessages: [
          { role: 'user', content: '总结第一篇' },
          { role: 'assistant', content: '你希望保存吗？' },
          { role: 'user', content: '不保存' },
        ],
        conversation,
      }),
    );

    const messages = calls[0]?.body?.messages as { role: string; content: string }[];
    expect(messages.map(({ role }) => role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'user',
    ]);
    expect(messages[1]?.content).toBe('总结第一篇');
    expect(messages[2]?.content).toBe('你希望保存吗？');
    expect(messages[3]?.content).toBe('不保存');
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
    const prompt = buildSystemPrompt({
      role: '内容审核员',
      app: 'community',
      chatMarkdown: true,
    });
    expect(prompt.startsWith(buildSystemPrompt())).toBe(true);
    expect(prompt).toContain('内容审核员');
    expect(prompt).toContain('community');
    expect(prompt).toContain('聊天 Markdown renderer: supported');
    expect(buildSystemPrompt({ chatMarkdown: false })).toContain(
      '聊天 Markdown renderer: unsupported',
    );
  });

  it('槽位值经 DriverContext 注入 LLM 请求的 system prompt', async () => {
    const { driver, calls } = llmDriverWith(() => openaiToolResponse('done', { summary: 'ok' }));

    await driver.decide(context({ role: '内容审核员', app: 'community', chatMarkdown: true }));

    const system = systemPromptOf(calls);
    expect(system).toContain('内容审核员');
    expect(system).toContain('community');
    expect(system).toContain('聊天 Markdown renderer: supported');
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
    const authorization = { sourceMessageId: 'm1', quote: '发布这篇文章' };
    const rawInput = JSON.stringify({ title: '分片标题', authorization });
    const { driver } = llmDriverWith(() =>
      openaiToolResponse(
        'action_next',
        { title: '分片标题', authorization },
        {
          argumentChunks: [rawInput.slice(0, 24), rawInput.slice(24)],
        },
      ),
    );

    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'exec',
      action: 'next',
      params: { title: '分片标题' },
      authorization,
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
