// POST /api/chat 响应段(T55/D75 四段提取;行为自 route.ts 逐字迁移)。
// - prepareTurnDispatch:baseUrl 口径(终审 M-2:delegated 派发不信任请求 Host;
//   APP_ORIGIN 显式覆盖,否则仅本机 Host 放行)→ 平面归属与 D66 附录显式 lens
//   (meta 平面由服务端从 situation 单点装配,?scope= 仅传输)→ AI-first 配置
//   检查(缺配置不短路 inline,delegated 仍可据实拒绝);
// - respondToTurn:configurationFailure / delegated / inline 三分支;SSE 帧序列
//   与审计落库口径全在 inline-stream 与 session-events(行为不变)。
import type { AgentGoal, FetchLike } from '@ui4a/agent';
import { LlmConfigurationError, resolveLlmConfig } from '@ui4a/agent';

import { dispatchDelegation } from '../../temporal/delegation';
import { sseResponse, streamAgentLoop } from '../inline-stream';
import { appendChatProjection } from '../session-events';
import type { TurnSession, TurnSituation } from './turn-context';

export interface TurnDispatchPlan {
  baseUrl: string;
  metaLens?: string;
  configurationFailure?: string;
}

export function prepareTurnDispatch(args: {
  requestUrl: URL;
  mode: 'inline' | 'delegated';
  productionOrigin?: string;
  situation: { site: string; scope?: string };
  goal: AgentGoal;
}): TurnDispatchPlan | Response {
  const { requestUrl, mode, productionOrigin, situation, goal } = args;
  // baseUrl 口径(终审 M-2):delegated 派发的 workflow args.baseUrl 不信任
  // 请求 Host 头(可被调用方控制,进 workflow 会让 worker 以服务端身份持续
  // 回环抓取任意 origin)。APP_ORIGIN 显式覆盖;否则仅放行本机 Host(dev/
  // e2e 都在 localhost),非本机且未配置 → 拒绝 delegated 派发。
  let baseUrl: string;
  if (productionOrigin !== undefined) {
    baseUrl = productionOrigin;
  } else if (mode !== 'delegated') {
    baseUrl = requestUrl.origin;
  } else if (process.env.APP_ORIGIN !== undefined) {
    baseUrl = process.env.APP_ORIGIN;
  } else if (
    requestUrl.hostname === 'localhost' ||
    requestUrl.hostname === '127.0.0.1' ||
    requestUrl.hostname === '[::1]'
  ) {
    baseUrl = requestUrl.origin;
  } else {
    return Response.json(
      { error: 'delegated 派发要求配置 APP_ORIGIN(当前 Host 非本机,拒绝以不可信 origin 派发委托)' },
      { status: 400 },
    );
  }
  // 平面归属:跟用户当下位置走(meta 控制台/正在查看定义实体 → 定义合同站;
  // 其余 → 业务站);`_meta` 原话记号保留为显式越界入口。不做自然语言意图猜测。
  const metaPlane = goal.verb.includes('_meta') || situation.site === 'meta';
  if (metaPlane) {
    baseUrl = `${baseUrl.replace(/\/$/, '')}/_meta`;
  }
  // D66 附录显式 lens 通道:meta 平面的 Draft 写门要求显式授权 application
  // lens,chat 的 meta exec 请求由服务端从 situation 单点装配注入(显式 >
  // presence),仅在合同适配层以 ?scope= 传输——模型工具 schema 不含 scope
  // 参数,注意力不来自模型发明;无显式 lens 时不附加(保持诚实拒绝),授予
  // 集合外的声明仍被 /_meta/api/exec 现有逻辑丢弃/拒绝(D51:lens 不进鉴权
  // 签名,服务端按授予集合重裁)。
  const metaLens = metaPlane ? situation.scope : undefined;

  // AI-first 产品边界:缺少模型配置时不进入任何确定性 chat
  // 短路(render/focus/discovery),也不派发注定失败的委托。inline
  // 仍经标准 agent 流输出可恢复 fail;delegated 以 JSON 据实拒绝。
  let configurationFailure: string | undefined;
  try {
    resolveLlmConfig();
  } catch (error) {
    if (!(error instanceof LlmConfigurationError)) throw error;
    configurationFailure = `LLM 不可用: ${error.message}。配置后可重试。`;
  }
  return { baseUrl, metaLens, configurationFailure };
}

