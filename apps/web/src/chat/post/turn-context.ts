// POST /api/chat 会话编排段(T55/D75 四段提取;行为自 route.ts 逐字迁移)。
// - resolveTurnSituation:身份 → principal 双轴(所有权轴 = 认证 principal 或
//   user:<sessionId>[D68];Presentation Sidecar 轴 = 认证 principal 或
//   local-user)+ Presentation 上下文 + Situation(D51:授予集合随上下文下传
//   Broker,注意力 lens 由服务端单点装配);
// - prepareTurnSession:起步 rel(T40 B1:虚主体/不存在/授权外一律降级 scope
//   entry → 站点兜底)→ 用户消息落库 → thread 附着 → agent 会话装载 →
//   chat-turn-started 投影。
import type { AgentGoal } from '@ui4a/agent';
import type { ClientViewReport } from '@ui4a/shared';

import type { TrustedRequestAuditContext } from '../../auth/request-identity';
import { presentationContextForIdentity, situationForChat } from '../../engine/chat-situation';
import { attachChatMessageToThread } from '../../engine/chat-thread';
import { getDb, getEngine } from '../../engine/service';
import { appendChatProjection, appendConversationMessage, loadAgentConversation } from '../session-events';
import { resolveStartRel } from '../start-chain';

// 本地 demo 的用户级 Sidecar 与 Chat session 解耦;生产则使用已认证 principal。
const LOCAL_PRESENTATION_PRINCIPAL = 'local-user';

export interface TurnSituation {
  principal: string;
  presentationPrincipal: string;
  presentationContext: ReturnType<typeof presentationContextForIdentity>;
  situation: Awaited<ReturnType<typeof situationForChat>>;
}

export async function resolveTurnSituation(args: {
  identity?: TrustedRequestAuditContext;
  sessionId: string;
  clientView?: ClientViewReport;
}): Promise<TurnSituation> {
  const { identity, sessionId, clientView } = args;
  const principal = identity?.principal ?? `user:${sessionId}`;
  const presentationPrincipal = identity?.principal ?? LOCAL_PRESENTATION_PRINCIPAL;
  // Presentation 的目标 rel 在身份解析后才出现:授予集合(grantedApplications)
  // 随上下文下传 Broker,授权由咽喉点按授予集合 × 事实归属判定(D51)。
  const presentationContext = presentationContextForIdentity(identity);
  const situation = await situationForChat({
    principal: presentationPrincipal,
    identity,
    clientView,
  });
  return { principal, presentationPrincipal, presentationContext, situation };
}

export interface TurnSession {
  startRel: string;
  startNotice?: Awaited<ReturnType<typeof resolveStartRel>>['notice'];
  contextRel?: string;
  agentConversation: Awaited<ReturnType<typeof loadAgentConversation>>;
}

export async function prepareTurnSession(args: {
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  clientView?: ClientViewReport;
  mode: 'inline' | 'delegated';
  identity?: TrustedRequestAuditContext;
  turn: TurnSituation;
}): Promise<TurnSession> {
  const { goal, sessionId, turnId, clientView, mode, identity, turn } = args;
  const engine = await getEngine(getDb());
  // T40 B1:起步 rel 只保留业务面真实且授权内的 focus;虚主体/不存在/授权外
  // 一律降级到 scope entry → 站点兜底,起步永不因 focus 失效阻断。降级 notice
  // 随 final 帧下发(机械 code 客户端退折叠层,人话主行来自合同 sitemap 标题)。
  const snapshot = engine.getSnapshot();
  const start = resolveStartRel({
    situation: turn.situation,
    snapshot,
    sitemap: engine.getSitemap(),
    granted:
      identity !== undefined && identity.authorizationMode === 'credential'
        ? identity.grantedApplications
        : null,
  });
  const contextRel =
    turn.situation.thread === null
      ? undefined
      : `thread:${turn.situation.thread.replace(/^thread:/, '')}`;

  const userMessageId = turnId;
  await appendConversationMessage({
    sessionId,
    principal: turn.principal,
    turnId,
    messageId: userMessageId,
    role: 'user',
    content: goal.verb,
    ...(clientView === undefined ? {} : { clientView }),
  });
  await attachChatMessageToThread(engine, {
    thread: turn.situation.thread,
    principal: turn.principal,
    messageId: userMessageId,
  });
  const agentConversation = await loadAgentConversation(sessionId, turn.principal);

  // 决议后的 driver 恒为 llm(rule 已退出产品运行时;requested 仅随 final 帧回显)。
  const resolved = 'llm' as const;
  await appendChatProjection(
    'chat-turn-started',
    sessionId,
    { sessionId, turnId, goal, driver: resolved, mode },
    turn.principal,
  );
  return { startRel: start.rel, startNotice: start.notice, contextRel, agentConversation };
}
