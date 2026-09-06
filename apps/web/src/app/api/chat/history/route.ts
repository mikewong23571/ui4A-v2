import { chatHistoryPrincipal, chatHistoryReadError } from '../../../../chat/history/access';
import { projectChatTurns } from '../../../../chat/history/project-turns';
import { listEvents } from '@ui4a/db/events';
import { getDb } from '../../../../engine/service';

// GET /api/chat/history?sessionId=<id> — 聊天历史投影(T9 Phase B / B3)。
//
// 服务端零会话态:历史 = 事件日志里 rel=chat:<sessionId> 的 chat 事件按 seq
// 升序的投影(chat 路由 inline 回合完成时直写,与 worker 同一双写者模式;
// engine fold 忽略 chat-turn 种 kind,纯审计留痕)。返回各回合的
// {seq, ts, goal, outcome, summary, messages, steps, driver},客户端重放进
// 消息列表(goal 作为 user 消息在前,messages 逐条 assistant);steps(T11
// Phase B)是结构化 TrailStep[] 原料。回合另附当时的 clientView 与
// userContextKnown(T56 P3.3 / D78 决定 5:与同 rel 下 user 原话事件按
// principal×sessionId×turnId 精确 join,零回填;join 语义见 project-turns)。
//
// 读取按 {rel, principal} 过滤取界(D78 决定 5:有界性来自按会话过滤,不是
// 按页截断——listEvents 显式 limit 硬顶 101,任何默认页上限都会把页外回合与
// citations 静默截没;生产 principal 过滤经 chatHistoryPrincipal 保持,dev
// 开放视图不变)。投影侧再做 belongsToSession 式双键再校验(D68.3 纵深防御)。
//
// - 缺 sessionId → 400;db 不可达 → 503(不抛 500);
// - 无该会话的回合 → { turns: [] }(空态,非错误)。

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (sessionId === null || sessionId === '') {
    return Response.json({ error: 'sessionId 查询参数必填' }, { status: 400 });
  }

  try {
    const principal = await chatHistoryPrincipal(request);
    const events = await listEvents(getDb(), 0, {
      rel: `chat:${sessionId}`,
      ...(principal === undefined ? {} : { principal }),
    });
    const turns = projectChatTurns(events, {
      sessionId,
      ...(principal === undefined ? {} : { principal }),
    });
    return Response.json({ turns });
  } catch (error) {
    return chatHistoryReadError(error);
  }
}
