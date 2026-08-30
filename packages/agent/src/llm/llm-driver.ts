/**
 * LLM driver(arch-brief §6:「同一 agent 执行循环,双 driver 一键互换」)。
 *
 * - 决策由 LLM 产出:OpenAI 兼容 tool calling(Vercel AI SDK streamText,T11
 *   Phase C 自流式改造:聚合出最终 tool call 后语义与非流式完全一致——
 *   mapToolCall/fail-safe/60s abort/B4 错误折算原样);
 * - messages = 有界近期 user/assistant 原文 + 结构化会话处境 + 目标/轨迹/
 *   最近拒绝/有界完整授权实体观察;原文 role 不被压成单个 prompt;
 * - SYSTEM_PROMPT 只装不变协议核心;role/app 上下文槽位(T10)从
 *   DriverContext 数据注入,空槽 = 现状(零行为变化);
 * - 工具列表 = buildToolProjection(固定动词 5 + 动态动作工具,guard 嵌
 *   description)——合法动作集就是工具列表,处境披露的 tool 形态;
 * - 模型输出不合法(无工具调用/未知工具/保留动词/参数残缺)→ fail-safe 返回 fail;
 * - LLM 端点错误(401 等)如实折算为 fail reason 进轨迹(B4:失败也是合同的
 *   一部分,委托不崩溃)——decide 永不抛异常;
 * - reasoning 取数(D22 探针结论):SDK 层不暴露 reasoning(chat 响应 schema
 *   zod strip),只能 includeRawChunks 后从 fullStream 的 raw 部件解析
 *   delta.reasoning_content 累积;GLM 末尾齐发(非打字机),聚合整段后经
 *   DecideSink 一次性回调;端点不返回则零回调(如实缺席);
 * - provider profile 仅从 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 或测试注入解析,
 *   源码不携带供应商 endpoint/model 默认值。
 *
 * prompt 组装见 ./prompts;工具调用 → 循环操作映射见 ./tool-call-mapping。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { jsonSchema, streamText, type LanguageModel, type ToolSet } from 'ai';

import type { AgentDriver, AgentOperation, DecideSink, DriverContext, FetchLike } from '../types';
import { buildToolProjection } from '../protocol/tools';
import { LlmConfigurationError, resolveLlmConfig, type LlmConfigOverrides } from './llm-config';
import { buildLlmMessages, buildSystemPrompt, type LlmMessage } from './prompts';
import { extractRawReasoning, readRawDelta } from './raw-reasoning';
import { invalidOutput, mapToolCall } from './tool-call-mapping';

export {
  buildLlmMessages,
  buildSystemPrompt,
  buildUserPrompt,
  type LlmMessage,
  type SystemPromptSlots,
} from './prompts';

export interface LlmDriverOptions extends LlmConfigOverrides {
  /** 注入传输(单测脚本化;缺省真实 fetch)。 */
  fetchImpl?: FetchLike;
}

export type DriverKind = 'llm' | 'auto';

interface ResolvedLlmSettings {
  apiKey: string;
  baseURL: string;
  model: string;
  fetchImpl?: FetchLike;
}

function resolveSettings(options: LlmDriverOptions): ResolvedLlmSettings {
  const config = resolveLlmConfig(options);
  return {
    ...config,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  };
}

/** LLM 端点错误 → fail reason(如实呈现状态码与响应体,B4)。 */
function llmErrorToReason(error: unknown): string {
  const parts: string[] = [];
  const candidate = error as { statusCode?: unknown; responseBody?: unknown } | null;
  if (candidate !== null && typeof candidate.statusCode === 'number') {
    parts.push(`HTTP ${candidate.statusCode}`);
  }
  if (error instanceof Error) {
    parts.push(error.message);
  } else {
    parts.push(String(error));
  }
  if (candidate !== null && typeof candidate.responseBody === 'string') {
    parts.push(candidate.responseBody);
  }
  return `LLM 调用失败: ${parts.join(' ')}`;
}

