// POST /api/chat — 悬浮聊天的合同后端(spec FR6/FR7,arch-brief §8)。
// - 请求 {goal: {verb, targetRel?, resource?, fields?}, sessionId?, driver?,
//   mode?: 'inline'|'delegated'};mode 缺省 inline(既有行为与测试零改动);
// - Presentation(T16):Chat 模型只可调用薄 present(subject,intent,constraints,
//   delivery);route 补 requestId/principal/sourceMessageIds 后异步交给独立 Broker。
//   Chat route 不读取 catalog、Surface Tree、bindings 或 dependencies，也没有展示
//   关键词/业务实体特判；Presentation 失败不改变 Chat outcome。
// - inline(T9 Phase B 起为 SSE 流式,text/event-stream):服务端只组装
//   LLM driver(default/auto 均是 llm),runAgent 循环过本源
//   HTTP 合同(actor=agent,principal=user:<sessionId>,channel=chat)——
//   "agent 走合同"字面成立;onStep 每步推一帧
//   {type:'step', message:{role:'assistant',text}, rel, activity, eventSeq?}
//   (text 为 trail.ts stepToMessage 口径的机器层原文;T24 Phase B 起
//   activity={op,title?,subject?} 为结构化显示数据——op 是协议动词、标题取自
//   合同 sitemap,客户端按固定 op 词表渲染活动语言;eventSeq 指向本步
//   chat-turn-progress 事件供审计下钻);llm 步 decide 产推理自述时先于同号
//   step 帧推一帧
//   {type:'thinking', turnId, step, text}(T11 Phase C / 架构决定 4:聚合整段权威
//   终帧——D22 GLM reasoning 末尾齐发,非打字机;turnId + step 与对应 step 帧同号,
//   便于客户端归步;端点不返回 reasoning 时零 thinking 帧);
//   增量通道 {type:'thinking-delta', turnId,
//   step, text} 逐 raw chunk 即推(与聚合几乎同刻,管线为真流式就绪),
//   结束推 {type:'final', payload:{sessionId,
//   driver, requestedDriver, outcome, summary, steps, successes}};异常兜底
//   {type:'error', error};客户端断开仅中断推帧,循环照常跑完(留痕);
// - 聊天历史(T9 Phase B):inline 回合完成(含 failed/max-steps)后直写一条
//   chat-turn 事件(rel=chat:<sessionId>,detail 含 goal/outcome/summary/
//   messages/steps/driver——T11 Phase B 起 steps 为结构化 TrailStep[] 原料)
//   ——与 worker 同一双写者模式;engine fold 忽略该 kind
//   (纯审计留痕);落库失败 console.error 不阻断响应。GET /api/chat/history
//   按 sessionId 投影回合序列(服务端零会话态);
// - 决策审计(T11 Phase B / 架构决定 3):inline 路径每步决策直写一条
//   agent-decision 事件(rel/actor/principal/channel 与 chat-turn 同源同值,
//   detail 五要素 step/driver/prompt/reasoning/op——llm 的 prompt 为 system/user
//   全量原文、reasoning 为聚合整段自述(Phase C 起填真值;端点不返回时如实
//   null),
//   先于 chat-turn 落库;engine fold 忽略该 kind(纯留痕,I5 重放 hash 不变),
//   落库失败 console.error 不阻断响应(同 chat-turn 口径);delegated 回合不写
//   agent-decision(轨迹在舰队页);
// - delegated(T5 Phase B / spec 架构决定 5):校验 goal → 从 Situation 事实链取得 startRel 与
//   driverKind(auto 先解析)→ dispatchDelegation 派发 delegationWorkflow
//   (taskQueue ui4a;baseUrl=自身 origin,worker activity 回环走本源合同)→
//   响应 {mode:'delegated', delegationId, statusUrl};派发失败(Temporal 不可达)
//   据实 503——委托没派出去不能假装成功;
// - 起始 rel(T40 B1):同一回合 Situation 的 focus 仅当指向业务面真实实体且授权内
//   才保留;虚主体/不存在/授权外一律降级 scope application entry → 站点兜底,
//   起步不因 focus 失效阻断;降级附结构化 notice 随 final 帧下发。无 focus 时
//   entry → 站点兜底;不做 sitemap 词级猜测或实体可达性预探测;
// - 一次性 JSON 仅剩参数错误/delegated；inline 始终使用同一 SSE agent loop。
//   B4:LLM 失败(401 等)如实进入 step 帧文本与 final.summary,route 不 5xx。
// 服务无会话态:事件日志是真相,聊天会话是客户端投影(localStorage)。
import {
  createBoundedBearerFetch,
  LlmConfigurationError,
  resolveLlmConfig,
  type FetchLike,
} from '@ui4a/agent';

