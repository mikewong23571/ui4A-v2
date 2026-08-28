/**
 * inline 聊天回流的流式执行面(T36 B1 自 route.ts 提取)。
 *
 * sseResponse:SSE 响应壳(send 包装/客户端断开停推帧/心跳/异常兜底 error 帧/
 * finally close)——各路径只关心帧序列本身。
 * streamAgentLoop:inline 循环的流内执行(inline 常规路径与渲染路径过闸失败的
 * 兜底共用):fact-based startRel → runAgent(thinking-delta/thinking/step 帧)→
 * 冗余步帧 → agent-decision/chat-turn 落库 → final 帧。
 * 帧合同与落库口径见 route.ts 头注(T36 拆分未改动任何语义)。
 */
import {
  createContractClient,
  createDriver,
  runAgent,
  type AgentGoal,
  type ConversationContext as AgentConversationContext,
  type ConversationMessage as AgentConversationMessage,
  type FetchLike,
} from '@ui4a/agent';
import {
  CHAT_NAVIGATION_PROTOCOL_VERSION,
  completePresentationRequest,
  type NavigationCompletion,
} from '@ui4a/shared';

import type { ChatTurnDetail } from './history';
import { wrapDriverForAudit, type AgentDecisionDetail } from './decisions';
import { conversationView } from './conversation';
import {
  failureReasonFromLoopException,
  failureReasonFromResult,
  phraseFailureWithLlm,
} from './failure-reason';
import { sitemapTitlesFromSummary, stepActivityData } from './step-activity';
import { stepToMessage, trailToMessages } from './trail';
import {
  appendChatProjection,
  appendConversationContext,
  appendConversationMessage,
  appendNavigationCompletion,
} from './session-events';
import type { presentationContextForIdentity } from '../engine/chat-situation';
import { appendEvent } from '../db/events';
import { getDb } from '../engine/service';
import { getPresentationBroker, getPresentationCapabilities } from '../engine/presentation/runtime';

/**
 * SSE 响应壳(inline 常规路径与渲染路径 SSE 化共用):send 包装(客户端断开
 * 停推帧,服务端循环照常跑完)、异常兜底 error 帧、finally close——各路径
 * 只关心帧序列本身。
 */
export function sseResponse(
  start: (send: (frame: Record<string, unknown>) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let pushable = true;
      const send = (frame: Record<string, unknown>): void => {
        if (!pushable) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          // 客户端已断开(停止/关窗):停推帧,循环照常跑完。
          pushable = false;
        }
      };
      // 中间无模型 token 时仍证明连接活着；客户端把它视为续期信号而非业务消息。
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000);
      (heartbeat as { unref?: () => void }).unref?.();
      try {
        await start(send);
      } catch (error) {
        // 委托不崩溃:循环与 driver 都不应抛出;此处兜底为 error 帧(200 流内)。
        const reason = failureReasonFromLoopException(error);
        send({
          type: 'error',
          error: reason.evidence?.[0] ?? '聊天循环异常',
          // 结构化失败合同(T24 Phase B Task 3;边界为既定裁决,D48):机械层
          // 只产结构化数据;error 帧恒由客户端中性结构化展示,LLM phrasing 仅
          // 覆盖 final 帧的失败来源(loop_exception 是循环壳的最后兜底,该路径
          // 零新增故障面)。补齐 error 帧 LLM 表述须新决策——见 DECISIONS D48
          // 第 4 小节(R14 边界登记)。
          reason,
        });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // 流已被客户端取消:关闭动作无副作用要求。
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}

/**
 * inline 循环的流内执行(inline 常规路径与渲染路径过闸失败的兜底共用):
 * fact-based startRel → runAgent(thinking-delta/thinking/step 帧)→ 冗余步帧 →
 * agent-decision/chat-turn 落库 → final 帧。
 */
