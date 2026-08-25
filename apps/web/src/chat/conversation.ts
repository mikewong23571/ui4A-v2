/**
 * Event-sourced conversation context (T15 Phase D).
 *
 * 该模块只做纯投影：raw user/assistant 原话保持不可变，derived context 可按
 * basedOnSeq 修订。thinking、agent-decision 与 chat-turn-progress 不属于 dialogue。
 * 它不读取数据库、不调用 LLM，也不改变任何业务实体状态。
 */
import type { AgentGoal, FactRef } from '@ui4a/agent';
import {
  parseClientViewReport,
  parseNavigationCompletion,
  type ClientViewFact,
  type ClientViewReport,
  type LastNavigationFact,
} from '@ui4a/shared';

import type {
  AuthorizedEffect,
  ChatContextProvenance,
  ChatContextUpdatedDetail,
  ChatMessageAppendedDetail,
  ChatMessageProvenance,
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
  clientView?: ClientViewReport;
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
  clientView: ClientViewFact | null;
  lastNavigation: LastNavigationFact | null;
}

export interface ConversationView {
  sessionId: string;
  recentMessages: ConversationMessage[];
  context: ConversationContext;
  clientView: ClientViewFact | null;
  lastNavigation: LastNavigationFact | null;
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
  const base =
    typeof value.sessionId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.messageId === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    (value.provenance.kind === 'user-input' || value.provenance.kind === 'assistant-output');
  if (!base) return false;
  if (value.clientView === undefined) return true;
  if (value.role !== 'user') return false;
  try {
    parseClientViewReport(value.clientView);
    return true;
  } catch {
    return false;
  }
}

function parsedNavigationDetail(value: unknown) {
  try {
    return parseNavigationCompletion(value);
  } catch {
    return undefined;
  }
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
    ...(detail.clientView === undefined
      ? {}
      : { clientView: parseClientViewReport(detail.clientView) }),
  };
}

/**
 * 从全局日志纯重建单个 session。输入顺序不会被修改；投影按 seq 排序。
 * dialogue 原话只来自 chat-message-appended；chat-turn / chat-turn-started /
 * chat-turn-progress 是回合审计与在途进度事件，不进入对话投影。
 */
export function foldConversation(
  events: readonly ConversationEvent[],
  sessionId: string,
): ConversationState {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const messages: ConversationMessage[] = [];
  const seenMessageIds = new Set<string>();
  const seenNavigationIds = new Set<string>();
  let context = emptyContext();
  let clientView: ClientViewFact | null = null;
  let lastNavigation: LastNavigationFact | null = null;

  const append = (item: ConversationMessage): void => {
    if (seenMessageIds.has(item.messageId)) return;
    seenMessageIds.add(item.messageId);
    messages.push(item);
  };

  for (const event of ordered) {
    if (!belongsToSession(event, sessionId)) continue;

    if (event.kind === 'chat-message-appended' && isMessageDetail(event.detail)) {
      const item = rawMessage(event, event.detail);
      append(item);
      if (item.role === 'user') {
        clientView =
          item.clientView === undefined
            ? null
            : {
                ...item.clientView,
                sourceMessageId: item.messageId,
                observedAtSeq: item.seq,
              };
      }
      continue;
    }

    if (event.kind === 'chat-navigation-completed') {
      const detail = parsedNavigationDetail(event.detail);
      if (detail === undefined || seenNavigationIds.has(detail.navigationId)) continue;
      seenNavigationIds.add(detail.navigationId);
      lastNavigation = { ...detail, completedAtSeq: event.seq };
      continue;
    }

    if (event.kind === 'chat-context-updated' && isContextDetail(event.detail)) {
      context = applyContextUpdate(context, event, event.detail);
      continue;
    }
  }

  return { sessionId, messages, context, clientView, lastNavigation };
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
    clientView: state.clientView,
    lastNavigation: state.lastNavigation,
    truncatedMessageCount: state.messages.length - recentMessages.length,
  };
}
