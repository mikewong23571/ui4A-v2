/**
 * chat 面板共享类型与持久化键(T23 Phase D 自 chat-panel.tsx 拆出):
 * 面板消息形状、一次性 JSON/委托派发响应形状、localStorage 键与装载器、
 * useChatSession 的对外会话契约。纯类型/常量/纯函数,零 React 状态。
 */
import type { ThreadMessageLike, useExternalStoreRuntime } from '@assistant-ui/react';

import type { ChatSessionSummary } from '@/chat/history';
import type { ChatStepActivity } from '@/chat/sse';

/**
 * 面板内消息(rel 为轨迹步的实体 rel:flow 徽章展示用,见 thread.tsx;
 * activity/eventSeq 为 T24 Phase B 结构化轨迹数据:activity 在场时主呈现为
 * 活动语言(机器原文 content 保留作机器层),eventSeq 供审计下钻定位;
 * 历史回放消息只有 text 投影,如实按原文渲染,不伪造结构化数据)。
 */
export interface ChatUiMessage {
  role: 'user' | 'assistant';
  content: string;
  rel?: string;
  /** 思考区条目以回合 + 步号唯一标识，content 为该步推理自述全文。 */
  thinking?: { turnId: string; step: number };
  /** 轨迹步活动数据(SSE step 帧 activity);在场时 thread 渲染活动语言。 */
  activity?: ChatStepActivity;
  /** 对应 chat-turn-progress 事件的日志 seq(审计下钻)。 */
  eventSeq?: number;
}

/** 一次性 JSON 响应形状(render 短路/兼容路径;inline 已转 SSE)。 */
export interface ChatJsonResponse {
  sessionId?: string;
  outcome?: string;
  summary?: string | null;
  messages?: { role: 'assistant'; text: string }[];
  render?: {
    concern: string;
    canvasUrl: string;
  };
  focus?: { rel: string; canvasUrl: string };
  error?: string | { code?: string };
}

/** /api/chat mode=delegated 的派发回执(T5 Phase B)。 */
export interface DelegatedResponse {
  mode?: 'delegated';
  delegationId?: string;
  sessionId?: string;
}

export const SESSION_STORAGE_KEY = 'ui4a.chat.sessionId';
export const PENDING_SESSION_STORAGE_KEY = 'ui4a.chat.pendingSessionId';

// 思考过程开关的持久化键 'ui4a.chat.thinking' 已随 T24 Phase B 退役:思考区
// 默认折叠常在(可展开),无需全局隐藏偏好。该键不再被读写,遗留值失效、
// 无迁移(呈现层偏好不再持久化,折叠/展开是即时交互态)。

/** 客户端流空闲超时:有效帧/heartbeat 会续期，不再把总时长误判为超时。 */
export const STREAM_IDLE_TIMEOUT_MS = 120_000;

export function loadSessionId(): string {
  try {
    return globalThis.localStorage?.getItem(SESSION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function convertMessage(message: ChatUiMessage): ThreadMessageLike {
  const custom: Record<string, unknown> = {};
  if (message.rel !== undefined) custom['rel'] = message.rel;
  if (message.thinking !== undefined) {
    custom['thinking'] = message.thinking.step;
    custom['thinkingTurnId'] = message.thinking.turnId;
  }
  if (message.activity !== undefined) custom['activity'] = message.activity;
  if (message.eventSeq !== undefined) custom['eventSeq'] = message.eventSeq;
  return {
    role: message.role,
    content: [{ type: 'text', text: message.content }],
    ...(Object.keys(custom).length > 0 ? { metadata: { custom } } : {}),
  };
}

export interface ChatSession {
  sessionId: string;
  isRunning: boolean;
  delegated: boolean;
  lastRender: { concern: string; canvasUrl: string } | undefined;
  /** Thin Presentation receipt target; full Surface never enters Chat state. */
  lastPresentation: { canvasUrl: string } | undefined;
  /** agent 当前查看的实体引用（临时共享处境，不是凝固布局）。 */
  lastFocus: { rel: string; canvasUrl: string } | undefined;
  toggleDelegated: () => void;
  startNewSession: () => void;
  runtime: ReturnType<typeof useExternalStoreRuntime>;
  /** 会话清单视图(T9 补):'chat' 会话态 / 'sessions' 清单态。 */
  view: 'chat' | 'sessions';
  /** 清单数据(null = 未加载/加载中;[] = 空态)。 */
  sessions: ChatSessionSummary[] | null;
  /** 打开清单视图(每次重新拉取——清单是日志投影,拉取即最新)。 */
  openSessions: () => void;
  /** 返回会话视图。 */
  closeSessions: () => void;
  /** 切换到指定历史会话(持久化 sessionId + 重放该会话回合)。 */
  selectSession: (sessionId: string) => void;
}
