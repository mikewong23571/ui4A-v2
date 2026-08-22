/**
 * T11 Phase A 实测探针内核(e2e/glm-probe.spec.ts 为历史文件名)。
 *
 * 本模块最初用于 T11 的 GLM-5.3 校准；T15 U23 将运行时探针扩展为任意
 * OpenAI-compatible profile，同时保留原始文件/type 名以兼容历史调用方。
 *
 * T15 U23 起与 llm-driver 共用 provider-neutral 配置合同:只接受完整的
 * LLM_API_KEY/LLM_BASE_URL/LLM_MODEL profile，不再携带供应商默认值。
 * 两者同 provider.chat() 锁 Chat Completions、同 buildSystemPrompt
 * 协议核心、同固定动词工具形态),但本模块独立发起 generateText/streamText
 * 调用;llm-driver 的 streamText 决策取数(Phase C)与本探针共用
 * raw-reasoning.ts 的 raw 部件解析,两处口径逐字节一致。
 *
 * 探针只观测、不执行:工具不带 execute,模型单步产出 tool call 即结束。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, jsonSchema, streamText, type LanguageModel, type ToolSet } from 'ai';

import { buildSystemPrompt } from './llm-driver';
import { resolveLlmConfig, type LlmConfigOverrides } from './llm-config';
import { extractRawReasoning, readRawDelta } from './raw-reasoning';

/** 单次调用的 abort 兜底缺省值(推理模型 effort max 时单步可能远超 60s)。 */
export const DEFAULT_PROBE_ABORT_MS = 150_000;

export interface GlmProbeOptions extends LlmConfigOverrides {
  /** 缺省 DEFAULT_PROBE_ABORT_MS。 */
  abortMs?: number;
}

export interface GlmProbeToolCall {
  name: string;
  input: unknown;
}

/** 单次调用的实测观测(generateText 与 streamText 共用形状)。 */
export interface GlmProbeObservation {
  mode: 'generateText' | 'streamText';
  model: string;
  /** 本次请求实际使用的 OpenAI-compatible endpoint。 */
  baseURL: string;
  /** 端到端墙钟时延(发起 → 响应完整返回/流收尾;出错时为出错时刻)。 */
  latencyMs: number;
  /** 调用错误(端点/abort/解析;无则 null)——探针如实记录,由 spec 断言。 */
  error: string | null;
  /** SDK 层 reasoning 暴露:generateText 的 reasoning parts 数 / 流式 reasoning-delta 部件数。 */
  sdkReasoningPartCount: number;
  /** SDK 层拼出的 reasoning 文本(无则 null)。 */
  sdkReasoningText: string | null;
  /**
   * 原始 HTTP 层 assistant 消息(generate)/增量(stream)上观察到的键名集合——
   * 用于确认 reasoning 的真实字段名(如 reasoning_content)而非猜测。
   */
  rawMessageKeys: string[];
  /** 原始 HTTP 层拼接出的 reasoning 文本(凡键名含 reasoning 的字符串字段;无则 null)。 */
  rawReasoningText: string | null;
  /** tool call(auto 模式;可能为空 = 模型只输出了文本)。 */
  toolCalls: GlmProbeToolCall[];
  finishReason: string;
  /** usage(原始 JSON 形状;含 reasoning_tokens 若端点返回)。 */
  usage: Record<string, unknown> | null;
  /** 流式:fullStream 各部件类型计数;非流式为空对象。 */
  streamPartCounts: Record<string, number>;
  /** 流式:首部件到达偏移;非流式为 null。 */
  firstPartAtMs: number | null;
  /** 流式:首/末 reasoning(SDK 或原始层)到达偏移;非流式为 null。 */
  firstReasoningAtMs: number | null;
  lastReasoningAtMs: number | null;
  /** 流式:携带 reasoning 的原始 chunk 数。 */
  reasoningChunkCount: number;
  /** 流式:首个含 content / tool_calls 的原始 chunk 到达偏移(chunk 排序叙事用)。 */
  firstContentAtMs: number | null;
  firstToolCallsAtMs: number | null;
  /** 流式:原始 SSE chunk 总数。 */
  rawChunkCount: number;
  /** 模型正文预览(前 200 字符)。 */
  textPreview: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 传输层原始捕获:非流式 JSON 响应体原样留存。 */
interface RawCapture {
  jsonBody: unknown;
}

/**
 * 记录型 fetch:包装真实 fetch,content-type 为 JSON 时留存响应体副本——
 * SDK 的 chat 响应 schema 不声明 reasoning_content(zod 剥离),reasoning
 * 是否随行只能从原始体确认。流式 SSE 不在此消费(由 includeRawChunks 覆盖)。
 */
function createRecordingFetch(capture: RawCapture) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await fetch(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      capture.jsonBody = await response
        .clone()
        .json()
        .catch(() => undefined);
    }
    return response;
  };
}

