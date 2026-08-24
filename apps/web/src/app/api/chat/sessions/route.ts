import type {
  ChatSessionSummary,
  ChatTurnDetail,
  ChatTurnStartedDetail,
} from '../../../../chat/history';
import { listEvents } from '../../../../db/events';
import { getDb } from '../../../../engine/service';

// GET /api/chat/sessions — 聊天会话清单投影(T9 补:历史会话入口)。
//
// 服务端零会话态:清单 = 事件日志里 kind='chat-turn' 事件按 rel=chat:<sessionId>
// 分组的投影(与 /api/chat/history 同一真相源)。每组聚合:{sessionId, turns
// (回合数), firstTs, lastTs, lastGoal(末回合目标动词), lastOutcome},按 lastTs
// 倒序(最近活跃在前)。空日志 → { sessions: [] };db 不可达 → 503。

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const events = await listEvents(getDb());
    const bySession = new Map<string, ChatSessionSummary>();
    const seenTurns = new Set<string>();
    for (const event of events) {
      if (
        (event.kind !== 'chat-turn' && event.kind !== 'chat-turn-started') ||
        event.rel === null ||
        !event.rel.startsWith('chat:')
      ) {
        continue;
      }
      const detail = event.detail as ChatTurnDetail | ChatTurnStartedDetail;
      const sessionId = detail.sessionId ?? event.rel.slice('chat:'.length);
      const turnId = detail.turnId ?? `legacy:${event.seq}`;
      const turnKey = `${sessionId}:${turnId}`;
      const firstForTurn = !seenTurns.has(turnKey);
      seenTurns.add(turnKey);
      const ts = event.ts;
      const existing = bySession.get(sessionId);
      if (existing === undefined) {
        bySession.set(sessionId, {
          sessionId,
          turns: 1,
          firstTs: ts,
          lastTs: ts,
          lastGoal: detail.goal?.verb ?? '',
          lastOutcome:
            event.kind === 'chat-turn-started'
              ? 'running'
              : ((detail as ChatTurnDetail).outcome ?? ''),
        });
      } else {
        // listEvents 按 seq 升序:后见即更新(末回合口径)。
        if (firstForTurn) existing.turns += 1;
        existing.lastTs = ts;
        existing.lastGoal = detail.goal?.verb ?? existing.lastGoal;
        existing.lastOutcome =
          event.kind === 'chat-turn-started'
            ? 'running'
            : ((detail as ChatTurnDetail).outcome ?? existing.lastOutcome);
      }
    }
    const sessions = [...bySession.values()].sort((a, b) => b.lastTs.localeCompare(a.lastTs));
    return Response.json({ sessions });
  } catch {
    return Response.json({ error: 'events 数据库不可用' }, { status: 503 });
  }
}
