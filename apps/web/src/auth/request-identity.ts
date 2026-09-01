import type { ExecRequest } from '@ui4a/engine';
import type { DeploymentEnvironment, ProductionDeploymentConfig } from '@ui4a/shared';

import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';
import { grantedPolicyScopes } from '../engine/situation';

import {
  buildProductionRequestIdentity,
  createRemoteJwksLoader,
  ProductionIdentityError,
  type ProductionCredentialDependencies,
  type ProductionCredentialPolicy,
  type ProductionRequestIdentity,
  verifyProductionCredential,
} from './production/request-identity';
import {
  BROWSER_SESSION_COOKIE_NAME,
  BrowserAuthenticationError,
  type BrowserAuthentication,
} from './browser-session';
import { getProductionBrowserAuthentication } from './production-browser-authentication';

export type RequestIdentityProfile = 'local' | 'production';

export interface TrustedRequestAuditContext {
  authorizationMode: 'self-reported-local-demo' | 'credential';
  actor: 'human' | 'agent';
  principal: string;
  scopes: string[];
  /**
   * 凭证授予的应用集合(D51):授权裁决的唯一会话外输入,由 ui4a:policy:*
   * (及同名 plain scope)解析而来。取代已退役的 policyScope 会话冻结值。
   */
  grantedApplications: string[];
  /**
   * 显式 ?scope=/?policyScope= 查询参数的导航偏好透传(D51):仅在归属
   * grantedApplications 时保留,不参与任何授权判定;不合法值静默丢弃。
   */
  policyScope?: string;
  channel: string;
  humanApprovalEligible: boolean;
  delegation?: ProductionRequestIdentity['delegation'];
}

export interface ResolveRequestIdentityOptions {
  requiredScopes: string[];
  authorizedPolicyScopes: readonly string[];
  plane: 'business' | 'meta';
  untrusted?: {
    actor?: unknown;
    principal?: unknown;
    channel?: unknown;
    scope?: unknown;
    delegation?: unknown;
  };
  profile?: RequestIdentityProfile;
  environment?: DeploymentEnvironment;
  productionConfig?: ProductionDeploymentConfig;
  productionPolicy?: ProductionCredentialPolicy;
  productionDependencies?: ProductionCredentialDependencies;
  browserAuthentication?: Pick<BrowserAuthentication, 'resolveSession'>;
}

const remoteLoaders = new Map<string, ReturnType<typeof createRemoteJwksLoader>>();

export function requestIdentityProfile(
  environment: DeploymentEnvironment = process.env,
): RequestIdentityProfile {
  return environment.UI4A_DEPLOYMENT_PROFILE === 'production' ? 'production' : 'local';
}

function productionConfig(options: ResolveRequestIdentityOptions): ProductionDeploymentConfig {
  const config =
    options.productionConfig ?? runWebProductionDeploymentPreflight(options.environment);
  if (config === undefined || config.settings.auth.mode !== 'oidc') {
    throw new Error('production request identity requires canonical OIDC deployment config');
  }
  return config;
}

function policyFor(
  config: ProductionDeploymentConfig,
  authorizedPolicyScopes: readonly string[],
): ProductionCredentialPolicy {
  const { agentClientId, agentScopes } = config.settings.auth.oidc;
  const cliClientId = 'ui4a-cli';
  const allowedAgentScopes = agentScopes.filter(
    (scope) =>
      !scope.startsWith('ui4a:policy:') ||
      authorizedPolicyScopes.includes(scope.slice('ui4a:policy:'.length)),
  );
  return {
    issuer: config.settings.auth.oidc.issuer,
    audience: config.settings.auth.oidc.audience,
    algorithms: ['RS256'],
    humanClientIds: [config.settings.auth.oidc.clientId],
    agentClientIds: [agentClientId, cliClientId],
    delegatedScopesByClient: {
      [agentClientId]: allowedAgentScopes,
      [cliClientId]: allowedAgentScopes,
    },
    agentCredentialSourcesByClient: {
      [agentClientId]: 'token-exchange-sub-azp',
      [cliClientId]: 'device-authorization-sub-azp',
    },
  };
}

function dependenciesFor(config: ProductionDeploymentConfig): ProductionCredentialDependencies {
  const issuer = config.settings.auth.oidc.issuer;
  let loader = remoteLoaders.get(issuer);
  if (loader === undefined) {
    loader = createRemoteJwksLoader({
      url: `${issuer}/protocol/openid-connect/certs`,
    });
    remoteLoaders.set(issuer, loader);
  }
  return { clock: Date.now, jwks: loader };
}

function hasCookie(request: Request, name: string): boolean {
  const cookie = request.headers.get('cookie');
  if (cookie === null) return false;
  return cookie.split(';').some((part) => {
    const separator = part.indexOf('=');
    return separator >= 0 && part.slice(0, separator).trim() === name;
  });
}

/**
 * 显式 ?scope=/?policyScope=(credential 分支只认查询参数)导航偏好(D51):
 * 仅当落在授予集合内才透传,否则静默丢弃视为未声明——不再有默认回退。
 */
function declaredScopePreference(
  url: URL,
  grantedApplications: readonly string[],
  headerScope?: string | null,
): string | undefined {
  const declared = url.searchParams.get('scope') ?? url.searchParams.get('policyScope');
  const candidates =
    declared !== null
      ? [declared]
      : headerScope === null || headerScope === undefined
        ? []
        : [headerScope];
  for (const candidate of candidates) {
    if (grantedApplications.includes(candidate)) return candidate;
  }
  return undefined;
}

