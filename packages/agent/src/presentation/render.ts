/** Independent Presentation-Agent prompt and fail-safe binding-only response parser. */
import { streamText } from 'ai';

import { createLlmChatModel, type LlmDriverOptions } from '../llm/llm-driver';
import { hasLlmConfig } from '../llm/llm-config';
import { extractRawReasoning, readRawDelta } from '../llm/raw-reasoning';

// ---- 类型 --------------------------------------------------------------------

/**
 * 生成的渲染说明(结构上即 web 侧 RenderSpec:concern/component/bind;
 * bind 的零字面与词条形状由 web 入口校验器把关,本包只产引用树)。
 */
export interface GeneratedRenderSpec {
  /** 关注点键(凝固键:同 concern 永远同一布局)。 */
  concern: string;
  /** 词汇表词名(chart/table/…;取值域见 /api/render/catalog)。 */
  component: string;
  /** 绑定树(零字面:只有引用节点与结构容器)。 */
  bind: Record<string, unknown>;
}

/**
 * sitemap 的结构子集(engine Sitemap 可直接代入):集合面 + 流程节点字段
 * 声明(维度字段的真实性依据)。
 */
export interface RenderSitemapContext {
  surfaces: readonly { rel: string; title: string; collection?: boolean }[];
  flows: readonly {
    name: string;
    title?: string;
    nodes: readonly { name: string; fields?: readonly { name: string }[] }[];
  }[];
}

// ---- LLM 路径接口 -------------------------------------------------------------

/** prompt 用的词条摘要(目录 /api/render/catalog 的结构子集)。 */
export interface RenderWordSummary {
  name: string;
  description: string;
  bindSchema: Record<string, unknown>;
}

/** buildRenderPrompt 输入(处境披露:目标 + 集合面/字段声明 + 词汇表)。 */
export interface BuildRenderPromptInput {
  intent: string;
  sitemap: RenderSitemapContext;
  words: readonly RenderWordSummary[];
}

/**
 * 组装 render 生成的 LLM prompt(纯字符串;传输与模型选择由调用方负责)。
 * 约束:只输出 JSON;bind 零字面(只有 {collection[,dimension]}/{field}/{ref}
 * 引用节点);component 取自词汇表;concern 为 kebab-case 凝固键。
 */
export function buildRenderPrompt(input: BuildRenderPromptInput): string {
  const collections = input.sitemap.surfaces
    .filter((surface) => surface.collection === true)
    .map((surface) => surface.rel);
  const fields = [
    ...new Set(
      input.sitemap.flows.flatMap((flow) =>
        flow.nodes.flatMap((node) => (node.fields ?? []).map((field) => field.name)),
      ),
    ),
  ];
  const words = input.words
    .map(
      (word) =>
        `- ${word.name}:${word.description}\n  bindSchema: ${JSON.stringify(word.bindSchema)}`,
    )
    .join('\n');
  return [
    `你是 UI4A 的 render capability:把用户的展示意图转成 binding-only 渲染说明(JSON)。`,
    `## 用户意图\n${input.intent}`,
    `## 可绑定集合(sitemap 集合面)\n${collections.join(', ') || '(无)'}`,
    `## 已声明字段(维度取值必须来自此处,不得发明字段)\n${fields.join(', ') || '(无)'}`,
    `## 渲染词汇表(目录 /api/render/catalog)\n${words}`,
    [
      '## 输出要求',
      '1. 只输出一个 JSON 对象,形状 {"concern":"<kebab-case>","component":"<词名>","bind":{…}},不要输出其他文字。',
      '2. bind 零字面:任何裸数值/字符串载荷都非法;只允许引用节点 {collection[,dimension]}、{field}、{ref} 与结构容器。',
      '3. component 必须取自上方词汇表;concern 是凝固键,同一关注点永远同一布局。',
      '4. 聚合图表(chart)的 series 绑定 {collection, dimension:"<collection>.fields.<字段名>"},维度字段必须已声明。',
    ].join('\n'),
  ].join('\n\n');
}

/**
 * 解析 LLM 的 render 回复(fail-safe:任何不合法输出都返回 undefined,
 * 绝不抛异常)。零字面与词条形状由独立 Presentation validator 最终把关。
 */
export function parseRenderResponse(text: string): GeneratedRenderSpec | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate =
    fenced !== null ? fenced[1]! : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!candidate.trim().startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.concern !== 'string' || record.concern === '') return undefined;
  if (typeof record.component !== 'string' || record.component === '') return undefined;
  if (typeof record.bind !== 'object' || record.bind === null || Array.isArray(record.bind)) {
    return undefined;
  }
  // 断言理由:上方已排除 null/数组,object 即 JSON 对象(Record 收窄)。
  return {
    concern: record.concern,
    component: record.component,
    bind: record.bind as Record<string, unknown>,
  };
}

// ---- Presentation Agent 生成与处境核对 -----------------------------------

