/**
 * Event-sourced conversation context (T15 Phase D).
 *
 * 该模块只做纯投影：raw user/assistant 原话保持不可变，derived context 可按
 * basedOnSeq 修订。thinking、agent-decision 与 chat-turn-progress 不属于 dialogue。
 * 它不读取数据库、不调用 LLM，也不改变任何业务实体状态。
 */
import type { AgentGoal, FactRef } from '@ui4a/agent';

import type {
  AuthorizedEffect,
  ChatContextProvenance,
  ChatContextUpdatedDetail,
  ChatMessageAppendedDetail,
  ChatMessageProvenance,
  ChatTurnDetail,
  ChatTurnStartedDetail,
  ConversationConstraint,
  ConversationFocus,
  ConversationReferent,
  PendingClarification,
} from './history';

export interface ConversationMessage {
  seq: number;
  ts: string;
  sessionId: string;
  turnId: string;
  messageId: string;
  role: 'user' | 'assistant';
  /** 原文；任何投影都不得 trim、截断或摘要。 */
  content: string;
  provenance: ChatMessageProvenance;
  citations?: FactRef[];
}

export interface ConversationContext {
  activeGoal: AgentGoal | null;
  focus: ConversationFocus | null;
  referents: ConversationReferent[];
  constraints: ConversationConstraint[];
  pendingClarification: PendingClarification | null;
  authorizedEffects: AuthorizedEffect[];
  /** 当前解释使用到的最新日志序号。 */
  basedOnSeq: number;
  /** 产生当前解释的 chat-context-updated 事件序号。 */
  updatedAtSeq: number;
  provenance: ChatContextProvenance | null;
}

export interface ConversationState {
  sessionId: string;
  messages: ConversationMessage[];
  context: ConversationContext;
}

export interface ConversationView {
  sessionId: string;
  recentMessages: ConversationMessage[];
  context: ConversationContext;
  truncatedMessageCount: number;
}

type ConversationEvent = {
  seq: number;
  ts?: string;
  kind: string;
  rel?: string | null;
  detail?: unknown;
};

const DEFAULT_MAX_MESSAGES = 12;

function emptyContext(): ConversationContext {
  return {
    activeGoal: null,
    focus: null,
    referents: [],
    constraints: [],
    pendingClarification: null,
    authorizedEffects: [],
    basedOnSeq: 0,
    updatedAtSeq: 0,
    provenance: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sessionOf(detail: unknown): string | undefined {
  return isRecord(detail) && typeof detail.sessionId === 'string' ? detail.sessionId : undefined;
}

function belongsToSession(event: ConversationEvent, sessionId: string): boolean {
  return event.rel === `chat:${sessionId}` && sessionOf(event.detail) === sessionId;
}

function isMessageDetail(value: unknown): value is ChatMessageAppendedDetail {
  if (!isRecord(value) || !isRecord(value.provenance)) return false;
  return (
    typeof value.sessionId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.messageId === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    (value.provenance.kind === 'user-input' || value.provenance.kind === 'assistant-output')
  );
}

function isContextDetail(value: unknown): value is ChatContextUpdatedDetail {
  if (!isRecord(value) || !isRecord(value.provenance) || !isRecord(value.patch)) return false;
  return (
    typeof value.sessionId === 'string' &&
    Number.isSafeInteger(value.basedOnSeq) &&
    (value as { basedOnSeq: number }).basedOnSeq >= 0 &&
    (value.provenance.kind === 'llm-interpretation' ||
      value.provenance.kind === 'mechanical-projection') &&
    Array.isArray(value.provenance.sourceMessageIds)
  );
}

function cloneGoal(goal: AgentGoal | null): AgentGoal | null {
  if (goal === null) return null;
  return {
    ...goal,
    ...(goal.fields !== undefined ? { fields: { ...goal.fields } } : {}),
  };
}

function cloneProvenance(provenance: ChatContextProvenance): ChatContextProvenance {
  return { ...provenance, sourceMessageIds: [...provenance.sourceMessageIds] };
}

function applyContextUpdate(
  current: ConversationContext,
  event: ConversationEvent,
  detail: ChatContextUpdatedDetail,
): ConversationContext {
  if (detail.basedOnSeq < current.basedOnSeq) return current;

  const { patch } = detail;
  return {
    activeGoal: patch.activeGoal === undefined ? current.activeGoal : cloneGoal(patch.activeGoal),
    focus:
      patch.focus === undefined
        ? current.focus
        : patch.focus === null
          ? null
          : {
              ...patch.focus,
              history: patch.focus.history.map((entry) => ({ ...entry })),
            },
    referents:
      patch.referents === undefined
        ? current.referents
        : patch.referents.map((referent) => ({ ...referent })),
    constraints:
      patch.constraints === undefined
        ? current.constraints
        : patch.constraints.map((constraint) => ({ ...constraint })),
    pendingClarification:
      patch.pendingClarification === undefined
        ? current.pendingClarification
        : patch.pendingClarification === null
          ? null
          : {
              ...patch.pendingClarification,
              continuation: cloneGoal(patch.pendingClarification.continuation)!,
              sourceMessageIds: [...patch.pendingClarification.sourceMessageIds],
            },
    authorizedEffects:
      patch.authorizedEffects === undefined
        ? current.authorizedEffects
        : patch.authorizedEffects.map((authorization) => ({ ...authorization })),
    basedOnSeq: detail.basedOnSeq,
    updatedAtSeq: event.seq,
    provenance: cloneProvenance(detail.provenance),
  };
}

function rawMessage(
  event: ConversationEvent,
  detail: ChatMessageAppendedDetail,
): ConversationMessage {
  return {
    seq: event.seq,
    ts: event.ts ?? '',
    sessionId: detail.sessionId,
    turnId: detail.turnId,
    messageId: detail.messageId,
    role: detail.role,
    content: detail.content,
    provenance: { ...detail.provenance },
    ...(detail.citations !== undefined
      ? { citations: detail.citations.map((citation) => ({ ...citation })) }
      : {}),
  };
}

function isLegacyTurn(value: unknown): value is ChatTurnDetail {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    isRecord(value.goal) &&
    typeof value.goal.verb === 'string' &&
    Array.isArray(value.messages)
  );
}

function isLegacyStarted(value: unknown): value is ChatTurnStartedDetail {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.turnId === 'string' &&
    isRecord(value.goal) &&
    typeof value.goal.verb === 'string'
  );
}