function toToolSet(descriptors: ReturnType<typeof buildToolProjection>): ToolSet {
  const tools: ToolSet = {};
  for (const descriptor of descriptors) {
    tools[descriptor.name] = {
      description: descriptor.description,
      inputSchema: jsonSchema(descriptor.parameters),
    };
  }
  return tools;
}

interface DecisionAttempt {
  op: AgentOperation;
  protocolFailure?: string;
  reasoning?: string;
}

const LLM_DECISION_TIMEOUT_MS = 300_000;
const TERMINATED_MAX_ATTEMPTS = 3;
const LLM_PROVIDER_REQUEST_BUDGET_BYTES = 32 * 1024;

function assertProviderRequestBudget(body: unknown): void {
  if (typeof body !== 'string') return;
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > LLM_PROVIDER_REQUEST_BUDGET_BYTES) {
    throw new Error(
      `provider request UTF-8 JSON is ${bytes.toLocaleString('en-US')} bytes; limit is ${LLM_PROVIDER_REQUEST_BUDGET_BYTES.toLocaleString('en-US')} bytes`,
    );
  }
}

function repairMessage(protocolFailure: string): LlmMessage {
  return {
    role: 'user',
    content: [
      '## 协议修复',
      `上一次模型输出未通过协议校验，错误类别：${protocolFailure}。`,
      '请基于同一用户目标、授权事实与当前工具重新自主决定。必须只调用一个当前工具；不要复述或解析上一次被拒绝的普通文本。',
    ].join('\n'),
  };
}

function protocolFailureOf(op: AgentOperation): string | undefined {
  if (op.kind !== 'fail' || !op.reason.startsWith('LLM 输出不合法: ')) return undefined;
  const reason = op.reason.slice('LLM 输出不合法: '.length);
  if (reason.startsWith('未输出工具调用')) return '未输出工具调用';
  return reason.replace(/\(.*/s, '').slice(0, 200);
}

/** One provider decision attempt. It validates the envelope but never chooses a tool for the LLM. */
async function llmDecisionAttempt(
  model: LanguageModel,
  context: DriverContext,
  sink?: DecideSink,
  protocolFailure?: string,
): Promise<DecisionAttempt> {
  // 注意:system/messages 必须经 buildSystemPrompt/buildLlmMessages 构造——
  // 审计可用同两个纯函数重建首次输入;repair 只追加有界校验类别。
  const result = streamText({
    model,
    system: buildSystemPrompt({
      role: context.role,
      app: context.app,
      chatMarkdown: context.chatMarkdown,
      presentationMarkdown: context.presentationMarkdown,
    }),
    messages: [
      ...buildLlmMessages(context),
      ...(protocolFailure === undefined ? [] : [repairMessage(protocolFailure)]),
    ],
    tools: toToolSet(
      buildToolProjection(
        context.entity,
        context.sitemap?.surfaces.map((surface) => surface.rel) ?? [],
      ),
    ),
    toolChoice: 'auto',
    abortSignal: AbortSignal.timeout(LLM_DECISION_TIMEOUT_MS),
    includeRawChunks: true,
  });
  let text = '';
  let reasoning = '';
  const calls: { toolName: string; input: unknown }[] = [];
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        text += part.text;
        break;
      case 'tool-call':
        calls.push({ toolName: part.toolName, input: part.input });
        break;
      case 'raw': {
        const delta = readRawDelta(part.rawValue);
        if (delta !== null) {
          const piece = extractRawReasoning(delta);
          if (piece !== null) {
            reasoning += piece;
            try {
              sink?.onReasoningDelta?.(piece);
            } catch {
              // Observability cannot change the protocol outcome.
            }
          }
        }
        break;
      }
      case 'error':
        throw part.error;
      case 'abort':
        throw new Error(part.reason ?? 'LLM 调用被中止');
      default:
        break;
    }
  }
  const op =
    calls.length === 0
      ? invalidOutput(`未输出工具调用(模型文本: ${text.slice(0, 200) || '(空)'})`)
      : calls.length > 1
        ? invalidOutput(`输出多个工具调用(${calls.map((call) => call.toolName).join(',')})`)
        : mapToolCall(calls[0]!.toolName, calls[0]!.input);
  const failure = protocolFailureOf(op);
  return {
    op,
    ...(failure === undefined ? {} : { protocolFailure: failure }),
    ...(reasoning === '' ? {} : { reasoning }),
  };
}