/**
 * Presentation Agent 产 spec 的处境核对(纯函数):collection
 * 引用必须是 sitemap 集合面、dimension 字段必须在流程节点声明(与
 * 字段按"全局声明过"口径核对;维度格式与 rel 前缀一致性由
 * 零字面校验器先把关——本函数假定 spec 已过 validateSpec)。普通 ref/field
 * 指向实例级 rel(非 sitemap 面),其真实性由解引用器渲染时把关;caption
 * 是例外:只接受可由 sitemap 与集合投影合同共同证明存在的 `<collection>.rel`
 * 字符串,避免成员级路径挂到集合实体后凝固为永久 dangling spec。
 * 返回违规清单(空 = 通过),不抛错。
 */
export function renderSpecGroundingErrors(
  spec: GeneratedRenderSpec,
  sitemap: RenderSitemapContext,
): string[] {
  const collections = new Set(
    sitemap.surfaces.filter((surface) => surface.collection === true).map((surface) => surface.rel),
  );
  const declaredFields = new Set(
    sitemap.flows.flatMap((flow) =>
      flow.nodes.flatMap((node) => (node.fields ?? []).map((field) => field.name)),
    ),
  );
  const errors: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    // 断言理由:上方已排除 null/数组,object 即 JSON 对象(Record 收窄)。
    const record = node as Record<string, unknown>;
    if (path.endsWith('.caption') && typeof record.field === 'string') {
      const separator = record.field.indexOf('.');
      const rel = separator > 0 ? record.field.slice(0, separator) : '';
      const fieldPath = separator > 0 ? record.field.slice(separator + 1) : '';
      if (!collections.has(rel) || fieldPath !== 'rel') {
        errors.push(
          `${path}: caption 引用 "${record.field}" 不可由 sitemap 集合投影解析` +
            '(应指向 "<collection>.rel",不得把成员字段路径挂到集合实体)',
        );
      }
      return;
    }
    if (typeof record.collection === 'string') {
      // 已过零字面校验的 collection 节点是干净的引用节点(无混入键)。
      if (!collections.has(record.collection)) {
        errors.push(`${path}: 集合引用 "${record.collection}" 不在 sitemap 集合面(事实不可发明)`);
      }
      if (typeof record.dimension === 'string') {
        // 维度路径 "<collection>.fields.<name>":字段名取末段(全局声明口径
        // 按全局声明口径检查；格式非法由零字面校验器先拒,到不了这里。
        const fieldName = record.dimension.split('.').pop() ?? '';
        if (!declaredFields.has(fieldName)) {
          errors.push(`${path}: 维度字段 "${fieldName}" 未在 sitemap 流程节点声明(事实不可发明)`);
        }
      }
      return; // 引用节点无子树(collection/dimension 取值是"指向哪"的声明,不是容器)
    }
    for (const [key, child] of Object.entries(record)) {
      walk(child, `${path}.${key}`);
    }
  };
  walk(spec.bind, 'bind');
  return errors;
}

/**
 * 独立 Presentation Agent 生成路径:
 * buildRenderPrompt(词汇表 + sitemap 处境披露)→ streamText(provider.chat
 * 锁 Chat Completions,D7;60s abort 与 llm-driver decide 同口径[D17/D22];
 * 零工具调用,不涉及 tool_choice)→ parseRenderResponse(fail-safe)。
 * 零字面/处境/词条形状的把关在调用方(web 校验器,分层不重复)。
 * fail-safe:无完整 profile、端点错误、abort 或解析失败一律 undefined，绝不抛异常；
 * 调用方返回诚实 Presentation failure，并保留机械 generic renderer。
 */
export async function generateRenderSpecWithLlm(
  input: BuildRenderPromptInput,
  options: LlmDriverOptions = {},
  hooks: { onReasoningDelta?: (piece: string) => void } = {},
): Promise<GeneratedRenderSpec | undefined> {
  // 配置不完整时不发起外部请求；上层决定如何向用户呈现不可用状态。
  if (!hasLlmConfig(options)) return undefined;
  try {
    const result = streamText({
      model: createLlmChatModel(options),
      prompt: buildRenderPrompt(input),
      // 端点挂死兜底:60s 无响应流被 abort(下文 'abort' 部件),经 catch 化为
      // undefined(与 llm-driver 的 B4 口径同族:失败如实,绝不抛出)。
      abortSignal: AbortSignal.timeout(60_000),
      // 原始 SSE chunk 进 fullStream(type 'raw'):reasoning 增量只在这一层
      // 暴露(D22 同因;渲染路径流式思考的观测通道)。
      includeRawChunks: true,
    });
    let text = '';
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text;
          break;
        case 'raw': {
          const delta = readRawDelta(part.rawValue);
          if (delta !== null) {
            const piece = extractRawReasoning(delta);
            if (piece !== null) {
              try {
                hooks.onReasoningDelta?.(piece);
              } catch {
                // 观测者不得污染生成路径(fail-safe 口径同 llm-driver sink)。
              }
            }
          }
          break;
        }
        case 'error':
          // 端点错误(401 等)以 error 部件到达(非抛出)——转交 catch 统一折算。
          throw part.error;
        case 'abort':
          // 60s 兜底触发:abort 部件的 reason 是 AbortSignal.reason 的序列化文本。
          throw new Error(part.reason ?? 'LLM 调用被中止');
        default:
          break;
      }
    }
    return parseRenderResponse(text);
  } catch {
    return undefined;
  }
}
