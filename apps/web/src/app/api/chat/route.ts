// POST /api/chat — 悬浮聊天的合同后端(spec FR6/FR7,arch-brief §8)。
// T55/D75:POST 收缩为四段编排壳,职责模块与行为归属如下(合同语义零变化,
// 既有 9 个 chat route 测试文件为特征化基线,断言零删除):
// 1. 鉴权身份 `src/chat/post-identity`——生产 preflight/身份解析(resolveProductionIdentity)
//    与 inline 回合的 delegated credential 交换 + bounded fetch(buildTurnFetch);
//    错误码族(deployment_config_invalid/request_origin_invalid/credential_malformed/
//    agent_*)与 D51 收窄语义在模块内保持;
// 2. 请求体 `src/chat/request-body`——形状校验与缺省补全(既有合同,复用);
// 3. 会话编排 `src/chat/turn-context`——principal 双轴 + Situation 单点装配
//    (resolveTurnSituation),起步 rel 降级 + 用户消息/thread/会话装载/
//    chat-turn-started 投影(prepareTurnSession);
// 4. 响应 `src/chat/turn-response`——baseUrl 口径(终审 M-2)、平面归属与 D66
//    显式 lens、AI-first 配置检查(prepareTurnDispatch),configurationFailure /
//    delegated / inline 三分支(respondToTurn);SSE 帧序列与审计口径全在
//    `src/chat/inline-stream` 与 `src/chat/session-events`。
// 服务无会话态:事件日志是真相,聊天会话是客户端投影(localStorage)。
import { parseBody } from '../../../chat/request-body';
import { buildTurnFetch, resolveProductionIdentity } from '../../../chat/post-identity';
import { prepareTurnSession, resolveTurnSituation } from '../../../chat/turn-context';
import { prepareTurnDispatch, respondToTurn } from '../../../chat/turn-response';
import { getDb, getEngine } from '../../../engine/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);

  // 段 1:鉴权身份(生产束或本地 undefined;错误即结构化 Response)。
  const production = await resolveProductionIdentity(request);
  if (production instanceof Response) return production;

  // 段 2:请求体解析校验。
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
  const { goal, turnId, driver: requested, mode, clientView, sessionId } = parsed;

  // 段 3a:principal 双轴 + Situation(lens 服务端单点装配)。
  const turn = await resolveTurnSituation({
    identity: production?.identity,
    sessionId,
    clientView,
  });

  // 段 1b:inline 凭证交换与 turnFetch 构造(顺序保持:身份 → situation → 交换)。
  const turnFetch = await buildTurnFetch({ request, mode, production });
  if (turnFetch instanceof Response) return turnFetch;

  // 段 4a:baseUrl 口径 + 平面归属/显式 lens + AI-first 配置检查。
  const plan = prepareTurnDispatch({
    requestUrl,
    mode,
    productionOrigin: production?.origin,
    situation: turn.situation,
    goal,
  });
  if (plan instanceof Response) return plan;

  // 段 3b:起步 rel + 用户消息/会话装载/turn-started 投影。
  const session = await prepareTurnSession({
    goal,
    sessionId,
    turnId,
    clientView,
    mode,
    identity: production?.identity,
    turn,
  });

  // 段 4b:configurationFailure / delegated / inline 三分支响应。
  return respondToTurn({ goal, sessionId, turnId, requested, mode, turn, session, plan, turnFetch });
}