/** 与产品 runtime 共用配置解析，仅额外注入探针的记录型 fetch。 */
function createProbeModel(options: GlmProbeOptions): {
  model: LanguageModel;
  modelId: string;
  baseURL: string;
  capture: RawCapture;
} {
  const config = resolveLlmConfig(options);
  const capture: RawCapture = { jsonBody: undefined };
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    fetch: createRecordingFetch(capture),
  });
  // Baseline 端点均以 OpenAI-compatible Chat Completions 接入。
  const model: LanguageModel = provider.chat(config.model);
  return { model, modelId: config.model, baseURL: config.baseURL, capture };
}

/**
 * 探针工具集:与 llm-driver 固定动词同形态(navigate/exec/done),不带
 * execute——只观测 tool calling 协议行为,不驱动真实循环。
 */
function probeToolSet(): ToolSet {
  return {
    navigate: {
      description: '导航到指定 rel 的合同实体;rel 必须来自当前实体的可导航列表。',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { rel: { type: 'string', description: '目标实体的 rel' } },
        required: ['rel'],
        additionalProperties: false,
      }),
    },
    exec: {
      description: '执行当前实体上的一个动作(合法动作集见「当前实体」的动作列表)。',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          action: { type: 'string', description: '动作名' },
          params: { type: 'object', description: '动作字段值' },
        },
        required: ['action'],
        additionalProperties: false,
      }),
    },
    done: {
      description: '目标完成后调用,用 summary 总结已完成的事。',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { summary: { type: 'string', description: '完成总结' } },
        required: ['summary'],
        additionalProperties: false,
      }),
    },
  };
}

/**
 * 探针用户 prompt:与 llm-driver.buildUserPrompt 同分节风格的固定最小场景
 * (一个 draft 实体 + save/publish 动作),第一步的正确操作是 exec save——
 * 但探针只要求「产出恰好一个合法 tool call」,不裁决具体选择。
 */
const PROBE_USER_PROMPT = [
  '## 用户目标\n{"verb":"保存并发布一篇文章"}',
  '## 当前实体\n- rel: article:draft-1(class: article, node: draft)\n- 动作: save, publish\n- 可导航 rel: articles',
  '## 轨迹(至今)\n(空——这是第一步)',
].join('\n\n');

/** 从原始 chat completion 响应体取 choices[0].message(非流式)。 */
function readRawMessage(body: unknown): Record<string, unknown> | null {
  if (!isPlainObject(body)) return null;
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isPlainObject(first) || !isPlainObject(first.message)) return null;
  return first.message;
}

function toErrorMessage(error: unknown): string {
  const candidate = error as { statusCode?: unknown; responseBody?: unknown } | null;
  const parts: string[] = [];
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof candidate.statusCode === 'number'
  ) {
    parts.push(`HTTP ${candidate.statusCode}`);
  }
  parts.push(error instanceof Error ? error.message : String(error));
  return parts.join(' ');
}

function serializeUsage(usage: unknown): Record<string, unknown> | null {
  if (usage === undefined || usage === null) return null;
  // usage 含可选字段,直接 JSON 往返得到一个可打印的纯对象。
  return JSON.parse(JSON.stringify(usage)) as Record<string, unknown>;
}

/** 非流式探针:generateText 单步(与 llm-driver 同协议面:tools + auto + abort)。 */
export async function runGenerateProbe(
  options: GlmProbeOptions = {},
): Promise<GlmProbeObservation> {
  const { model, modelId, baseURL, capture } = createProbeModel(options);
  const startedAt = Date.now();
  const base: GlmProbeObservation = {
    mode: 'generateText',
    model: modelId,
    baseURL,
    latencyMs: 0,
    error: null,
    sdkReasoningPartCount: 0,
    sdkReasoningText: null,
    rawMessageKeys: [],
    rawReasoningText: null,
    toolCalls: [],
    finishReason: 'unknown',
    usage: null,
    streamPartCounts: {},
    firstPartAtMs: null,
    firstReasoningAtMs: null,
    lastReasoningAtMs: null,
    reasoningChunkCount: 0,
    firstContentAtMs: null,
    firstToolCallsAtMs: null,
    rawChunkCount: 0,
    textPreview: '',
  };
  try {
    const result = await generateText({
      model,
      system: buildSystemPrompt({}),
      prompt: PROBE_USER_PROMPT,
      tools: probeToolSet(),
      // 使用 OpenAI-compatible 协议的默认 auto，不附加供应商专用参数。
      abortSignal: AbortSignal.timeout(options.abortMs ?? DEFAULT_PROBE_ABORT_MS),
    });
    base.latencyMs = Date.now() - startedAt;
    base.sdkReasoningPartCount = result.reasoning.length;
    base.sdkReasoningText = result.reasoningText ?? null;
    // 原始体以记录型 fetch 为准(SDK 的 response.body 实测为空);response.body 兜底。
    const rawMessage = readRawMessage(capture.jsonBody ?? result.response.body);
    if (rawMessage !== null) {
      base.rawMessageKeys = Object.keys(rawMessage);
      base.rawReasoningText = extractRawReasoning(rawMessage);
    }
    base.toolCalls = result.toolCalls.map((call) => ({ name: call.toolName, input: call.input }));
    base.finishReason = result.finishReason;
    base.usage = serializeUsage(result.usage);
    base.textPreview = result.text.slice(0, 200);
  } catch (error) {
    base.latencyMs = Date.now() - startedAt;
    base.error = toErrorMessage(error);
  }
  return base;
}

