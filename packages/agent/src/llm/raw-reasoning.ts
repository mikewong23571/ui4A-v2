/**
 * 原始层 reasoning 解析(T11 / D22 探针结论的取数路线):
 * @ai-sdk/openai chat 路径的 SDK 层不暴露 reasoning(响应 schema zod strip 掉
 * reasoning_content),只能从原始 HTTP 层取——流式下即 streamText
 * includeRawChunks 后 fullStream 的 raw 部件(chat.completion.chunk 原文)。
 *
 * llm-driver(决策取数)与 llm-probe(端点实测)共用本模块,保证两处解析口径
 * 逐字节一致:探针实测过的解析逻辑就是驱动线上决策取数的逻辑。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从原始 SSE chunk 取 choices[0].delta(流式;无则 null)。 */
export function readRawDelta(rawChunk: unknown): Record<string, unknown> | null {
  if (!isPlainObject(rawChunk)) return null;
  const choices = rawChunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isPlainObject(first) || !isPlainObject(first.delta)) return null;
  return first.delta;
}

/**
 * 原始对象上的 reasoning 提取:键名含 "reasoning" 的字符串字段全部收集
 * (防御字段名漂移——实测先于假设;GLM 实测字段为 reasoning_content)。
 */
export function extractRawReasoning(container: Record<string, unknown>): string | null {
  const texts = Object.entries(container)
    .filter(([key, value]) => /reasoning/i.test(key) && typeof value === 'string' && value !== '')
    .map(([, value]) => value as string);
  return texts.length > 0 ? texts.join('') : null;
}
