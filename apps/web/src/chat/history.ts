/**
 * 聊天历史投影的公共类型(T9 Phase B / B3)。
 *
 * chat-turn 事件(chat 路由 inline 回合完成时直写事件日志,与 worker 同一
 * 双写者模式)→ GET /api/chat/history 按 sessionId 过滤投影为本类型序列
 * (seq 升序)。服务端零会话态:会话是客户端对日志的投影。
 */
import type { AgentGoal, AgentOutcome } from '@ui4a/agent';

import type { ChatMessage } from './trail';

/** chat-turn 事件的 detail 载荷(chat 路由写入端与 history 读端同一形状)。 */
export interface ChatTurnDetail {
  sessionId: string;
  goal: AgentGoal;
  outcome: AgentOutcome;
  summary: string | null;
  messages: ChatMessage[];
  driver: 'rule' | 'llm';
}

/** history 端点返回的回合(seq/ts 由日志层分配)。 */
export interface ChatTurn extends ChatTurnDetail {
  seq: number;
  ts: string;
}

/** sessions 端点返回的会话清单行(chat-turn 事件按 sessionId 分组的投影)。 */
export interface ChatSessionSummary {
  sessionId: string;
  turns: number;
  firstTs: string;
  lastTs: string;
  /** 末回合目标动词(清单摘要)。 */
  lastGoal: string;
  lastOutcome: string;
}
