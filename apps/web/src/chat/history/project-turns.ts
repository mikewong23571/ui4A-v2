/**
 * GET /api/chat/history 的纯回合投影(T56 P3.3 / D78 决定 5;自 route.ts 原位
 * 提取)。chat-turn-started/progress/chat-turn → ChatTurn 的既有口径不变,并
 * 完成历史「时点读」扩展:同 rel 下 user 角色 chat-message-appended 按
 * principal×sessionId×turnId 精确 join 出该回合当时的 clientView。写侧零变
 * 化、零回填、零事件种类变化:
 *
 * - `userContextKnown` = 是否找到该回合的 user 原话事件,区分「事件存在但无
 *   clientView(旧版)」与「user 事件整体缺失」;两者 UI 都按「当时上下文
 *   未知」呈现,审计口径可分。
 * - `clientView` 仅在该 user 事件在场且携带可解析观察时附加;损坏观察按缺失
 *   处理(事件存在性口径保留)。禁止用最新 presence、当前 URL 或最近一条
 *   clientView 补旧回合(D51 注意力纪律)。
 *
 * 输入是调用方已按 {rel, principal} 过滤取界的事件切片(存储边界在 route);
 * 本函数再做 belongsToSession 式再校验作为纵深防御(D68.3 双键口径):rel 与
 * detail.sessionId 都必须命中会话,principal 提供时事件 principal 列必须一致
 * (缺省 = dev 开放视图,不校验,与 chatHistoryPrincipal 的开放口径一致)。
 */
import { parseClientViewReport, type ClientViewReport } from '@ui4a/shared';

import { citationsOrEmpty } from '../citations';
import type {
  ChatTurn,
  ChatTurnDetail,
  ChatTurnProgressDetail,
  ChatTurnStartedDetail,
} from '../history';

/** history 投影所需的最小事件切片形状(StoredEvent 的结构子集)。 */
export interface ChatHistoryEvent {
  seq: number;
  ts: string;
  kind: string;
  rel: string | null;
  principal?: string | null;
  detail: unknown;
}

export interface ProjectChatTurnsOptions {
  sessionId: string;
  /** 提供时按事件 principal 列再校验(D68.3 双键);缺省为开放视图。 */
  principal?: string;
}

function detailRecord(detail: unknown): Record<string, unknown> | null {
  return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : null;
}

export function projectChatTurns(
  events: readonly ChatHistoryEvent[],
  options: ProjectChatTurnsOptions,
): ChatTurn[] {
  const { sessionId, principal } = options;
  const inSession = (event: ChatHistoryEvent): boolean =>
    event.rel === `chat:${sessionId}` && (principal === undefined || event.principal === principal);

  const turnsById = new Map<string, ChatTurn>();
  const citationsByTurnId = new Map<string, ChatTurn['citations']>();
  // 该回合 user 原话事件是否在场(known 的唯一来路;精确 join 键=turnId)。
  const seenUserTurnIds = new Set<string>();
  // 该回合当时的观察(仅在事件在场且观察可解析时置位;不回填、不补最新)。
  const userViewsByTurnId = new Map<string, ClientViewReport>();

  for (const event of events) {
    if (!inSession(event)) continue;
    if (event.kind === 'chat-turn-started') {
      const detail = event.detail as ChatTurnStartedDetail;
      if (detail.sessionId !== sessionId) continue;
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
        userContextKnown: false,
      });
    } else if (event.kind === 'chat-turn-progress') {
      const detail = event.detail as ChatTurnProgressDetail;
      if (detail.sessionId !== sessionId) continue;
      const turn = turnsById.get(detail.turnId);
      if (turn !== undefined && turn.status === 'running') {
        turn.messages.push(detail.message);
        if (detail.step !== undefined) turn.steps.push(detail.step);
      }
    } else if (event.kind === 'chat-turn') {
      const detail = event.detail as ChatTurnDetail;
      if (detail.sessionId !== sessionId) continue;
      turnsById.set(detail.turnId, {
        seq: event.seq,
        ts: event.ts,
        ...detail,
        status: 'final',
        userContextKnown: false,
      });
    } else if (event.kind === 'chat-message-appended') {
      const candidate = detailRecord(event.detail);
      if (
        candidate === null ||
        candidate.sessionId !== sessionId ||
        typeof candidate.turnId !== 'string'
      ) {
        continue;
      }
      if (candidate.role === 'user') {
        seenUserTurnIds.add(candidate.turnId);
        if (candidate.clientView !== undefined) {
          try {
            userViewsByTurnId.set(candidate.turnId, parseClientViewReport(candidate.clientView));
          } catch {
            // 损坏观察按缺失处理:known 保留(事件在场),观察不伪造。
          }
        }
        continue;
      }
      if (candidate.role === 'assistant' && candidate.citations !== undefined) {
        const citations = citationsOrEmpty(candidate.citations);
        if (citations.length > 0) citationsByTurnId.set(candidate.turnId, citations);
      }
    }
  }

  for (const [turnId, citations] of citationsByTurnId) {
    const turn = turnsById.get(turnId);
    if (turn?.status === 'final') turn.citations = citations;
  }
  return [...turnsById.values()]
    .map((turn) => {
      const view = userViewsByTurnId.get(turn.turnId);
      return {
        ...turn,
        userContextKnown: seenUserTurnIds.has(turn.turnId),
        ...(view === undefined ? {} : { clientView: view }),
      };
    })
    .sort((a, b) => a.seq - b.seq);
}
