/**
 * LLM driver(arch-brief §6:「同一 agent 执行循环,双 driver 一键互换」)。
 *
 * - 决策由 LLM 产出:OpenAI 兼容 tool calling(Vercel AI SDK streamText,T11
 *   Phase C 自流式改造:聚合出最终 tool call 后语义与非流式完全一致——
 *   mapToolCall/fail-safe/60s abort/B4 错误折算原样);
 * - prompt = 目标 + 轨迹 + 最近拒绝(拒绝即数据)+ 当前实体摘要;
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
 * - createDriver('auto'):无 key 回退 rule driver(I1 机械层)。
 *
 * GLM coding plan:baseURL open.bigmodel.cn/api/coding/paas/v4,模型名缺省
 * glm-5.3(coding plan 旗舰,2026-08-14 发布;LLM_MODEL env 可覆盖;D20)。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { jsonSchema, streamText, type LanguageModel, type ToolSet } from 'ai';
import type { SirenEntity } from '@ui4a/engine';

import { createRuleDriver } from './rule-driver';
import { summarizeEntity } from './loop';
import { extractRawReasoning, readRawDelta } from './raw-reasoning';
import { ACTION_TOOL_PREFIX, buildToolProjection, isReservedVerb } from './tools';
import type {
  AgentDriver,
  AgentOperation,
  DecideSink,
  DriverContext,
  FetchLike,
} from './types';

/** GLM coding plan 的 OpenAI 兼容端点(中国区)。 */
export const DEFAULT_LLM_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';

/** coding plan 旗舰模型(LLM_MODEL 可覆盖;验收报告记录选择理由;D20)。 */
export const DEFAULT_LLM_MODEL = 'glm-5.3';

export interface LlmDriverOptions {
  /** 缺省 process.env.GLM_API_KEY。 */
  apiKey?: string;
  /** 缺省 process.env.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL。 */
  baseURL?: string;
  /** 缺省 process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL。 */
  model?: string;
  /** 注入传输(单测脚本化;缺省真实 fetch)。 */
  fetchImpl?: FetchLike;
}

export type DriverKind = 'rule' | 'llm' | 'auto';

interface ResolvedLlmSettings {
  apiKey: string;
  baseURL: string;
  model: string;
  fetchImpl?: FetchLike;
}

function resolveSettings(options: LlmDriverOptions): ResolvedLlmSettings {
  return {
    apiKey: options.apiKey ?? process.env.GLM_API_KEY ?? '',
    baseURL: options.baseURL ?? process.env.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL,
    model: options.model ?? process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  };
}

const SYSTEM_PROMPT = [
  '你是 UI4A 合同 agent:通过调用工具操作超媒体合同(HTTP 合同)完成用户委托的目标。',
  '规则:',
  '1. 每轮必须且只能输出一个工具调用;合法动作集就是当前工具列表(处境披露)。',
  '2. navigate 的 rel 必须来自其枚举;工具 description 标注 blocked 的动作当前被 guard 阻断,不要调用。',
  '3. 拒绝即数据:轨迹中的被拒动作与「最近拒绝」携带结构化原因——换路径,或按动作字段 schema 修正参数后重试。',
  '4. 字段值按语义构造:枚举字段必须取 enum 内的值;标题/正文等 intent 字段按目标意图编写;不要发明合同外的值。',
  '5. clarify 与 render 是保留动词且当前未实现:禁止调用;缺字段值时按规则 4 自行构造。',
  '6. 完成判定:目标对应的完成类动作(如 publish)成功执行过之后才调用 done,并用 summary 总结;不得提前 done。',
].join('\n');

/**
 * SYSTEM_PROMPT 的 role/app 上下文槽位(T10 Phase D,架构决定 6):
 * 角色职责组合的数据载体(D19 路线 T3/T5 的钩子)——prompt 只装不变协议
 * 核心,角色/意图从数据(DriverContext.role/app)注入。空槽 = 现状。
 */
export interface SystemPromptSlots {
  role?: string;
  app?: string;
}

/**
 * system prompt 组装:空槽(未提供/空串)逐字节返回协议核心 SYSTEM_PROMPT
 * (零行为变化);槽位值在场时协议核心原样为前缀,追加数据行。
 */
export function buildSystemPrompt(slots: SystemPromptSlots = {}): string {
  const lines = [
    ...(slots.role !== undefined && slots.role !== '' ? [`- 角色: ${slots.role}`] : []),
    ...(slots.app !== undefined && slots.app !== '' ? [`- 应用: ${slots.app}`] : []),
  ];
  if (lines.length === 0) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\n## 角色与应用上下文\n${lines.join('\n')}`;
}

