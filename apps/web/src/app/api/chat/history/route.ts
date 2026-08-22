import type {
  ChatTurn,
  ChatTurnDetail,
  ChatTurnProgressDetail,
  ChatTurnStartedDetail,
} from '../../../../chat/history';
import { listEvents } from '../../../../db/events';
import { getPool } from '../../../../db/pool';

// GET /api/chat/history?sessionId=<id> — 聊天历史投影(T9 Phase B / B3)。
//
// 服务端零会话态:历史 = 事件日志里 kind='chat-turn' 且 rel=chat:<sessionId>
// 的事件按 seq 升序的投影(chat 路由 inline 回合完成时直写,与 worker 同一
// 双写者模式;engine fold 忽略该 kind,纯审计留痕)。返回各回合的
// {seq, ts, goal, outcome, summary, messages, steps, driver},客户端重放进
// 消息列表(goal 作为 user 消息在前,messages 逐条 assistant);
// steps(T11 Phase B)是结构化 TrailStep[] 原料——旧事件无此字段,读出归一
// 为空数组(向后兼容)。
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
    const turnsById = new Map<string, ChatTurn>();
    for (const event of events) {
      if (event.rel !== `chat:${sessionId}`) continue;
      if (event.kind === 'chat-turn-started') {
        const detail = event.detail as ChatTurnStartedDetail;
        turnsById.set(detail.turnId, {
          seq: event.seq,
          ts: event.ts,
          sessionId: detail.sessionId,
          turnId: detail.turnId,
          goal: detail.goal,
          outcome: 'running',
          summary: null,
          messages: [],
          steps: [],
          driver: detail.driver,
          status: 'running',
        });
      } else if (event.kind === 'chat-turn-progress') {
        const detail = event.detail as ChatTurnProgressDetail;
        const turn = turnsById.get(detail.turnId);
        if (turn !== undefined && turn.status === 'running') {
          turn.messages.push(detail.message);
          if (detail.step !== undefined) turn.steps.push(detail.step);
        }
      } else if (event.kind === 'chat-turn') {
        const detail = event.detail as ChatTurnDetail;
        const turnId = detail.turnId ?? `legacy:${event.seq}`;
        turnsById.set(turnId, {
          seq: event.seq,
          ts: event.ts,
          ...detail,
          turnId,
          steps: detail.steps ?? [],
          status: 'final',
        });
      }
    }
    const turns = [...turnsById.values()].sort((a, b) => a.seq - b.seq);
    return Response.json({ turns });
  } catch {
    return Response.json({ error: 'events 数据库不可用' }, { status: 503 });
  }
}
