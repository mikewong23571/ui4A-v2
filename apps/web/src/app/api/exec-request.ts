/**
 * exec 请求体解析(业务 /api/exec 与 /_meta/api/exec 共用;T4 Phase B 抽取)。
 *
 * 请求形状 {rel, action, params?, actor?, principal?, channel?}(actor 缺省 human);
 * params 出处 HTTP 层不区分,一律记 intent(channel 缺省 http)。
 */
import type { ExecRequest } from '@ui4a/engine';

export interface ParsedBody {
  ok: true;
  request: ExecRequest;
}

export interface ParseError {
  ok: false;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseExecBody(body: unknown): ParsedBody | ParseError {
  if (!isPlainObject(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  const { rel, action, params, actor, principal, channel } = body;
  if (typeof rel !== 'string' || rel === '') {
    return { ok: false, error: 'rel 必须是非空字符串' };
  }
  if (typeof action !== 'string' || action === '') {
    return { ok: false, error: 'action 必须是非空字符串' };
  }
  if (params !== undefined && !isPlainObject(params)) {
    return { ok: false, error: 'params 必须是对象' };
  }
  if (actor !== undefined && actor !== 'human' && actor !== 'agent') {
    return { ok: false, error: 'actor 必须是 "human" | "agent"' };
  }
  if (principal !== undefined && typeof principal !== 'string') {
    return { ok: false, error: 'principal 必须是字符串' };
  }
  if (channel !== undefined && typeof channel !== 'string') {
    return { ok: false, error: 'channel 必须是字符串' };
  }
  return {
    ok: true,
    request: { rel, action, params, actor, principal, channel: channel ?? 'http' },
  };
}

/** 拒绝层 → HTTP 状态:声明性缺失 400,语义不满足 422。 */
export function rejectionStatus(layer: 'undeclared' | 'guard-failed' | 'schema-invalid'): number {
  return layer === 'undeclared' ? 400 : 422;
}

// ---------------------------------------------------------------------------
// /api/exec-plan 请求体解析(T6:批量裁决计划;每步是标准 ExecRequest 形状)
// ---------------------------------------------------------------------------

/** 计划级字段(steps 之外的身份默认值;步级显式声明优先)。 */
const PLAN_LEVEL_KEYS = ['actor', 'principal', 'channel'] as const;

/** 校验单个身份字段(actor/principal/channel),返回错误消息或 undefined。 */
function identityError(
  key: (typeof PLAN_LEVEL_KEYS)[number],
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (key === 'actor' && value !== 'human' && value !== 'agent') {
    return `${key} 必须是 "human" | "agent"`;
  }
  if (key !== 'actor' && typeof value !== 'string') {
    return `${key} 必须是字符串`;
  }
  return undefined;
}

export type ParsedPlanBody = { ok: true; steps: ExecRequest[] } | { ok: false; error: string };

/**
 * 解析计划请求体:{steps: [{rel, action, params?, actor?, principal?, channel?}…],
 * actor?, principal?, channel?}。计划级 actor/principal/channel 是各步默认值
 * (步级声明优先;channel 最终缺省 'http',与 parseExecBody 同口径)。
 * 空 steps 与非数组 → 400(合同层拒绝空计划;engine 侧口径为平凡完成,见
 * engine/plan.ts 头注释)。
 */
export function parsePlanBody(body: unknown): ParsedPlanBody {
  if (!isPlainObject(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  for (const key of PLAN_LEVEL_KEYS) {
    const error = identityError(key, body[key]);
    if (error !== undefined) return { ok: false, error };
  }
  const defaults = {
    actor: body.actor as ExecRequest['actor'],
    principal: body.principal as ExecRequest['principal'],
    channel: body.channel as ExecRequest['channel'],
  };
  const { steps } = body;
  if (!Array.isArray(steps)) {
    return { ok: false, error: 'steps 必须是非空数组' };
  }
  if (steps.length === 0) {
    return { ok: false, error: 'steps 必须是非空数组(空计划不是计划)' };
  }
  const parsedSteps: ExecRequest[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!isPlainObject(step)) {
      return { ok: false, error: `steps[${index}] 必须是对象` };
    }
    if (typeof step.rel !== 'string' || step.rel === '') {
      return { ok: false, error: `steps[${index}].rel 必须是非空字符串` };
    }
    if (typeof step.action !== 'string' || step.action === '') {
      return { ok: false, error: `steps[${index}].action 必须是非空字符串` };
    }
    if (step.params !== undefined && !isPlainObject(step.params)) {
      return { ok: false, error: `steps[${index}].params 必须是对象` };
    }
    for (const key of PLAN_LEVEL_KEYS) {
      const error = identityError(key, step[key]);
      if (error !== undefined) return { ok: false, error: `steps[${index}].${error}` };
    }
    parsedSteps.push({
      rel: step.rel,
      action: step.action,
      params: step.params,
      actor: (step.actor as ExecRequest['actor']) ?? defaults.actor,
      principal: (step.principal as ExecRequest['principal']) ?? defaults.principal,
      channel: (step.channel as ExecRequest['channel']) ?? defaults.channel ?? 'http',
    });
  }
  return { ok: true, steps: parsedSteps };
}
