import type {
  ChatTurn,
  ChatTurnDetail,
  ChatTurnProgressDetail,
  ChatTurnStartedDetail,
} from '../../../../chat/history';
import { chatHistoryPrincipal, chatHistoryReadError } from '../../../../chat/history-access';
import { citationsOrEmpty } from '../../../../chat/citations';
import { listEvents } from '@ui4a/db/events';
import { getDb } from '../../../../engine/service';

// GET /api/chat/history?sessionId=<id> — 聊天历史投影(T9 Phase B / B3)。
//
// 服务端零会话态:历史 = 事件日志里 kind='chat-turn' 且 rel=chat:<sessionId>
// 的事件按 seq 升序的投影(chat 路由 inline 回合完成时直写,与 worker 同一
// 双写者模式;engine fold 忽略该 kind,纯审计留痕)。返回各回合的
// {seq, ts, goal, outcome, summary, messages, steps, driver},客户端重放进
// 消息列表(goal 作为 user 消息在前,messages 逐条 assistant);
// steps(T11 Phase B)是结构化 TrailStep[] 原料。
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
      ...(principal === undefined ? {} : { principal }),
    });
    const turnsById = new Map<string, ChatTurn>();
    const citationsByTurnId = new Map<string, ChatTurn['citations']>();
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
        turnsById.set(detail.turnId, {
          seq: event.seq,
          ts: event.ts,
          ...detail,
          status: 'final',
        });
      } else if (event.kind === 'chat-message-appended') {
        const detail = event.detail;
        if (typeof detail !== 'object' || detail === null) continue;
        const candidate = detail as Record<string, unknown>;
        if (
          candidate.sessionId !== sessionId ||
          candidate.role !== 'assistant' ||
          typeof candidate.turnId !== 'string' ||
          candidate.citations === undefined
        ) {
          continue;
        }
        const citations = citationsOrEmpty(candidate.citations);
        if (citations.length > 0) citationsByTurnId.set(candidate.turnId, citations);
      }
    }
    for (const [turnId, citations] of citationsByTurnId) {
      const turn = turnsById.get(turnId);
      if (turn?.status === 'final') turn.citations = citations;
    }
    const turns = [...turnsById.values()].sort((a, b) => a.seq - b.seq);
    return Response.json({ turns });
  } catch (error) {
    return chatHistoryReadError(error);
  }
}