/** 当前实体摘要:供 prompt 的紧凑投影(不内联全部子实体)。 */
function describeEntity(entity: SirenEntity): string {
  const summary = summarizeEntity(entity);
  const subRels = (entity.entities ?? [])
    .map((sub) => (typeof sub.properties.rel === 'string' ? sub.properties.rel : ''))
    .filter((rel) => rel !== '');
  const linkRels = entity.links
    .map((link) => decodeURIComponent(/[?&]rel=([^&]+)/.exec(link.href)?.[1] ?? ''))
    .filter((rel) => rel !== '');
  const blocked = (entity['guard-results'] ?? [])
    .filter((entry) => entry.blocked)
    .map((entry) => entry.action);
  return [
    `- rel: ${summary.rel}(class: ${summary.class.join(', ')}${summary.node !== undefined ? `, node: ${summary.node}` : ''}${summary.count !== undefined ? `, count: ${summary.count}` : ''})`,
    `- 动作: ${summary.actions.join(', ') || '(无)'}`,
    ...(blocked.length > 0 ? [`- guard 阻断: ${blocked.join(', ')}`] : []),
    `- 可导航 rel: ${[...new Set([...linkRels, ...subRels])].join(', ') || '(无)'}`,
  ].join('\n');
}

function describeTrail(context: DriverContext): string {
  if (context.trail.length === 0) return '(空——这是第一步)';
  return context.trail
    .map((step) => {
      const op =
        step.op.kind === 'navigate'
          ? `navigate → ${step.op.rel}`
          : step.op.kind === 'exec'
            ? `exec ${step.op.action} ${JSON.stringify(step.op.params ?? {})}`
            : step.op.kind === 'done'
              ? `done ${step.op.summary}`
              : `fail ${step.op.reason}`;
      const note = step.rejection !== undefined ? `(拒绝: ${step.rejection.reason})` : '';
      return `${step.step}. [${step.rel}] ${op} ⇒ ${step.outcome} ${note}`;
    })
    .join('\n');
}

/**
 * user prompt 组装(目标 + 当前实体 + 轨迹 + 最近拒绝 + 已成功执行)。
 * 导出理由(T11 Phase B):agent-decision 审计留痕按同一纯函数从同一
 * DriverContext 重建 prompt 原文(免回放重建的训练原料)——llmDecide 实际
 * 发送的 prompt 必须经本函数构造,重建才与实际发送逐字节一致。
 */
