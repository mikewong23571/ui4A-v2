// POST /api/chat 鉴权身份段(T55/D75 四段提取;行为自 route.ts 逐字迁移)。
// - resolveProductionIdentity:生产 profile 下 preflight → trusted origin 校验 →
//   浏览器会话 → 凭证身份解析,返回身份束;本地 demo(非生产)返回 undefined;
// - buildTurnFetch:inline 回合的 delegated credential 交换(D51 收窄口径:
//   human granted ∩ agentScopes 的 policy scopes 全量携带;canonical 身份校验)
//   与 bounded bearer fetch 构造;本地 demo 直接透传 ambient fetch。
// 深生产链路的端到端语义由 route.production-auth/route.delegated 测试覆盖。
import { createBoundedBearerFetch, type FetchLike } from '@ui4a/agent';

import { getProductionAgentTokenProvider } from '../../auth/production-agent-token-provider';
import { getProductionBrowserAuthentication } from '../../auth/production/browser-authentication-runtime';
import { resolveTrustedRequestOrigin } from '../../auth/production/request-origin';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
  type TrustedRequestAuditContext,
} from '../../auth/request-identity';
import { runWebProductionDeploymentPreflight } from '../../production-deployment-preflight';

export const AGENT_CONTRACT_PATHS = [
  '/.well-known/ui4a.json',
  '/api/entity',
  '/api/exec',
  '/api/exec-plan',
  '/_meta/.well-known/ui4a.json',
  '/_meta/api/entity',
  '/_meta/api/exec',
] as const;

export function bearerToken(authorizationHeader: string): string | undefined {
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader);
  return match?.[1];
}

export function agentCredentialErrorResponse(error: unknown): Response {
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

export function agentAuthorizationErrorResponse(code: string): Response {
  return Response.json({ error: { code } }, { status: 403 });
}

export function isCanonicalDelegatedIdentity(input: {
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

export interface ProductionIdentityBundle {
  identity: TrustedRequestAuditContext;
  subjectToken: string;
  origin: string;
  agentScopes: string[];
  config: NonNullable<ReturnType<typeof runWebProductionDeploymentPreflight>>;
}

export async function resolveProductionIdentity(
  request: Request,
): Promise<ProductionIdentityBundle | undefined | Response> {
  if (requestIdentityProfile() !== 'production') {
    return undefined;
  }

  let config;
  try {
    config = runWebProductionDeploymentPreflight();
  } catch {
    return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
  }
  if (config === undefined) {
    return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
  }
  // TLS 在受控 edge 终止;只接受 canonical deployment 明确列出的浏览器 origin。
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
    const identity = await resolveTrustedRequestIdentity(identityRequest, {
      profile: 'production',
      productionConfig: config,
      requiredScopes: ['ui4a:read'],
      authorizedPolicyScopes: policyScopes,
      plane: 'business',
    });
    return {
      identity,
      subjectToken,
      origin: config.settings.service.publicOrigin,
      agentScopes: [...agentScopes],
      config,
    };
  } catch (error) {
    return (
      authenticationErrorResponse(error) ??
      Response.json({ error: { code: 'credential_malformed' } }, { status: 401 })
    );
  }
}

export async function buildTurnFetch(args: {
  request: Request;
  mode: 'inline' | 'delegated';
  production?: ProductionIdentityBundle;
}): Promise<FetchLike | Response> {
  const { request, mode, production } = args;
  if (production === undefined) {
    return (url, init) => fetch(url, init);
  }
  const { identity, subjectToken, origin, agentScopes, config } = production;
  let authorizationHeader: string;
  if (mode === 'inline') {
    // 收窄口径:human granted ∩ agentScopes 的 policy scopes 全量携带(chat 无 scope
    // 选择器,回合内合同读取的 rel 归属哪个应用事先不可知;接收端 /api/entity 按
    // 授予集合 × 归属逐请求判定)。相对 human grant 仍是严格收窄(剥离
    // ui4a:approve 与非 agent scope)。
    const requestedScopes = [
      'ui4a:read',
      'ui4a:write',
      ...agentScopes.filter(
        (scope) => scope.startsWith('ui4a:policy:') && identity.scopes.includes(scope),
      ),
    ];
    const exchangedPolicyScopes = requestedScopes
      .filter((scope) => scope.startsWith('ui4a:policy:'))
      .map((scope) => scope.slice('ui4a:policy:'.length));
    // 纵深防御(D51):交换请求携带的每个 policy 应用名都必须有凭证授予集合背书
    // (正常路径由身份解析保证;此处防 identity 适配层漂移)。
    if (exchangedPolicyScopes.some((app) => !identity.grantedApplications.includes(app))) {
      return agentAuthorizationErrorResponse('agent_scope_exceeded');
    }
    if (requestedScopes.some((scope) => !identity.scopes.includes(scope))) {
      return agentAuthorizationErrorResponse('agent_scope_exceeded');
    }
    if (requestedScopes.some((scope) => !agentScopes.includes(scope))) {
      return Response.json({ error: { code: 'deployment_config_invalid' } }, { status: 503 });
    }
    try {
      const credential = await getProductionAgentTokenProvider().exchangeDelegatedCredential({
        subjectToken,
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
          productionConfig: config,
          requiredScopes: requestedScopes,
          authorizedPolicyScopes: exchangedPolicyScopes,
          plane: 'business',
        },
      );
      const agentClientId = config.settings.auth.oidc.agentClientId;
      if (
        !isCanonicalDelegatedIdentity({
          human: identity,
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
    authorizationHeader = `Bearer ${subjectToken}`;
  }
  return createBoundedBearerFetch({
    origin,
    authorizationHeader,
    allowedPaths: AGENT_CONTRACT_PATHS,
    fetch,
  });
}