export async function resolveTrustedRequestIdentity(
  request: Request,
  options: ResolveRequestIdentityOptions,
): Promise<TrustedRequestAuditContext> {
  const profile = options.profile ?? requestIdentityProfile(options.environment);
  if (profile === 'local') {
    // 本地信任域(self-reported):授予集合 = 服务端登记的全部 application;
    // 显式 scope(查询参数或本地头)只作导航偏好。查询与头同时给出且不一致
    // 属输入冲突,保持既有拒绝口径。
    const url = new URL(request.url);
    const queryScope =
      url.searchParams.get('scope') ?? url.searchParams.get('policyScope') ?? undefined;
    const headerScope = request.headers.get('x-ui4a-policy-scope') ?? undefined;
    if (queryScope !== undefined && headerScope !== undefined && queryScope !== headerScope) {
      throw new Error('conflicting Meta scope claims');
    }
    const grantedApplications = [...new Set(grantedPolicyScopes(options.authorizedPolicyScopes))];
    const actor = options.untrusted?.actor === 'agent' ? 'agent' : 'human';
    return {
      authorizationMode: 'self-reported-local-demo',
      actor,
      principal:
        typeof options.untrusted?.principal === 'string'
          ? options.untrusted.principal
          : (request.headers.get('x-ui4a-principal') ?? 'local-user'),
      scopes: [...new Set(options.authorizedPolicyScopes)],
      grantedApplications,
      policyScope: declaredScopePreference(url, grantedApplications, headerScope),
      channel:
        options.plane === 'meta' && actor === 'human' && options.untrusted?.actor === undefined
          ? 'bios'
          : typeof options.untrusted?.channel === 'string'
            ? options.untrusted.channel
            : 'http',
      humanApprovalEligible: actor === 'human',
    };
  }

  const config =
    options.productionConfig ??
    (options.productionPolicy !== undefined && options.productionDependencies !== undefined
      ? undefined
      : productionConfig(options));
  const policy = options.productionPolicy ?? policyFor(config!, options.authorizedPolicyScopes);
  const authorizationHeader = request.headers.get('authorization');
  const hasSessionCookie = hasCookie(request, BROWSER_SESSION_COOKIE_NAME);
  if (authorizationHeader !== null && hasSessionCookie) {
    throw new ProductionIdentityError('credential_source_conflict');
  }
  const credentialAuthorization = hasSessionCookie
    ? (
        await (
          options.browserAuthentication ?? getProductionBrowserAuthentication()
        ).resolveSession(request)
      ).authorizationHeader
    : authorizationHeader;
  const credential = await verifyProductionCredential(
    credentialAuthorization,
    policy,
    options.productionDependencies ?? dependenciesFor(config!),
  );
  const identity = buildProductionRequestIdentity(
    credential,
    { requiredScopes: options.requiredScopes, untrusted: options.untrusted },
    policy,
  );
  // D51:凭证授予集合来自 token 的 policy 词汇解析(grantedPolicyScopes:
  // ui4a:policy:* 解为应用名,ui4a:* 其余丢弃,其余原样保留)。空集合按无授权
  // 处理(D48-R8 口径);非应用词表项(openid 等)不会匹配任何事实归属,
  // 授权天然收口于受众谓词 × 已安装应用。
  const grantedApplications = grantedPolicyScopes(identity.scopes);
  if (grantedApplications.length === 0) {
    throw new ProductionIdentityError('scope_insufficient');
  }
  return {
    authorizationMode: 'credential',
    actor: identity.actor === 'human' ? 'human' : 'agent',
    principal: identity.principal,
    scopes: identity.scopes,
    grantedApplications,
    policyScope: declaredScopePreference(new URL(request.url), grantedApplications),
    channel: 'oidc',
    humanApprovalEligible: identity.humanApprovalEligible,
    ...(identity.delegation === undefined ? {} : { delegation: identity.delegation }),
  };
}

export function applyTrustedIdentity(
  request: ExecRequest,
  identity: TrustedRequestAuditContext,
): ExecRequest {
  return {
    ...request,
    actor: identity.actor,
    principal: identity.principal,
    channel: identity.channel,
    identity: {
      authorizationMode: identity.authorizationMode,
      scopes: [...identity.scopes],
      ...(identity.policyScope === undefined ? {} : { policyScope: identity.policyScope }),
      humanApprovalEligible: identity.humanApprovalEligible,
      ...(identity.delegation === undefined ? {} : { delegation: { ...identity.delegation } }),
    },
  };
}

/** Human approval is a second gate after credential identity is established. */
export function requireHumanApprovalScope(identity: TrustedRequestAuditContext): void {
  if (
    identity.authorizationMode === 'credential' &&
    identity.actor === 'human' &&
    !identity.scopes.includes('ui4a:approve')
  ) {
    throw new ProductionIdentityError('scope_insufficient');
  }
}

export function authenticationErrorResponse(error: unknown): Response | undefined {
  if (error instanceof BrowserAuthenticationError) {
    const unavailable = new Set([
      'oidc_token_endpoint_unavailable',
      'jwks_unavailable',
      'session_refresh_unavailable',
      'oidc_revocation_unavailable',
    ]);
    const unauthorized = new Set([
      'session_cookie_invalid',
      'session_not_found',
      'session_expired',
      'session_revoked',
    ]);
    return Response.json(
      { error: { code: error.code } },
      { status: unavailable.has(error.code) ? 503 : unauthorized.has(error.code) ? 401 : 400 },
    );
  }
  if (!(error instanceof ProductionIdentityError)) return undefined;
  const forbidden = new Set([
    'scope_insufficient',
    'delegation_actor_not_allowed',
    'delegation_scope_exceeded',
  ]);
  return Response.json(
    { error: { code: error.code } },
    { status: forbidden.has(error.code) ? 403 : 401 },
  );
}