export function buildUserPrompt(context: DriverContext): string {
  const parts = [
    `## 用户目标\n${JSON.stringify(context.goal)}`,
    `## 当前实体\n${describeEntity(context.entity)}`,
    `## 轨迹(至今)\n${describeTrail(context)}`,
  ];
  if (context.lastRejection !== undefined) {
    parts.push(`## 最近拒绝(上一步被拒,拒绝即数据)\n${JSON.stringify(context.lastRejection)}`);
  }
  if (context.successes.length > 0) {
    parts.push(
      `## 已成功的执行\n${context.successes.map((entry) => `${entry.rel} :: ${entry.action}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

// ---- 工具调用 → 循环操作映射 ------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** fail-safe:任何不合法的模型输出都折算为 fail,绝不抛异常。 */
function invalidOutput(reason: string): AgentOperation {
  return { kind: 'fail', reason: `LLM 输出不合法: ${reason}` };
}

function mapToolCall(toolName: string, input: unknown): AgentOperation {
  switch (toolName) {
    case 'navigate': {
      const rel = isPlainObject(input) ? input.rel : undefined;
      return typeof rel === 'string' && rel !== ''
        ? { kind: 'navigate', rel }
        : invalidOutput('navigate 缺少字符串参数 rel');
    }
    case 'exec': {
      if (!isPlainObject(input) || typeof input.action !== 'string') {
        return invalidOutput('exec 缺少字符串参数 action');
      }
      return {
        kind: 'exec',
        action: input.action,
        params: isPlainObject(input.params) ? input.params : {},
      };
    }
    case 'done': {
      const summary = isPlainObject(input) ? input.summary : undefined;
      return {
        kind: 'done',
        summary: typeof summary === 'string' && summary !== '' ? summary : '目标完成',
      };
    }
    default:
      break;
  }
  if (isReservedVerb(toolName)) {
    return {
      kind: 'fail',
      reason: `LLM 调用了保留动词 ${toolName}(T2 未实现 clarify/render capability)`,
    };
  }
  if (toolName.startsWith(ACTION_TOOL_PREFIX)) {
    return {
      kind: 'exec',
      action: toolName.slice(ACTION_TOOL_PREFIX.length),
      params: isPlainObject(input) ? input : {},
    };
  }
  return invalidOutput(`未知工具 "${toolName}"`);
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

/**
 * 单次 LLM 决策(streamText):消费 fullStream 聚合出最终 tool call 与 reasoning,
 * 映射为循环操作;端点/流式错误与 abort 经 catch 折算 fail(B4),decide 永不抛异常。
 */
async function llmDecide(
  model: LanguageModel,
  context: DriverContext,
  sink?: DecideSink,
): Promise<AgentOperation> {
  try {
    // 注意:system/prompt 必须经 buildSystemPrompt/buildUserPrompt 构造——
    // T11 Phase B 的 agent-decision 审计按同二函数重建全量 prompt 落库。
    const result = streamText({
      model,
      system: buildSystemPrompt({ role: context.role, app: context.app }),
      prompt: buildUserPrompt(context),
      tools: toToolSet(buildToolProjection(context.entity)),
      // 端点挂死兜底(T9 Phase B):60s 无响应流被 abort(下文 'abort' 部件),
      // 经 catch 如实进 fail reason(B4 口径:失败也是合同的一部分,decide 永不抛异常)。
      abortSignal: AbortSignal.timeout(60_000),
      // toolChoice 保持缺省 auto:GLM coding 端点对 "required" 挂起不响应
      // (实测 2026-08-21,90s 无返回;default auto 正常产出 tool_calls)。
      // 系统提示词已约束"每轮恰好一个工具调用";无调用时 fail-safe 兜底。
      // 原始 SSE chunk 进 fullStream(type 'raw'):reasoning 只在这一层暴露(D22)。
      includeRawChunks: true,
    });
    let text = '';
    let reasoning = '';
    let call: { toolName: string; input: unknown } | undefined;
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text;
          break;
        case 'tool-call':
          // 系统提示词约束单调用;多调用时取首个(与 generateText 的 toolCalls[0] 同口径)。
          if (call === undefined) call = { toolName: part.toolName, input: part.input };
          break;
        case 'raw': {
          const delta = readRawDelta(part.rawValue);
          if (delta !== null) {
            const piece = extractRawReasoning(delta);
            if (piece !== null) {
              reasoning += piece;
              try {
                // 增量通道:片段到达即转发(当前 GLM 末尾齐发 D22,增量与聚合
                // 几乎同刻;管线为真流式就绪)。聚合终态见流末 onReasoning。
                sink?.onReasoningDelta?.(piece);
              } catch {
                // 观测者不得污染协议(同 onReasoning 口径)。
              }
            }
          }
          break;
        }
        case 'error':
          // 端点错误(401 等)以 error 部件到达(非抛出)——原样转交 catch,
          // statusCode/responseBody 附着在错误对象上,B4 折算口径不变。
          throw part.error;
        case 'abort':
          // 60s 兜底触发:abort 部件的 reason 是 AbortSignal.reason 的序列化文本。
          throw new Error(part.reason ?? 'LLM 调用被中止');
        default:
          break;
      }
    }
    const op =
      call === undefined
        ? invalidOutput(`未输出工具调用(模型文本: ${text.slice(0, 200) || '(空)'})`)
        : mapToolCall(call.toolName, call.input);
    if (reasoning !== '') {
      try {
        // 聚合后一次性回调(D22:GLM reasoning 末尾齐发,非打字机);fail-safe
        // 决策的自述同样携带(蒸馏原料)。观测者异常吞掉:decide 永不抛异常。
        sink?.onReasoning?.(reasoning);
      } catch {
        // 观测者不得污染协议(同 loop onStep 口径)。
      }
    }
    return op;
  } catch (error) {
    return { kind: 'fail', reason: llmErrorToReason(error) };
  }
}

/**
 * LLM chat 模型工厂(T12 抽出,llm driver 与 render LLM 路径共用客户端口径):
 * OpenAI 兼容端点 + provider.chat() 锁 Chat Completions(GLM coding plan 只有
 * chat/completions;provider(id) 缺省走 Responses API)。空 key 也构造:显式
 * llm 时由端点裁决(401 如实回流,B4);auto/无 key 的回退在各自工厂层。
 * fetch 适配:SDK 传输签名(string|URL|Request)收敛为本包的 FetchLike(string)。
 */
export function createLlmChatModel(options: LlmDriverOptions = {}): LanguageModel {
  const settings = resolveSettings(options);
  const provider = createOpenAI({
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    ...(settings.fetchImpl !== undefined
      ? {
          fetch: (input: string | URL | Request, init?: RequestInit) =>
            settings.fetchImpl!(String(input), init),
        }
      : {}),
  });
  return provider.chat(settings.model);
}

/** LLM driver 工厂:OpenAI 兼容端点(缺省 GLM coding plan)+ 注入传输。 */
export function createLlmDriver(options: LlmDriverOptions = {}): AgentDriver {
  const model = createLlmChatModel(options);
  return { decide: (context, sink) => llmDecide(model, context, sink) };
}

/** 解析实际 driver 类型(auto:无 key → rule,I1 回退)。 */
export function resolveDriverKind(
  kind: DriverKind,
  options: LlmDriverOptions = {},
): 'rule' | 'llm' {
  if (kind === 'rule') return 'rule';
  const apiKey = options.apiKey ?? process.env.GLM_API_KEY;
  if (kind === 'auto' && !apiKey) return 'rule';
  return 'llm';
}

/** 双 driver 一键互换的工厂(rule / llm / auto)。 */
export function createDriver(kind: DriverKind, options: LlmDriverOptions = {}): AgentDriver {
  return resolveDriverKind(kind, options) === 'rule'
    ? createRuleDriver()
    : createLlmDriver(options);
}