function streamInlineTurn(args: {
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  requested: 'llm' | 'auto';
  turn: TurnSituation;
  session: TurnSession;
  plan: TurnDispatchPlan;
  turnFetch: FetchLike;
}): Response {
  const { goal, sessionId, turnId, requested, turn, session, plan, turnFetch } = args;
  const resolved = 'llm' as const;
  // inline(T9 Phase B):SSE 流式响应——轨迹逐步可见(过程可见性);
  // 循环在流内跑完,客户端断开只中断推帧,不中断循环(服务端留痕完整)。
  // 帧序列与审计/落库口径全在 streamAgentLoop(与渲染路径 SSE 化共用)。
  return sseResponse(async (send) => {
    await streamAgentLoop({
      send,
      goal,
      sessionId,
      turnId,
      requested,
      resolved,
      baseUrl: plan.baseUrl,
      principal: turn.principal,
      presentationPrincipal: turn.presentationPrincipal,
      startRel: session.startRel,
      startNotice: session.startNotice,
      scope: turn.situation.scope ?? null,
      metaLens: plan.metaLens,
      contextRel: session.contextRel,
      presentationContext: turn.presentationContext,
      fetchImpl: turnFetch,
      conversationMessages: session.agentConversation.messages,
      conversation: session.agentConversation.context,
      clientView: session.agentConversation.clientView,
      lastNavigation: session.agentConversation.lastNavigation,
    });
  });
}

export async function respondToTurn(args: {
  goal: AgentGoal;
  sessionId: string;
  turnId: string;
  requested: 'llm' | 'auto';
  mode: 'inline' | 'delegated';
  turn: TurnSituation;
  session: TurnSession;
  plan: TurnDispatchPlan;
  turnFetch: FetchLike;
}): Promise<Response> {
  const { goal, sessionId, turnId, requested, mode, turn, session, plan, turnFetch } = args;
  const resolved = 'llm' as const;

  if (plan.configurationFailure !== undefined) {
    if (mode === 'inline') {
      return streamInlineTurn({ goal, sessionId, turnId, requested, turn, session, plan, turnFetch });
    }
    const messages = [{ role: 'assistant' as const, text: `失败: ${plan.configurationFailure}` }];
    await appendChatProjection(
      'chat-turn',
      sessionId,
      {
        sessionId,
        turnId,
        goal,
        outcome: 'failed',
        summary: plan.configurationFailure,
        messages,
        steps: [],
        driver: resolved,
      },
      turn.principal,
    );
    return Response.json(
      {
        sessionId,
        driver: resolved,
        requestedDriver: requested,
        outcome: 'failed',
        summary: plan.configurationFailure,
        messages,
        steps: [],
        successes: [],
        error: plan.configurationFailure,
      },
      { status: 503 },
    );
  }

  // delegated(T5 Phase B):派发 delegationWorkflow,响应委托 id 与轮询入口;
  // 轨迹/状态经事件日志(/api/delegations/<id>)查询,与 inline 的消息语义等价。
  if (mode === 'delegated') {
    try {
      const { delegationId } = await dispatchDelegation({
        goal,
        driverKind: resolved,
        scope: turn.situation.scope,
        contextRel: session.contextRel,
        startRel: session.startRel,
        principal: turn.principal,
        baseUrl: plan.baseUrl,
      });
      const message = {
        role: 'assistant' as const,
        text: `已派发委托 ${delegationId.replace(/^delegation-/, '').slice(0, 8)}…(后台执行中),进度见委托监控页 /delegations`,
      };
      await appendChatProjection(
        'chat-turn',
        sessionId,
        {
          sessionId,
          turnId,
          goal,
          outcome: 'done',
          summary: `委托已派发:${delegationId}`,
          messages: [message],
          steps: [],
          driver: resolved,
        },
        turn.principal,
      );
      return Response.json({
        mode: 'delegated',
        delegationId,
        statusUrl: `/api/delegations/${delegationId}`,
        sessionId,
      });
    } catch (error) {
      // 派发失败据实 503(委托未出发;与 inline 的"失败也是 200"不同——
      // 这里连循环都没开始,客户端必须知道派发本身未成)。
      const summary = `委托派发失败: ${error instanceof Error ? error.message : String(error)}`;
      await appendChatProjection(
        'chat-turn',
        sessionId,
        {
          sessionId,
          turnId,
          goal,
          outcome: 'failed',
          summary,
          messages: [{ role: 'assistant', text: `失败: ${summary}` }],
          steps: [],
          driver: resolved,
        },
        turn.principal,
      );
      return Response.json(
        {
          sessionId,
          error: summary,
        },
        { status: 503 },
      );
    }
  }

  return streamInlineTurn({ goal, sessionId, turnId, requested, turn, session, plan, turnFetch });
}
