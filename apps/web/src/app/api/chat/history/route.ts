import type { ChatTurnDetail } from '../../../../chat/history';
import { listEvents } from '../../../../db/events';
import { getPool } from '../../../../db/pool';

// GET /api/chat/history?sessionId=<id> — 聊天历史投影(T9 Phase B / B3)。
//
// 服务端零会话态:历史 = 事件日志里 kind='chat-turn' 且 rel=chat:<sessionId>
// 的事件按 seq 升序的投影(chat 路由 inline 回合完成时直写,与 worker 同一
// 双写者模式;engine fold 忽略该 kind,纯审计留痕)。返回各回合的
// {seq, ts, goal, outcome, summary, messages, driver},客户端重放进消息列表
// (goal 作为 user 消息在前,messages 逐条 assistant)。
//
// - 缺 sessionId → 400;db 不可达 → 503(不抛 500);
// - 无该会话的回合 → { turns: [] }(空态,非错误)。

export const dynamic = 'force-dynamic';

const DEFAULT_DATABASE_URL = 'postgres://ui4a:ui4a@localhost:5433/ui4a';

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (sessionId === null || sessionId === '') {
    return Response.json({ error: 'sessionId 查询参数必填' }, { status: 400 });
  }

  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  try {
    const events = await listEvents(getPool(connectionString));
    const turns = events
      .filter((event) => event.kind === 'chat-turn' && event.rel === `chat:${sessionId}`)
      .map((event) => ({
        seq: event.seq,
        ts: event.ts,
        ...(event.detail as ChatTurnDetail),
      }));
    return Response.json({ turns });
  } catch {
    return Response.json({ error: 'events 数据库不可用' }, { status: 503 });
  }
}
