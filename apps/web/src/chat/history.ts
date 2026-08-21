/**
 * 聊天历史投影的公共类型(T9 Phase B / B3;T11 Phase B 增结构化 steps)。
 *
 * chat-turn 事件(chat 路由 inline 回合完成时直写事件日志,与 worker 同一
 * 双写者模式)→ GET /api/chat/history 按 sessionId 过滤投影为本类型序列
 * (seq 升序)。服务端零会话态:会话是客户端对日志的投影。
 */
import type { AgentGoal, AgentOutcome, TrailStep } from '@ui4a/agent';

import type { ChatMessage } from './trail';

/** chat-turn 事件的 detail 载荷(chat 路由写入端与 history 读端同一形状)。 */
export interface ChatTurnDetail {
  sessionId: string;
  goal: AgentGoal;
  outcome: AgentOutcome;
  summary: string | null;
  /** 人读投影(trailToMessages 压扁;渲染用,口径不变)。 */
  messages: ChatMessage[];
  /**
   * 结构化轨迹原料(T11 Phase B / 架构决定 2):runAgent 的 TrailStep[] 原样
   * 落库——messages 是人读投影,steps 是机器可读原料(轨迹挖掘/蒸馏的数据
   * 飞轮)。向后兼容:T11 前写入的旧事件无此字段,history 读端归一为空数组。
   */
  steps: TrailStep[];
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