function legacyMessage(
  event: ConversationEvent,
  detail: { sessionId: string; turnId: string },
  role: 'user' | 'assistant',
  content: string,
): ConversationMessage {
  return {
    seq: event.seq,
    ts: event.ts ?? '',
    sessionId: detail.sessionId,
    turnId: detail.turnId,
    messageId: `legacy:${detail.turnId}:${role}`,
    role,
    content,
    provenance: { kind: 'legacy-chat-turn' },
  };
}

/**
 * 从全局日志纯重建单个 session。输入顺序不会被修改；投影按 seq 排序。
 * 新 raw message 存在的 turn 不再消费同 turn 的 legacy chat-turn，避免双记。
 */
export function foldConversation(
  events: readonly ConversationEvent[],
  sessionId: string,
): ConversationState {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const rawTurnIds = new Set(
    ordered
      .filter(
        (event) =>
          event.kind === 'chat-message-appended' &&
          belongsToSession(event, sessionId) &&
          isMessageDetail(event.detail),
      )
      .map((event) => (event.detail as ChatMessageAppendedDetail).turnId),
  );
  const messages: ConversationMessage[] = [];
  const seenMessageIds = new Set<string>();
  let context = emptyContext();

  const append = (item: ConversationMessage): void => {
    if (seenMessageIds.has(item.messageId)) return;
    seenMessageIds.add(item.messageId);
    messages.push(item);
  };

  for (const event of ordered) {
    if (!belongsToSession(event, sessionId)) continue;

    if (event.kind === 'chat-message-appended' && isMessageDetail(event.detail)) {
      append(rawMessage(event, event.detail));
      continue;
    }

    if (event.kind === 'chat-context-updated' && isContextDetail(event.detail)) {
      context = applyContextUpdate(context, event, event.detail);
      continue;
    }

    if (event.kind === 'chat-turn-started' && isLegacyStarted(event.detail)) {
      if (!rawTurnIds.has(event.detail.turnId)) {
        append(legacyMessage(event, event.detail, 'user', event.detail.goal.verb));
      }
      continue;
    }

    if (event.kind === 'chat-turn' && isLegacyTurn(event.detail)) {
      const turnId = event.detail.turnId ?? `legacy:${event.seq}`;
      if (rawTurnIds.has(turnId)) continue;
      const legacyDetail = { sessionId: event.detail.sessionId, turnId };
      append(legacyMessage(event, legacyDetail, 'user', event.detail.goal.verb));
      const finalMessage = event.detail.messages.at(-1);
      if (finalMessage !== undefined) {
        append(legacyMessage(event, legacyDetail, 'assistant', finalMessage.text));
      }
    }
  }

  return { sessionId, messages, context };
}

/**
 * 为 prompt/消费者提供有界近期原话。边界按消息数控制，消息本身保持完整；
 * 更复杂的授权证据保留/字符预算属于 Phase D 后续上下文有界化任务。
 */
export function conversationView(
  events: readonly ConversationEvent[],
  sessionId: string,
  options: { maxMessages?: number } = {},
): ConversationView {
  const state = foldConversation(events, sessionId);
  const requested = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxMessages = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  const recentMessages =
    maxMessages === 0 ? [] : state.messages.slice(Math.max(0, state.messages.length - maxMessages));

  return {
    sessionId,
    recentMessages,
    context: state.context,
    truncatedMessageCount: state.messages.length - recentMessages.length,
  };
}
