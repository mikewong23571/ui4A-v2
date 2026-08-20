import { createDriver, resolveDriverKind, runAgent, type AgentGoal } from '@ui4a/agent';

import { resolveStartRel } from '../../../chat/start';
import { trailToMessages } from '../../../chat/trail';

// POST /api/chat — 悬浮聊天的合同后端(spec FR6/FR7,arch-brief §8)。
// - 请求 {goal: {verb, targetRel?, resource?, fields?}, sessionId?, driver?};
// - 服务端组装 driver(rule | llm | auto——auto 无 key 回退 rule,I1 机械层),
//   runAgent 循环过本源 HTTP 合同(actor=agent,principal=user:<sessionId>,
//   channel=chat)——"agent 走合同"字面成立;
// - 起始 rel 由 sitemap 词级交集解析(客户端行为),缺省 articles;
// - 响应(一次性 JSON,简单可靠):{sessionId, driver(解析后), outcome,
//   summary, messages(轨迹投影,每步一条), steps, successes}——
//   B4:LLM 失败(401 等)如实进入 messages/summary,route 不 5xx。
// 服务无会话态:事件日志是真相,聊天会话是客户端投影(localStorage)。

export const dynamic = 'force-dynamic';

interface ParsedChatBody {
  ok: true;
  goal: AgentGoal;
  sessionId: string;
  driver: 'rule' | 'llm' | 'auto';
}

interface ParseError {
  ok: false;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): ParsedChatBody | ParseError {
  if (!isPlainObject(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  const { goal, sessionId, driver } = body;
  if (!isPlainObject(goal) || typeof goal.verb !== 'string' || goal.verb === '') {
    return { ok: false, error: 'goal 必须是 {verb: 非空字符串, …}' };
  }
  for (const key of ['targetRel', 'resource'] as const) {
    if (goal[key] !== undefined && typeof goal[key] !== 'string') {
      return { ok: false, error: `goal.${key} 必须是字符串` };
    }
  }
  if (goal.fields !== undefined && !isPlainObject(goal.fields)) {
    return { ok: false, error: 'goal.fields 必须是对象' };
  }
  if (sessionId !== undefined && typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId 必须是字符串' };
  }
  if (driver !== undefined && driver !== 'rule' && driver !== 'llm' && driver !== 'auto') {
    return { ok: false, error: 'driver 必须是 "rule" | "llm" | "auto"' };
  }
  return {
    ok: true,
    goal: goal as unknown as AgentGoal,
    sessionId: sessionId ?? crypto.randomUUID(),
    driver: driver ?? 'auto',
  };
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

  const { goal, sessionId, driver: requested } = parsed;
  const baseUrl = new URL(request.url).origin;
  const resolved = resolveDriverKind(requested);

  try {
    const startRel = await resolveStartRel(baseUrl, goal, (url, init) => fetch(url, init));
    const result = await runAgent(createDriver(requested), goal, {
      baseUrl,
      fetchImpl: (url, init) => fetch(url, init),
      actor: 'agent',
      principal: `user:${sessionId}`,
      channel: 'chat',
      startRel,
    });

    return Response.json({
      sessionId,
      driver: resolved,
      requestedDriver: requested,
      outcome: result.outcome,
      summary: result.summary ?? null,
      messages: trailToMessages(result),
      steps: result.steps,
      successes: result.successes,
    });
  } catch (error) {
    // 委托不崩溃:循环与 driver 都不应抛出;此处兜底 5xx→结构化 200 失败。
    return Response.json({
      sessionId,
      driver: resolved,
      requestedDriver: requested,
      outcome: 'failed',
      summary: `聊天循环异常: ${error instanceof Error ? error.message : String(error)}`,
      messages: [
        {
          role: 'assistant',
          text: `失败: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      steps: [],
      successes: [],
    });
  }
}