export async function streamAgentLoop(args: {
  send: (frame: Record<string, unknown>) => void;
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  requested: 'llm' | 'auto';
  resolved: 'llm';
  baseUrl: string;
  principal: string;
  presentationPrincipal: string;
  startRel: string;
  scope: string | null;
  presentationContext: ReturnType<typeof presentationContextForIdentity>;
  fetchImpl: FetchLike;
  conversationMessages: AgentConversationMessage[];
  conversation: AgentConversationContext;
  clientView: ReturnType<typeof conversationView>['clientView'];
  lastNavigation: ReturnType<typeof conversationView>['lastNavigation'];
}): Promise<void> {
  const {
    send,
    goal,
    sessionId,
    turnId,
    requested,
    resolved,
    baseUrl,
    principal,
    conversationMessages,
    conversation,
    clientView,
    lastNavigation,
  } = args;
  send({ type: 'session', sessionId, turnId });
  // 同一已解析 sitemap 同时供 Agent 静态上下文与 T24 活动标题投影；
  // 不可得时显式预载 undefined，循环不二次抓取且照常仅实体导航。
  const sitemap = await createContractClient(baseUrl, args.fetchImpl).getSitemap();
  const sitemapTitles = sitemapTitlesFromSummary(sitemap);
  // agent-decision 审计(T11 Phase B):包装 driver 在 decide 时刻捕获
  // (prompt/reasoning/op)——决策输入只存在于 decide 时的 DriverContext,
  // 执行后的 TrailStep 回推不出 prompt(捕获方案见 chat/decisions.ts)。
  const decisions: AgentDecisionDetail[] = [];
  // 已发 step 帧计数:thinking 帧的步号 = 计数 + 1(decide 先于 trail.push,
  // 回调时第 N 步的 step 帧尚未发出)——与对应 step 帧同号,便于客户端归步。
  let stepFramesSent = 0;
  let presentationCount = 0;
  const presentationRequestIds: string[] = [];
  const presentationJobs: Promise<void>[] = [];
  const result = await runAgent(
    wrapDriverForAudit(createDriver(requested), resolved, (detail) => decisions.push(detail)),
    goal,
    {
      baseUrl,
      fetchImpl: args.fetchImpl,
      sitemap,
      actor: 'agent',
      principal,
      channel: 'chat',
      startRel: args.startRel,
      app: args.scope ?? undefined,
      conversationMessages,
      conversation,
      clientView,
      lastNavigation,
      requireEffectAuthorization: true,
      chatMarkdown: true,
      presentationMarkdown: getPresentationCapabilities().markdownWord,
      // thinking 帧(T11 Phase C / 架构决定 4):llm 步的推理自述聚合整段
      // 权威终帧(D22 末尾齐发),先于同号 step 帧;增量通道 thinking-delta
      // 逐片段即推(当前与聚合几乎同刻,管线为真流式就绪);
      // 端点无 reasoning 回调时自然零帧。
      onReasoning: (text) => {
        send({ type: 'thinking', turnId, step: stepFramesSent + 1, text });
      },
      onReasoningDelta: (piece) => {
        send({ type: 'thinking-delta', turnId, step: stepFramesSent + 1, text: piece });
      },
      onPresentation: (intent) => {
        presentationCount += 1;
        const request = completePresentationRequest(intent, {
          requestId: `${turnId}:presentation:${presentationCount}`,
          principal: args.presentationPrincipal,
          sourceMessageIds: [turnId],
        });
        presentationRequestIds.push(request.requestId);
        send({
          type: 'presentation',
          turnId,
          payload: { schemaVersion: 1, requestId: request.requestId, status: 'pending' },
        });
        const job = getPresentationBroker()
          .present(request, args.presentationContext)
          .then(async (payload) => {
            if (
              (payload.status === 'ready' || payload.status === 'fallback') &&
              payload.surfaceUrl !== undefined
            ) {
              await appendNavigationCompletion(
                {
                  schemaVersion: CHAT_NAVIGATION_PROTOCOL_VERSION,
                  navigationId: `${request.requestId}:presentation-navigation`,
                  source: 'presentation-receipt',
                  sessionId,
                  turnId,
                  subject: request.subject,
                  route: payload.surfaceUrl,
                  sourceMessageIds: [...request.sourceMessageIds],
                  presentationRequestId: request.requestId,
                },
                principal,
              );
            }
            send({ type: 'presentation', turnId, payload });
          });
        presentationJobs.push(job);
      },
      onStep: async (step) => {
        stepFramesSent += 1;
        if (step.op.kind === 'navigate' && step.outcome === 'navigated') {
          await appendNavigationCompletion(
            {
              schemaVersion: CHAT_NAVIGATION_PROTOCOL_VERSION,
              navigationId: `${turnId}:navigate:${step.step}`,
              source: 'agent-navigate',
              sessionId,
              turnId,
              subject: step.rel,
              route: `/canvas?focus=${encodeURIComponent(step.rel)}`,
              sourceMessageIds: [turnId],
              step: step.step,
            },
            principal,
          );
          send({ type: 'focus', turnId, rel: step.rel });
        } else if (step.op.kind === 'exec' && step.outcome === 'executed') {
          // navigate 帧展示动作前处境；执行成功后显式刷新同一 rel，让共享
          // 画布立即切到动作后的合同投影，避免“完成了但仍显示旧状态”。
          send({ type: 'focus', turnId, rel: step.rel, refresh: true });
        } else if (step.op.kind === 'exec-plan' && step.outcome === 'executed') {
          send({ type: 'focus', turnId, rel: step.rel, refresh: true });
        }
        const message = stepToMessage(step);
        // T24 Phase B:message.text(机器层原文)随帧保留供审计/回退;activity
        // 携带 {op, title?, subject?} 结构化显示数据(标题取自合同 sitemap),
        // 客户端按固定 op 词表渲染「正在做什么」的活动语言。先落
        // chat-turn-progress 拿日志 seq,帧内 eventSeq 供审计下钻定位;
        // 落库失败时帧照发(下钻退事件流页,不伪造定位)。
        const activity = stepActivityData(step, sitemapTitles);
        const eventSeq = await appendChatProjection(
          'chat-turn-progress',
          sessionId,
          { sessionId, turnId, message, step },
          principal,
        );
        send({
          type: 'step',
          turnId,
          message,
          rel: step.rel,
          activity,
          ...(eventSeq !== undefined ? { eventSeq } : {}),
        });
      },
    },
  );

  const messages = trailToMessages(result);
  // max-steps 的上限说明不是轨迹步(无 TrailStep 可挂 onStep),补一帧,
  // 保持客户端「消息 = 各 step 帧文本」的重建口径与 trailToMessages 等值。
  for (const extra of messages.slice(result.steps.length)) {
    send({ type: 'step', turnId, message: extra });
    await appendChatProjection(
      'chat-turn-progress',
      sessionId,
      { sessionId, turnId, message: extra },
      principal,
    );
  }

  // agent-decision 落库:inline 每步决策一条,与 chat-turn 同源同值
  // (actor/principal/channel);先于回合投影写入(决策在先,回合在后)。
  // 落库失败 console.error 不阻断响应(同 chat-turn 口径:审计是投影)。
  try {
    for (const detail of decisions) {
      await appendEvent(getDb(), {
        kind: 'agent-decision',
        actor: 'agent',
        principal,
        channel: 'chat',
        rel: `chat:${sessionId}`,
        detail,
      });
    }
  } catch (persistError) {
    console.error('agent-decision 事件落库失败(不阻断聊天响应):', persistError);
  }

  // 聊天历史(B3):inline 回合完成(含 failed/max-steps)直写 chat-turn
  // 事件——与 worker 同一双写者模式;engine fold 忽略该 kind。落库失败
  // 不阻断聊天响应(历史是投影,丢失可从轨迹推知,响应才是合同)。
  // T11 Phase B:detail 增结构化 steps(result.steps 原样)——messages
  // 是人读投影,steps 是机器可读原料(架构决定 2)。
  const turnDetail: ChatTurnDetail = {
    sessionId,
    turnId,
    goal,
    outcome: result.outcome,
    summary: result.summary ?? null,
    messages,
    steps: result.steps,
    ...(presentationRequestIds.length > 0 ? { presentationRequestIds } : {}),
    driver: resolved,
  };
  await appendChatProjection('chat-turn', sessionId, turnDetail, principal);

  const assistantMessageId = `${turnId}:assistant`;
  const assistantContent = result.summary ?? '';
  if (assistantContent !== '') {
    const assistantSeq = await appendConversationMessage({
      sessionId,
      principal,
      turnId,
      messageId: assistantMessageId,
      role: 'assistant',
      content: assistantContent,
      model: process.env.LLM_MODEL,
      citations: result.sources,
    });
    if (result.outcome === 'clarification-needed' && result.continuation !== undefined) {
      await appendConversationContext({
        sessionId,
        principal,
        basedOnSeq: assistantSeq,
        sourceMessageIds: [turnId, assistantMessageId],
        patch: {
          activeGoal: result.continuation,
          pendingClarification: {
            question: assistantContent,
            continuation: result.continuation,
            sourceMessageIds: [assistantMessageId],
          },
        },
      });
    }
  }

  // 失败措辞分层(T24 Phase B Task 3):机械层组装结构化 reason;LLM 在场时
  // 由 reason 生成一句面向用户表述(AI-first),缺席则帧内无 phrasing、客户端
  // 中性结构化展示。summary 机器句子保留为机械层/审计数据,不从呈现消失真相。
  const failureReason = failureReasonFromResult(result);
  const phrasing =
    failureReason === undefined
      ? undefined
      : await phraseFailureWithLlm({
          reason: failureReason,
          goal,
          summary: result.summary,
        });

  send({
    type: 'final',
    turnId,
    payload: {
      sessionId,
      turnId,
      driver: resolved,
      requestedDriver: requested,
      outcome: result.outcome,
      summary: result.summary ?? null,
      steps: result.steps,
      successes: result.successes,
      ...(failureReason !== undefined
        ? { reason: phrasing === undefined ? failureReason : { ...failureReason, phrasing } }
        : {}),
      ...(result.sources !== undefined ? { sources: result.sources } : {}),
      ...(presentationRequestIds.length > 0 ? { presentationRequestIds } : {}),
    },
  });
  await Promise.allSettled(presentationJobs);
}