function isTerminatedStream(error: unknown): boolean {
  return error instanceof Error && error.message === 'terminated';
}

/** Retry only the observed transient SSE termination; every retry sees identical facts/tools. */
async function llmDecisionAttemptWithStreamRetry(
  model: LanguageModel,
  context: DriverContext,
  sink?: DecideSink,
  protocolFailure?: string,
): Promise<DecisionAttempt> {
  for (let attempt = 1; attempt <= TERMINATED_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await llmDecisionAttempt(model, context, sink, protocolFailure);
    } catch (error) {
      if (!isTerminatedStream(error) || attempt === TERMINATED_MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error('unreachable terminated stream retry state');
}

function emitAttemptReasoning(attempt: DecisionAttempt, sink?: DecideSink): void {
  if (attempt.reasoning === undefined) return;
  try {
    sink?.onReasoning?.(attempt.reasoning);
  } catch {
    // Observability cannot change the protocol outcome.
  }
}

/**
 * One autonomous decision plus at most one real-LLM protocol repair. The observed transient SSE
 * `terminated` error retries the same decision boundedly; other provider failures remain honest
 * terminal failures. Rejected text is never converted into an operation.
 */
async function llmDecide(
  model: LanguageModel,
  context: DriverContext,
  sink?: DecideSink,
): Promise<AgentOperation> {
  try {
    const first = await llmDecisionAttemptWithStreamRetry(model, context, sink);
    if (first.protocolFailure === undefined) {
      emitAttemptReasoning(first, sink);
      return first.op;
    }
    const repaired = await llmDecisionAttemptWithStreamRetry(
      model,
      context,
      sink,
      first.protocolFailure,
    );
    emitAttemptReasoning(repaired.reasoning === undefined ? first : repaired, sink);
    return repaired.op;
  } catch (error) {
    return { kind: 'fail', reason: llmErrorToReason(error) };
  }
}

/**
 * LLM chat 模型工厂(T12 抽出,llm driver 与 render LLM 路径共用客户端口径):
 * OpenAI 兼容端点 + provider.chat() 锁 Chat Completions。profile 缺项时
 * 在网络调用前抛 LlmConfigurationError;端点错误仍由 driver 折算为 fail。
 * fetch 适配:SDK 传输签名(string|URL|Request)收敛为本包的 FetchLike(string)。
 */
export function createLlmChatModel(options: LlmDriverOptions = {}): LanguageModel {
  const settings = resolveSettings(options);
  const provider = createOpenAI({
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      assertProviderRequestBudget(init?.body);
      return settings.fetchImpl === undefined
        ? globalThis.fetch(input, init)
        : settings.fetchImpl(String(input), init);
    },
  });
  return provider.chat(settings.model);
}

/** LLM driver 工厂:外部配置的 OpenAI 兼容端点 + 可注入传输。 */
export function createLlmDriver(options: LlmDriverOptions = {}): AgentDriver {
  const model = createLlmChatModel(options);
  return { decide: (context, sink) => llmDecide(model, context, sink) };
}

/** 解析实际 driver 类型:auto 是 AI-first 别名,不依据部署配置改变产品语义。 */
export function resolveDriverKind(kind: DriverKind): 'llm' {
  void kind;
  return 'llm';
}

function unavailableLlmDriver(error: LlmConfigurationError): AgentDriver {
  const reason = `LLM 不可用: ${error.message}。配置后可重试。`;
  return { decide: () => ({ kind: 'fail', reason }) };
}

/**
 * Driver 工厂:auto/default 与 llm 始终走 AI-first 路径。缺少完整 profile
 * 是可恢复的 Assistant 结果,不抛异常、更不 fallback 到 rule。
 */
export function createDriver(kind: DriverKind, options: LlmDriverOptions = {}): AgentDriver {
  resolveDriverKind(kind);
  try {
    return createLlmDriver(options);
  } catch (error) {
    if (error instanceof LlmConfigurationError) return unavailableLlmDriver(error);
    throw error;
  }
}
