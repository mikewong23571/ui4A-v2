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