/**
 * 流式探针:streamText + includeRawChunks——fullStream 的 SDK 部件与原始
 * SSE chunk 同步对照,回答「reasoning 在哪一层暴露、首字节多快到」。
 */
export async function runStreamProbe(options: GlmProbeOptions = {}): Promise<GlmProbeObservation> {
  const { model, modelId, baseURL } = createProbeModel(options);
  const startedAt = Date.now();
  const base: GlmProbeObservation = {
    mode: 'streamText',
    model: modelId,
    baseURL,
    latencyMs: 0,
    error: null,
    sdkReasoningPartCount: 0,
    sdkReasoningText: null,
    rawMessageKeys: [],
    rawReasoningText: null,
    toolCalls: [],
    finishReason: 'unknown',
    usage: null,
    streamPartCounts: {},
    firstPartAtMs: null,
    firstReasoningAtMs: null,
    lastReasoningAtMs: null,
    reasoningChunkCount: 0,
    firstContentAtMs: null,
    firstToolCallsAtMs: null,
    rawChunkCount: 0,
    textPreview: '',
  };
  try {
    const result = streamText({
      model,
      system: buildSystemPrompt({}),
      prompt: PROBE_USER_PROMPT,
      tools: probeToolSet(),
      abortSignal: AbortSignal.timeout(options.abortMs ?? DEFAULT_PROBE_ABORT_MS),
      // 原始 SSE chunk 进 fullStream(type 'raw'):直接观察端点真实字段。
      includeRawChunks: true,
    });
    let sdkReasoning = '';
    let rawReasoning = '';
    let text = '';
    const rawDeltaKeys = new Set<string>();
    for await (const part of result.fullStream) {
      const atMs = Date.now() - startedAt;
      if (base.firstPartAtMs === null) base.firstPartAtMs = atMs;
      base.streamPartCounts[part.type] = (base.streamPartCounts[part.type] ?? 0) + 1;
      switch (part.type) {
        case 'reasoning-delta':
          sdkReasoning += part.text;
          if (base.firstReasoningAtMs === null) base.firstReasoningAtMs = atMs;
          break;
        case 'text-delta':
          text += part.text;
          break;
        case 'tool-call':
          base.toolCalls.push({ name: part.toolName, input: part.input });
          break;
        case 'finish-step':
          base.finishReason = part.finishReason;
          base.usage = serializeUsage(part.usage);
          break;
        case 'raw': {
          const delta = readRawDelta(part.rawValue);
          if (delta !== null) {
            for (const key of Object.keys(delta)) rawDeltaKeys.add(key);
            const chunkReasoning = extractRawReasoning(delta);
            if (chunkReasoning !== null) {
              rawReasoning += chunkReasoning;
              base.reasoningChunkCount += 1;
              if (base.firstReasoningAtMs === null) base.firstReasoningAtMs = atMs;
              base.lastReasoningAtMs = atMs;
            }
            if (
              base.firstContentAtMs === null &&
              typeof delta.content === 'string' &&
              delta.content !== ''
            ) {
              base.firstContentAtMs = atMs;
            }
            if (base.firstToolCallsAtMs === null && Array.isArray(delta.tool_calls)) {
              base.firstToolCallsAtMs = atMs;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    base.latencyMs = Date.now() - startedAt;
    base.sdkReasoningPartCount = base.streamPartCounts['reasoning-delta'] ?? 0;
    base.sdkReasoningText = sdkReasoning !== '' ? sdkReasoning : null;
    base.rawMessageKeys = [...rawDeltaKeys].sort();
    base.rawReasoningText = rawReasoning !== '' ? rawReasoning : null;
    base.rawChunkCount = base.streamPartCounts['raw'] ?? 0;
    base.textPreview = text.slice(0, 200);
  } catch (error) {
    base.latencyMs = Date.now() - startedAt;
    base.error = toErrorMessage(error);
  }
  return base;
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function preview(text: string | null, maxLength: number): string {
  if (text === null) return '(无)';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}…`;
}

function formatObservation(observation: GlmProbeObservation): string[] {
  const lines = [
    `#### ${observation.mode} 单次(${formatMs(observation.latencyMs)}${observation.error !== null ? ',错误' : ''})`,
    '',
  ];
  if (observation.error !== null) {
    lines.push(`- 错误: ${observation.error}`);
    return lines;
  }
  lines.push(
    `- SDK reasoning: ${observation.sdkReasoningPartCount} parts${observation.sdkReasoningText !== null ? `(${observation.sdkReasoningText.length} 字符)` : ''}`,
    `- 原始层键名: [${observation.rawMessageKeys.join(', ')}]`,
    `- 原始层 reasoning: ${observation.rawReasoningText !== null ? `${observation.rawReasoningText.length} 字符` : '(无)'}`,
    `- tool calls: ${observation.toolCalls.map((call) => call.name).join(', ') || '(无)'};finishReason: ${observation.finishReason}`,
    `- usage: ${observation.usage !== null ? JSON.stringify(observation.usage) : '(无)'}`,
  );
  if (Object.keys(observation.streamPartCounts).length > 0) {
    const counts = Object.entries(observation.streamPartCounts)
      .map(([type, count]) => `${type}×${count}`)
      .join(' ');
    const at = (ms: number | null): string => (ms !== null ? formatMs(ms) : '(无)');
    lines.push(
      `- fullStream 部件: ${counts}`,
      `- 时间线: 首部件 ${at(observation.firstPartAtMs)};首 content ${at(observation.firstContentAtMs)};首 tool_calls ${at(observation.firstToolCallsAtMs)};首 reasoning ${at(observation.firstReasoningAtMs)};末 reasoning ${at(observation.lastReasoningAtMs)}(reasoning chunk ×${observation.reasoningChunkCount}/raw ×${observation.rawChunkCount})`,
    );
  }
  if (observation.rawReasoningText !== null) {
    lines.push(`- reasoning 预览(原始层): ${preview(observation.rawReasoningText, 300)}`);
  }
  if (observation.textPreview !== '') {
    lines.push(`- 正文预览: ${preview(observation.textPreview, 120)}`);
  }
  return lines;
}

function latencyRange(observations: GlmProbeObservation[]): string {
  const samples = observations.filter((entry) => entry.error === null);
  if (samples.length === 0) return '(全部失败)';
  const values = samples.map((entry) => entry.latencyMs);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `${samples.map((entry) => formatMs(entry.latencyMs)).join(' / ')}(区间 ${formatMs(min)}–${formatMs(max)})`;
}

/**
 * 探针观测 → Markdown 结论报告(实测事实部分;校准建议由编排 agent 据此
 * 撰写并挂 git note / 更 DECISIONS)。
 */
export function formatProbeReport(observations: GlmProbeObservation[]): string {
  const generate = observations.filter((entry) => entry.mode === 'generateText');
  const stream = observations.filter((entry) => entry.mode === 'streamText');
  const first = observations[0];
  const lines = [
    '## OpenAI-compatible LLM 探针实测报告',
    '',
    `- 时间: ${new Date().toISOString()}`,
    `- 模型: ${first !== undefined ? first.model : '(无观测)'};端点: ${first !== undefined ? first.baseURL : '(无观测)'}(provider.chat,Chat Completions)`,
    `- 样本: generateText ×${generate.length},streamText ×${stream.length}`,
    '',
    '### 1. reasoning 暴露形态',
    '',
  ];
  for (const entry of generate) lines.push(...formatObservation(entry), '');
  for (const entry of stream) lines.push(...formatObservation(entry), '');
  lines.push(
    '### 2. tool calling(auto 模式)',
    '',
    `- generateText: ${generate.map((entry) => (entry.toolCalls.length > 0 ? entry.toolCalls.map((call) => call.name).join('+') : '(无)')).join(' / ')}`,
    `- streamText: ${stream.map((entry) => (entry.toolCalls.length > 0 ? entry.toolCalls.map((call) => call.name).join('+') : '(无)')).join(' / ')}`,
    `- reasoning 与 tool call 同现: ${observations.every((entry) => entry.error !== null || entry.toolCalls.length > 0 === (entry.sdkReasoningText !== null || entry.rawReasoningText !== null)) ? '是(每次 tool call 均伴随 reasoning)' : '见逐次明细'}`,
    '',
    '### 3. 每步时延',
    '',
    `- generateText: ${latencyRange(generate)}`,
    `- streamText(全流): ${latencyRange(stream)}`,
    `- streamText 首 reasoning 偏移: ${stream.map((entry) => (entry.firstReasoningAtMs !== null ? formatMs(entry.firstReasoningAtMs) : '(无)')).join(' / ')}`,
    '',
  );
  return lines.join('\n');
}
