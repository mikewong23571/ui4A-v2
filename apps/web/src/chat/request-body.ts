/**
 * POST /api/chat 请求体合同解析(T36 B1 自 route.ts 提取)。
 *
 * 只做形状校验与缺省补全:goal 五键逐键校验、driver 仅 llm|auto(rule 已退出
 * 产品运行时)、mode inline|delegated、clientView 经 parseClientViewReport
 * 结构化解析;sessionId/turnId 缺省 crypto.randomUUID()。
 */
import type { AgentGoal } from '@ui4a/agent';
import { parseClientViewReport, type ClientViewReport } from '@ui4a/shared';

export interface ParsedChatBody {
  ok: true;
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  driver: 'llm' | 'auto';
  mode: 'inline' | 'delegated';
  clientView?: ClientViewReport;
}

export interface ParseError {
  ok: false;
  error: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBody(body: unknown): ParsedChatBody | ParseError {
  if (!isPlainObject(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' };
  }
  const { goal, sessionId, turnId, driver, mode, clientView } = body;
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
  if (turnId !== undefined && typeof turnId !== 'string') {
    return { ok: false, error: 'turnId 必须是字符串' };
  }
  if (driver === 'rule') {
    return { ok: false, error: 'rule driver 已退出产品运行时；driver 仅支持 "llm" | "auto"' };
  }
  if (driver !== undefined && driver !== 'llm' && driver !== 'auto') {
    return { ok: false, error: 'driver 必须是 "llm" | "auto"' };
  }
  if (mode !== undefined && mode !== 'inline' && mode !== 'delegated') {
    return { ok: false, error: 'mode 必须是 "inline" | "delegated"' };
  }
  let parsedClientView: ClientViewReport | undefined;
  if (clientView !== undefined) {
    try {
      parsedClientView = parseClientViewReport(clientView);
    } catch (error) {
      return {
        ok: false,
        error: `clientView 无效: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return {
    ok: true,
    // 双重断言理由:goal 的 verb/targetRel/resource/fields 各键已在上文逐键校验,
    // Record<string,unknown> 与 AgentGoal 结构不重叠是 TS 的保守判断,运行时形状已收敛。
    goal: goal as unknown as AgentGoal,
    sessionId: sessionId ?? crypto.randomUUID(),
    turnId: turnId ?? crypto.randomUUID(),
    driver: driver ?? 'auto',
    mode: mode ?? 'inline',
    ...(parsedClientView === undefined ? {} : { clientView: parsedClientView }),
  };
}