import { sseResponse, streamAgentLoop } from '../../../chat/inline-stream';
import { parseBody } from '../../../chat/request-body';
import {
  appendChatProjection,
  appendConversationMessage,
  loadAgentConversation,
} from '../../../chat/session-events';
import { resolveStartRel } from '../../../chat/start-chain';
import { getProductionAgentTokenProvider } from '../../../auth/production-agent-token-provider';
import { getProductionBrowserAuthentication } from '../../../auth/production/browser-authentication-runtime';
import { resolveTrustedRequestOrigin } from '../../../auth/production/request-origin';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
  type TrustedRequestAuditContext,
} from '../../../auth/request-identity';
import { presentationContextForIdentity, situationForChat } from '../../../engine/chat-situation';
import { attachChatMessageToThread } from '../../../engine/chat-thread';
import { getDb, getEngine } from '../../../engine/service';
import { runWebProductionDeploymentPreflight } from '../../../production-deployment-preflight';
import { dispatchDelegation } from '../../../temporal/delegation';

export const dynamic = 'force-dynamic';

// 本地 demo 的用户级 Sidecar 与 Chat session 解耦；生产则使用已认证 principal。
const LOCAL_PRESENTATION_PRINCIPAL = 'local-user';
const AGENT_CONTRACT_PATHS = [
  '/.well-known/ui4a.json',
  '/api/entity',
  '/api/exec',
  '/api/exec-plan',
  '/_meta/.well-known/ui4a.json',
  '/_meta/api/entity',
  '/_meta/api/exec',
] as const;

function bearerToken(authorizationHeader: string): string | undefined {
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader);
  return match?.[1];
}

function agentCredentialErrorResponse(error: unknown): Response {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('agent_')
      ? error.code
      : 'agent_token_endpoint_unavailable';
  return Response.json({ error: { code } }, { status: 503 });
}

function agentAuthorizationErrorResponse(code: string): Response {
  return Response.json({ error: { code } }, { status: 403 });
}

