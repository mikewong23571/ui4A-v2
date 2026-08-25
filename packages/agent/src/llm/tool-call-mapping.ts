/**
 * 工具调用 → 循环操作映射(从 llm-driver.ts 拆出,行为不变)。
 * fail-safe:任何不合法的模型输出都折算为 fail,绝不抛异常。
 */
import { ACTION_TOOL_PREFIX } from '../protocol/tools';
import type { AgentOperation } from '../types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** fail-safe:任何不合法的模型输出都折算为 fail,绝不抛异常。 */
export function invalidOutput(reason: string): AgentOperation {
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

export function mapToolCall(toolName: string, input: unknown): AgentOperation {
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
    case 'present': {
      if (!isPlainObject(input)) return invalidOutput('present 参数必须是对象');
      const { subject, intent, constraints, delivery } = input;
      const parsedSubject =
        typeof subject === 'string' && subject !== ''
          ? subject
          : isPlainObject(subject) &&
              Array.isArray(subject.selection) &&
              subject.selection.length > 0 &&
              subject.selection.length <= 32 &&
              subject.selection.every((rel) => typeof rel === 'string' && rel !== '') &&
              new Set(subject.selection).size === subject.selection.length
            ? { selection: subject.selection as string[] }
            : undefined;
      if (parsedSubject === undefined)
        return invalidOutput('present.subject 必须是 rel 或显式 selection');
      if (typeof intent !== 'string' || intent === '') {
        return invalidOutput('present 缺少字符串参数 intent');
      }
      if (
        constraints !== undefined &&
        (!Array.isArray(constraints) ||
          !constraints.every((constraint) => typeof constraint === 'string' && constraint !== ''))
      ) {
        return invalidOutput('present.constraints 必须是非空字符串数组');
      }
      if (delivery !== 'inline' && delivery !== 'canvas' && delivery !== 'auto') {
        return invalidOutput('present.delivery 必须是 inline、canvas 或 auto');
      }
      return {
        kind: 'present',
        subject: parsedSubject,
        intent,
        ...(constraints !== undefined ? { constraints } : {}),
        delivery,
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
