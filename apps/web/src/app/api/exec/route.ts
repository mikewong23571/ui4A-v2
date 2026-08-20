import type { ExecRequest } from '@ui4a/engine';

import { getDb, getEngine } from '../../../engine/service';

// POST /api/exec — 引擎裁决端点(spec FR4):
// - 请求 {rel, action, params?, actor?, principal?, channel?}(actor 缺省 human);
// - 通过 → 200 {entity: 受影响实体的新投影}(append 时为新实例);
// - 拒绝 → undeclared 400 / guard-failed|schema-invalid 422,body {layer, reason, detail?}
//   ——与日志 action-rejected 事件同源(同一 verdict 对象,service 落库 detail.layer);
// - 请求形状非法 → 400;db 不可达 → 503。
// exec 经服务层串行队列(单 atom);params 出处 HTTP 层不区分,一律记 intent。

export const dynamic = 'force-dynamic';

interface ParsedBody {
  ok: true;
  request: ExecRequest;
}

interface ParseError {
  ok: false;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): ParsedBody | ParseError {
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
function rejectionStatus(layer: 'undeclared' | 'guard-failed' | 'schema-invalid'): number {
  return layer === 'undeclared' ? 400 : 422;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const engine = await getEngine(getDb());
    const outcome = await engine.exec(parsed.request);
    if (outcome.kind === 'accepted') {
      return Response.json({ entity: outcome.entity });
    }
    const response: Record<string, unknown> = { layer: outcome.layer, reason: outcome.reason };
    if (outcome.detail !== undefined) {
      response.detail = outcome.detail;
    }
    return Response.json(response, { status: rejectionStatus(outcome.layer) });
  } catch {
    return Response.json({ error: 'exec 数据库不可用' }, { status: 503 });
  }
}
