/**
 * LLM driver(arch-brief §6:「同一 agent 执行循环,双 driver 一键互换」)。
 *
 * - 决策由 LLM 产出:OpenAI 兼容 tool calling(Vercel AI SDK streamText,T11
 *   Phase C 自流式改造:聚合出最终 tool call 后语义与非流式完全一致——
 *   mapToolCall/fail-safe/60s abort/B4 错误折算原样);
 * - messages = 有界近期 user/assistant 原文 + 结构化会话处境 + 目标/轨迹/
 *   最近拒绝/有界完整授权实体观察；原文 role 不被压成单个 prompt;
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
 */
import { createOpenAI } from '@ai-sdk/openai';
import { jsonSchema, streamText, type LanguageModel, type ToolSet } from 'ai';

import { LlmConfigurationError, resolveLlmConfig, type LlmConfigOverrides } from './llm-config';
import { extractRawReasoning, readRawDelta } from './raw-reasoning';
import { ACTION_TOOL_PREFIX, buildToolProjection, isReservedVerb } from './tools';
import type { AgentDriver, AgentOperation, DecideSink, DriverContext, FetchLike } from './types';

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

const SYSTEM_PROMPT = [
  '你是 UI4A 合同 agent，也是 AI-first 合同助手:读取授权超媒体合同、动态理解用户目标，并通过协议工具回答或安全执行。',
  '规则:',
  '1. 每轮必须且只能输出一个工具调用;合法动作集就是当前工具列表(处境披露)。',
  '2. 授权观察包含完整 Siren properties/actions/links/guard-results。只基于这些事实回答；不要发明未观察到的事实。',
  '3. 阅读、总结、比较、解释是你的原生认知能力：事实充分时直接 answer(content,sources)，无需 read/summarize action 或 capability；sources 使用实体 rel + JSON Pointer。',
  '4. 信息不足时用 answer 诚实说明缺少什么并引用已检查字段，或用 fail 说明不可得；绝不能用无关业务 action 代替回答。',
  '4.1 复合目标若要求先回答、再执行业务动作，answer 必须设置 continue=true；普通只读回答省略 continue 并终止。',
  '5. navigate 的 rel 必须来自其枚举;工具 description 标注 blocked 的动作当前被 guard 阻断,不要调用。',
  '6. 拒绝即数据:轨迹中的被拒动作与「最近拒绝」携带结构化原因——换路径,或按动作字段 schema 修正参数后重试。',
  '7. 字段值按语义构造:枚举字段必须取 enum 内的值;标题/正文等 intent 字段按目标意图编写;不要发明合同外的值。',
  '8. 当用户的目标或对象存在影响正确性的歧义时，调用 clarify(question,continuation)；这是对话协议终态，不是 application capability。render 仍未实现，禁止调用。',
  '9. 完成判定:done 只用于业务动作目标，目标对应的完成类 action 成功执行过之后才调用 done；只读目标必须 answer。',
  '10. 用户明确要求“一次走完/一次决策/批量执行”时，优先调用 exec_plan(steps) 一次提交完整计划；普通写目标仍逐步 exec。exec_plan 禁止包含 approve/reject。',
  '11. 当前合同没有完成目标所需的业务 action/capability 时调用 fail(reason,evidence),明确缺口与已查看证据;禁止在实体间重复导航。',
  '12. exec/exec_plan/action_* 必须提供 authorization:sourceMessageId 指向可引用的 user 原话，quote 逐字复制明确授权 effect 的片段；禁止引用 Assistant 输出或改写用户原话。',
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

/** 完整授权观察:循环已按数量有界；旧调用方缺账本时至少披露当前实体。 */
function describeObservations(context: DriverContext): string {
  const observations = context.observations ?? [
    { rel: context.currentRel, entity: context.entity },
  ];
  return JSON.stringify(observations, null, 2);
}

function describeTrail(context: DriverContext): string {
  if (context.trail.length === 0) return '(空——这是第一步)';
  return context.trail
    .map((step) => {
      const op =
        step.op.kind === 'navigate'
          ? `navigate → ${step.op.rel}`
          : step.op.kind === 'answer'
            ? `answer ${step.op.content} sources=${JSON.stringify(step.op.sources)}`
            : step.op.kind === 'clarify'
              ? `clarify ${step.op.question} continuation=${JSON.stringify(step.op.continuation)}`
              : step.op.kind === 'exec'
                ? `exec ${step.op.action} ${JSON.stringify(step.op.params ?? {})}`
                : step.op.kind === 'exec-plan'
                  ? `exec-plan ${JSON.stringify(step.op.steps)}`
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
    `## 结构化会话处境(可修订认知，不是业务事实或 effect 授权)\n${JSON.stringify(context.conversation ?? {}, null, 2)}`,
    `## 当前实体 rel\n${context.currentRel}`,
    `## 授权合同观察账本(有界，按最近访问顺序；entity 为完整 Siren 快照)\n${describeObservations(context)}`,
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
  const authorizableMessages = (context.conversationMessages ?? []).filter(
    (message) => message.role === 'user' && message.messageId !== undefined,
  );
  if (authorizableMessages.length > 0) {
    parts.push(
      `## 可引用的 user 原话(effect 证据必须使用下列 id 并逐字复制 quote)\n${authorizableMessages
        .map((message) => `${message.messageId}: ${JSON.stringify(message.content)}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** LLM 输入消息的最小形状；不向公共 Agent 协议泄漏 AI SDK 类型。 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 唯一的 LLM messages 组装入口：保留上层已裁剪原文的 role/顺序，再追加当前
 * 合同处境作为一条 user message。不从原文推导业务事实，也不改写原文。
 */
export function buildLlmMessages(context: DriverContext): LlmMessage[] {
  return [
    ...(context.conversationMessages ?? []).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: buildUserPrompt(context) },
  ];
}

// ---- 工具调用 → 循环操作映射 ------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** fail-safe:任何不合法的模型输出都折算为 fail,绝不抛异常。 */
function invalidOutput(reason: string): AgentOperation {
  return { kind: 'fail', reason: `LLM 输出不合法: ${reason}` };
}

function effectAuthorization(
  input: unknown,
): { sourceMessageId: string; quote: string } | undefined {
  if (!isPlainObject(input)) return undefined;
  const sourceMessageId = input.sourceMessageId;
  const quote = input.quote;
  if (
    typeof sourceMessageId !== 'string' ||
    sourceMessageId === '' ||
    typeof quote !== 'string' ||
    quote === ''
  ) {
    return undefined;
  }
  return { sourceMessageId, quote };
}

function mapToolCall(toolName: string, input: unknown): AgentOperation {
  switch (toolName) {
    case 'navigate': {
      const rel = isPlainObject(input) ? input.rel : undefined;
      return typeof rel === 'string' && rel !== ''
        ? { kind: 'navigate', rel }
        : invalidOutput('navigate 缺少字符串参数 rel');
    }
    case 'answer': {
      const content = isPlainObject(input) ? input.content : undefined;
      const sources = isPlainObject(input) ? input.sources : undefined;
      if (typeof content !== 'string' || content === '') {
        return invalidOutput('answer 缺少字符串参数 content');
      }
      if (
        !Array.isArray(sources) ||
        !sources.every(
          (source) =>
            isPlainObject(source) &&
            typeof source.rel === 'string' &&
            source.rel !== '' &&
            typeof source.pointer === 'string' &&
            source.pointer.startsWith('/'),
        )
      ) {
        return invalidOutput('answer.sources 需要 rel 与 JSON Pointer');
      }
      return {
        kind: 'answer',
        content,
        ...(isPlainObject(input) && input.continue === true ? { continue: true } : {}),
        sources: sources.map((source) => ({
          rel: source.rel as string,
          pointer: source.pointer as string,
        })),
      };
    }
    case 'clarify': {
      const question = isPlainObject(input) ? input.question : undefined;
      const continuation = isPlainObject(input) ? input.continuation : undefined;
      if (typeof question !== 'string' || question === '') {
        return invalidOutput('clarify 缺少字符串参数 question');
      }
      if (
        !isPlainObject(continuation) ||
        typeof continuation.verb !== 'string' ||
        continuation.verb === ''
      ) {
        return invalidOutput('clarify 缺少原目标延续 continuation.verb');
      }
      const fields = continuation.fields;
      if (fields !== undefined && !isPlainObject(fields)) {
        return invalidOutput('clarify continuation.fields 必须是对象');
      }
      return {
        kind: 'clarify',
        question,
        continuation: {
          verb: continuation.verb,
          ...(typeof continuation.targetRel === 'string'
            ? { targetRel: continuation.targetRel }
            : {}),
          ...(typeof continuation.resource === 'string' ? { resource: continuation.resource } : {}),
          ...(fields !== undefined ? { fields } : {}),
        },
      };
    }
    case 'exec': {
      if (!isPlainObject(input) || typeof input.action !== 'string') {
        return invalidOutput('exec 缺少字符串参数 action');
      }
      const authorization = effectAuthorization(input.authorization);
      if (authorization === undefined) return invalidOutput('exec 缺少授权证据 authorization');
      return {
        kind: 'exec',
        action: input.action,
        params: isPlainObject(input.params) ? input.params : {},
        authorization,
      };
    }
    case 'exec_plan': {
      const steps = isPlainObject(input) ? input.steps : undefined;
      if (!Array.isArray(steps) || steps.length === 0) {
        return invalidOutput('exec_plan 缺少非空 steps');
      }
      const authorization = isPlainObject(input)
        ? effectAuthorization(input.authorization)
        : undefined;
      if (authorization === undefined) {
        return invalidOutput('exec_plan 缺少计划级授权证据 authorization');
      }
      const parsed = steps.flatMap((step) => {
        if (
          !isPlainObject(step) ||
          typeof step.rel !== 'string' ||
          typeof step.action !== 'string'
        ) {
          return [];
        }
        return [
          {
            rel: step.rel,
            action: step.action,
            ...(isPlainObject(step.params) ? { params: step.params } : {}),
          },
        ];
      });
      return parsed.length === steps.length
        ? { kind: 'exec-plan', steps: parsed, authorization }
        : invalidOutput('exec_plan.steps 需要 rel/action 字符串');
    }
    case 'done': {
      const summary = isPlainObject(input) ? input.summary : undefined;
      return {
        kind: 'done',
        summary: typeof summary === 'string' && summary !== '' ? summary : '目标完成',
      };
    }
    case 'fail': {
      const reason = isPlainObject(input) ? input.reason : undefined;
      const evidence = isPlainObject(input) ? input.evidence : undefined;
      if (typeof reason !== 'string' || reason === '') {
        return invalidOutput('fail 缺少字符串参数 reason');
      }
      return {
        kind: 'fail',
        reason,
        ...(Array.isArray(evidence) && evidence.every((entry) => typeof entry === 'string')
          ? { evidence }
          : {}),
      };
    }
    default:
      break;
  }
  if (isReservedVerb(toolName)) {
    return {
      kind: 'fail',
      reason: `LLM 调用了保留动词 ${toolName}(协议尚未实现)`,
    };
  }
  if (toolName.startsWith(ACTION_TOOL_PREFIX)) {
    const authorization = isPlainObject(input)
      ? effectAuthorization(input.authorization)
      : undefined;
    if (authorization === undefined) {
      return invalidOutput(`${toolName} 缺少授权证据 authorization`);
    }
    const params = isPlainObject(input) ? { ...input } : {};
    delete params.authorization;
    return {
      kind: 'exec',
      action: toolName.slice(ACTION_TOOL_PREFIX.length),
      params,
      authorization,
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
    // 注意:system/messages 必须经 buildSystemPrompt/buildLlmMessages 构造——
    // 审计可用同两个纯函数重建实际模型输入，不丢失原始会话 role。
    const result = streamText({
      model,
      system: buildSystemPrompt({ role: context.role, app: context.app }),
      messages: buildLlmMessages(context),
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
 * OpenAI 兼容端点 + provider.chat() 锁 Chat Completions。profile 缺项时
 * 在网络调用前抛 LlmConfigurationError;端点错误仍由 driver 折算为 fail。
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