function isCanonicalDelegatedIdentity(input: {
  human: TrustedRequestAuditContext;
  delegated: TrustedRequestAuditContext;
  agentClientId: string;
  requestedScopes: readonly string[];
}): boolean {
  const { human, delegated, agentClientId, requestedScopes } = input;
  return (
    delegated.actor === 'agent' &&
    delegated.humanApprovalEligible === false &&
    delegated.principal === human.principal &&
    delegated.delegation?.subject === human.principal &&
    delegated.delegation.actorClientId === agentClientId &&
    delegated.delegation.source === 'token-exchange-sub-azp' &&
    delegated.scopes.every((scope) => requestedScopes.includes(scope))
  );
}
export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  let productionIdentity: TrustedRequestAuditContext | undefined;
  let productionSubjectToken: string | undefined;
  let productionOrigin: string | undefined;
  let productionAgentScopes: string[] | undefined;
  let productionConfig:
    NonNullable<ReturnType<typeof runWebProductionDeploymentPreflight>> | undefined;

  if (requestIdentityProfile() === 'production') {
    let config;
    try {
      config = runWebProductionDeploymentPreflight();
    } catch {
      return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
    }
    if (config === undefined) {
      return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
    }
    // TLS 在受控 edge 终止；只接受 canonical deployment 明确列出的浏览器 origin。
    const effectiveOrigin = resolveTrustedRequestOrigin(
      request,
      config.settings.service.trustedRequestOrigins,
    );
    if (effectiveOrigin === undefined) {
      return Response.json({ error: { code: 'request_origin_invalid' } }, { status: 400 });
    }

    const agentScopes = config.settings.auth.oidc.agentScopes;
    const policyScopes = agentScopes
      .filter((scope) => scope.startsWith('ui4a:policy:'))
      .map((scope) => scope.slice('ui4a:policy:'.length));
    if (policyScopes.length === 0) {
      return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
    }
    try {
      const browserSession =
        await getProductionBrowserAuthentication(request).resolveSession(request);
      const subjectToken = bearerToken(browserSession.authorizationHeader);
      if (subjectToken === undefined) {
        return Response.json({ error: { code: 'credential_malformed' } }, { status: 401 });
      }
      const identityRequest = new Request(request.url, {
        headers: { authorization: browserSession.authorizationHeader },
      });
      productionIdentity = await resolveTrustedRequestIdentity(identityRequest, {
        profile: 'production',
        productionConfig: config,
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: policyScopes,
        plane: 'business',
      });
      productionSubjectToken = subjectToken;
      productionOrigin = config.settings.service.publicOrigin;
      productionAgentScopes = [...agentScopes];
      productionConfig = config;
    } catch (error) {
      return (
        authenticationErrorResponse(error) ??
        Response.json({ error: { code: 'credential_malformed' } }, { status: 401 })
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const { goal, turnId, driver: requested, mode, clientView } = parsed;
  const sessionId = productionIdentity?.principal ?? parsed.sessionId;
  const principal = productionIdentity?.principal ?? `user:${sessionId}`;
  const presentationPrincipal = productionIdentity?.principal ?? LOCAL_PRESENTATION_PRINCIPAL;
  // Presentation 的目标 rel 在身份解析后才出现:授予集合(grantedApplications)
  // 随上下文下传 Broker,授权由咽喉点按授予集合 × 事实归属判定(D51)。
  const presentationContext = presentationContextForIdentity(productionIdentity);
  const situation = await situationForChat({
    principal: presentationPrincipal,
    identity: productionIdentity,
    clientView,
  });
  let turnFetch: FetchLike = (url, init) => fetch(url, init);
  if (
    productionIdentity !== undefined &&
    productionSubjectToken !== undefined &&
    productionOrigin !== undefined &&
    productionAgentScopes !== undefined &&
    productionConfig !== undefined
  ) {
    let authorizationHeader: string;
    if (mode === 'inline') {
      // 收窄口径:human granted ∩ agentScopes 的 policy scopes 全量携带(chat 无 scope
      // 选择器,回合内合同读取的 rel 归属哪个应用事先不可知;接收端 /api/entity 按
      // 授予集合 × 归属逐请求判定)。相对 human grant 仍是严格收窄(剥离
      // ui4a:approve 与非 agent scope)。
      const requestedScopes = [
        'ui4a:read',
        'ui4a:write',
        ...productionAgentScopes.filter(
          (scope) => scope.startsWith('ui4a:policy:') && productionIdentity.scopes.includes(scope),
        ),
      ];
      const exchangedPolicyScopes = requestedScopes
        .filter((scope) => scope.startsWith('ui4a:policy:'))
        .map((scope) => scope.slice('ui4a:policy:'.length));
      // 纵深防御(D51):交换请求携带的每个 policy 应用名都必须有凭证授予集合背书
      // (正常路径由身份解析保证;此处防 identity 适配层漂移)。
      if (
        exchangedPolicyScopes.some((app) => !productionIdentity.grantedApplications.includes(app))
      ) {
        return agentAuthorizationErrorResponse('agent_scope_exceeded');
      }
      if (requestedScopes.some((scope) => !productionIdentity.scopes.includes(scope))) {
        return agentAuthorizationErrorResponse('agent_scope_exceeded');
      }
      if (requestedScopes.some((scope) => !productionAgentScopes.includes(scope))) {
        return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
      }
      try {
        const credential = await getProductionAgentTokenProvider().exchangeDelegatedCredential({
          subjectToken: productionSubjectToken,
          requestedScopes,
        });
        // 接收端校验的 delegated scope 白名单必须与本次交换携带的 policy scopes 一致
        // (全量授予并集),否则 policyFor 按单个 policyScope 收窄会误报
        // delegation_scope_exceeded。
        const delegatedIdentity = await resolveTrustedRequestIdentity(
          new Request(request.url, {
            headers: { authorization: credential.authorizationHeader },
          }),
          {
            profile: 'production',
            productionConfig,
            requiredScopes: requestedScopes,
            authorizedPolicyScopes: exchangedPolicyScopes,
            plane: 'business',
          },
        );
        const agentClientId = productionConfig.settings.auth.oidc.agentClientId;
        if (
          !isCanonicalDelegatedIdentity({
            human: productionIdentity,
            delegated: delegatedIdentity,
            agentClientId,
            requestedScopes,
          })
        ) {
          return agentAuthorizationErrorResponse('agent_delegation_identity_invalid');
        }
        authorizationHeader = credential.authorizationHeader;
      } catch (error) {
        return authenticationErrorResponse(error) ?? agentCredentialErrorResponse(error);
      }
    } else {
      authorizationHeader = `Bearer ${productionSubjectToken}`;
    }
    turnFetch = createBoundedBearerFetch({
      origin: productionOrigin,
      authorizationHeader,
      allowedPaths: AGENT_CONTRACT_PATHS,
      fetch,
    });
  }
  // baseUrl 口径(终审 M-2):delegated 派发的 workflow args.baseUrl 不信任
  // 请求 Host 头(可被调用方控制,进 workflow 会让 worker 以服务端身份持续
  // 回环抓取任意 origin)。APP_ORIGIN 显式覆盖;否则仅放行本机 Host(dev/
  // e2e 都在 localhost),非本机且未配置 → 拒绝 delegated 派发。
  const resolved = 'llm' as const;
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
  if (goal.verb.includes('_meta') || situation.site === 'meta') {
    baseUrl = `${baseUrl.replace(/\/$/, '')}/_meta`;
  }

  // AI-first 产品边界:缺少模型配置时不进入任何确定性 chat
  // 短路(render/focus/discovery),也不派发注定失败的委托。inline
  // 仍经标准 agent 流输出可恢复 fail；delegated 以 JSON 据实拒绝。
  let configurationFailure: string | undefined;
  try {
    resolveLlmConfig();
  } catch (error) {
    if (!(error instanceof LlmConfigurationError)) throw error;
    configurationFailure = `LLM 不可用: ${error.message}。配置后可重试。`;
  }

  const engine = await getEngine(getDb());
  // T40 B1:起步 rel 只保留业务面真实且授权内的 focus;虚主体/不存在/授权外
  // 一律降级到 scope entry → 站点兜底,起步永不因 focus 失效阻断。降级 notice
  // 随 final 帧下发(机械 code 客户端退折叠层,人话主行来自合同 sitemap 标题)。
  const snapshot = engine.getSnapshot();
  const start = resolveStartRel({
    situation,
    snapshot,
    sitemap: engine.getSitemap(),
    granted:
      productionIdentity !== undefined && productionIdentity.authorizationMode === 'credential'
        ? productionIdentity.grantedApplications
        : null,
  });
  const startRel = start.rel;
  const startNotice = start.notice;
  const contextRel =
    situation.thread === null ? undefined : `thread:${situation.thread.replace(/^thread:/, '')}`;

  const userMessageId = turnId;
  await appendConversationMessage({
    sessionId,
    principal,
    turnId,
    messageId: userMessageId,
    role: 'user',
    content: goal.verb,
    ...(clientView === undefined ? {} : { clientView }),
  });
  await attachChatMessageToThread(engine, {
    thread: situation.thread,
    principal,
    messageId: userMessageId,
  });
  const agentConversation = await loadAgentConversation(sessionId, principal);

  await appendChatProjection(
    'chat-turn-started',
    sessionId,
    { sessionId, turnId, goal, driver: resolved, mode },
    principal,
  );

  if (configurationFailure !== undefined) {
    if (mode === 'inline') {
      return sseResponse(async (send) => {
        await streamAgentLoop({
          send,
          goal,
          sessionId,
          turnId,
          requested,
          resolved,
          baseUrl,
          principal,
          presentationPrincipal,
          startRel,
          startNotice,
          scope: situation.scope ?? null,
          contextRel,
          presentationContext,
          fetchImpl: turnFetch,
          conversationMessages: agentConversation.messages,
          conversation: agentConversation.context,
          clientView: agentConversation.clientView,
          lastNavigation: agentConversation.lastNavigation,
        });
      });
    }
    const messages = [{ role: 'assistant' as const, text: `失败: ${configurationFailure}` }];
    await appendChatProjection(
      'chat-turn',
      sessionId,
      {
        sessionId,
        turnId,
        goal,
        outcome: 'failed',
        summary: configurationFailure,
        messages,
        steps: [],
        driver: resolved,
      },
      principal,
    );
    return Response.json(
      {
        sessionId,
        driver: resolved,
        requestedDriver: requested,
        outcome: 'failed',
        summary: configurationFailure,
        messages,
        steps: [],
        successes: [],
        error: configurationFailure,
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
        scope: situation.scope,
        contextRel,
        startRel,
        principal,
        baseUrl,
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
        principal,
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
        principal,
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
      baseUrl,
      principal,
      presentationPrincipal,
      startRel,
      startNotice,
      scope: situation.scope ?? null,
      contextRel,
      presentationContext,
      fetchImpl: turnFetch,
      conversationMessages: agentConversation.messages,
      conversation: agentConversation.context,
      clientView: agentConversation.clientView,
      lastNavigation: agentConversation.lastNavigation,
    });
  });
}
