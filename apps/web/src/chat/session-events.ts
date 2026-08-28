/**
 * chat 会话事件投影写面(T36 B1 自 route.ts 提取)。
 *
 * 会话真相的机械落库族:回合投影(chat-turn-started/progress/chat-turn)、
 * 会话消息/上下文追加(chat-message-appended/chat-context-updated)、导航完成
 * 留痕(chat-navigation-completed)与回合装配读面(loadAgentConversation:
 * conversationView + executionAuditContext 的 Agent 上下文投影)。
 * 落库失败不阻断聊天响应(投影是审计,响应才是合同)。
 */
import type {
  ConversationContext as AgentConversationContext,
  ConversationMessage as AgentConversationMessage,
  FactRef,
} from '@ui4a/agent';
import type { ClientViewReport, NavigationCompletion } from '@ui4a/shared';

import type { ChatTurnDetail, ChatTurnProgressDetail, ChatTurnStartedDetail } from './history';
import { executionAuditContext } from './audit-context';
import { conversationView } from './conversation';
import { appendEvent, readLog } from '@ui4a/db/events';
import { getDb } from '../engine/service';

export async function appendChatProjection(
  kind: 'chat-turn-started' | 'chat-turn-progress' | 'chat-turn',
  sessionId: string,
  detail: ChatTurnStartedDetail | ChatTurnProgressDetail | ChatTurnDetail,
  principal = `user:${sessionId}`,
): Promise<number | undefined> {
  try {
    const appended = await appendEvent(getDb(), {
      kind,
      actor: 'agent',
      principal,
      channel: 'chat',
      rel: `chat:${sessionId}`,
      detail,
    });
    return appended.seq;
  } catch (persistError) {
    console.error(`${kind} 事件落库失败(不阻断聊天响应):`, persistError);
    return undefined;
  }
}

export async function appendConversationMessage(args: {
  sessionId: string;
  principal?: string;
  turnId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  citations?: FactRef[];
  clientView?: ClientViewReport;
}): Promise<number> {
  const appended = await appendEvent(getDb(), {
    kind: 'chat-message-appended',
    actor: args.role === 'user' ? 'human' : 'agent',
    principal: args.principal ?? `user:${args.sessionId}`,
    channel: 'chat',
    rel: `chat:${args.sessionId}`,
    detail: {
      sessionId: args.sessionId,
      turnId: args.turnId,
      messageId: args.messageId,
      role: args.role,
      content: args.content,
      provenance:
        args.role === 'user'
          ? { kind: 'user-input' as const }
          : { kind: 'assistant-output' as const, ...(args.model ? { model: args.model } : {}) },
      ...(args.citations !== undefined ? { citations: args.citations } : {}),
      ...(args.clientView === undefined ? {} : { clientView: args.clientView }),
    },
  });
  return appended.seq;
}

export async function appendConversationContext(args: {
  sessionId: string;
  principal?: string;
  basedOnSeq: number;
  sourceMessageIds: string[];
  patch: Record<string, unknown>;
}): Promise<void> {
  await appendEvent(getDb(), {
    kind: 'chat-context-updated',
    actor: 'agent',
    principal: args.principal ?? `user:${args.sessionId}`,
    channel: 'chat',
    rel: `chat:${args.sessionId}`,
    detail: {
      sessionId: args.sessionId,
      basedOnSeq: args.basedOnSeq,
      provenance: { kind: 'mechanical-projection', sourceMessageIds: args.sourceMessageIds },
      patch: args.patch,
    },
  });
}

export async function appendNavigationCompletion(
  completion: NavigationCompletion,
  principal = `user:${completion.sessionId}`,
): Promise<void> {
  await appendEvent(getDb(), {
    kind: 'chat-navigation-completed',
    actor: 'agent',
    principal,
    channel: 'chat',
    rel: `chat:${completion.sessionId}`,
    detail: completion,
  });
}

export async function loadAgentConversation(
  sessionId: string,
  principal = `user:${sessionId}`,
): Promise<{
  messages: AgentConversationMessage[];
  context: AgentConversationContext;
  clientView: ReturnType<typeof conversationView>['clientView'];
  lastNavigation: ReturnType<typeof conversationView>['lastNavigation'];
}> {
  const events = await readLog(getDb());
  const view = conversationView(events, sessionId);
  const executionAudit = executionAuditContext(events, principal);
  return {
    messages: view.recentMessages.map(({ messageId, role, content }) => ({
      messageId,
      role,
      content,
    })),
    clientView: view.clientView,
    lastNavigation: view.lastNavigation,
    context: {
      ...(view.context.activeGoal !== null ? { activeGoal: view.context.activeGoal } : {}),
      ...(view.context.focus !== null
        ? {
            focus: {
              ...(view.context.focus.currentRel !== null
                ? { currentRel: view.context.focus.currentRel }
                : {}),
              history: view.context.focus.history.map((entry) => ({ ...entry })),
            },
          }
        : {}),
      ...(view.context.referents.length > 0
        ? { referents: view.context.referents.map((referent) => ({ ...referent })) }
        : {}),
      ...(view.context.constraints.length > 0
        ? { constraints: view.context.constraints.map((constraint) => ({ ...constraint })) }
        : {}),
      ...(view.context.authorizedEffects.length > 0
        ? {
            authorizedEffects: view.context.authorizedEffects.map((authorization) => ({
              ...authorization,
            })),
          }
        : {}),
      ...(view.context.pendingClarification !== null
        ? {
            pendingClarification: {
              question: view.context.pendingClarification.question,
              continuation: view.context.pendingClarification.continuation,
              sourceMessageIds: [...view.context.pendingClarification.sourceMessageIds],
            },
          }
        : {}),
      ...(executionAudit.length > 0 ? { executionAudit } : {}),
    },
  };
}
