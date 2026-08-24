import type { ExecRequest } from '@ui4a/engine';
import type { DeploymentEnvironment, ProductionDeploymentConfig } from '@ui4a/shared';

import { resolveMetaRequestContext } from '../engine/meta-authorization';
import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';

import {
  buildProductionRequestIdentity,
  createRemoteJwksLoader,
  ProductionIdentityError,
  type ProductionCredentialDependencies,
  type ProductionCredentialPolicy,
  type ProductionRequestIdentity,
  verifyProductionCredential,
} from './production-request-identity';
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
  policyScope: string;
  channel: string;
  humanApprovalEligible: boolean;
  delegation?: ProductionRequestIdentity['delegation'];
}

export interface ResolveRequestIdentityOptions {
  requiredScopes: string[];
  authorizedPolicyScopes: readonly string[];
  defaultPolicyScope: string;
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
  const agentClientId = 'ui4a-agent';
  return {
    issuer: config.settings.auth.oidc.issuer,
    audience: config.settings.auth.oidc.audience,
    algorithms: ['RS256'],
    humanClientIds: [config.settings.auth.oidc.clientId],
    agentClientIds: [agentClientId],
    delegatedScopesByClient: {
      [agentClientId]: [
        'ui4a:read',
        'ui4a:write',
        ...authorizedPolicyScopes,
        ...authorizedPolicyScopes.map((scope) => `ui4a:policy:${scope}`),
      ],
    },
    maximumDelegationDepth: 1,
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

function policyScopeClaims(claims: Record<string, unknown>, scopes: readonly string[]): string[] {
  const custom = claims.ui4a_policy_scope ?? claims.policy_scope;
  const customScopes =
    typeof custom === 'string'
      ? custom.split(/\s+/).filter(Boolean)
      : Array.isArray(custom) && custom.every((item) => typeof item === 'string')
        ? custom
        : [];
  const prefixed = scopes
    .filter((scope) => scope.startsWith('ui4a:policy:'))
    .map((scope) => scope.slice('ui4a:policy:'.length));
  return [...new Set([...customScopes, ...prefixed, ...scopes])];
}

function resolveCredentialPolicyScope(
  identity: ProductionRequestIdentity,
  claims: Record<string, unknown>,
  authorizedScopes: readonly string[],
  defaultScope: string,
): string {
  const granted = policyScopeClaims(claims, identity.scopes).filter((scope) =>
    authorizedScopes.includes(scope),
  );
  if (granted.length === 0) throw new ProductionIdentityError('scope_insufficient');
  return granted.includes(defaultScope) ? defaultScope : granted[0]!;
}

function hasCookie(request: Request, name: string): boolean {
  const cookie = request.headers.get('cookie');
  if (cookie === null) return false;
  return cookie.split(';').some((part) => {
    const separator = part.indexOf('=');
    return separator >= 0 && part.slice(0, separator).trim() === name;
  });
}

export async function resolveTrustedRequestIdentity(
  request: Request,
  options: ResolveRequestIdentityOptions,
): Promise<TrustedRequestAuditContext> {
  const profile = options.profile ?? requestIdentityProfile(options.environment);
  if (profile === 'local') {
    const url = new URL(request.url);
    const local = resolveMetaRequestContext({
      principal:
        typeof options.untrusted?.principal === 'string'
          ? options.untrusted.principal
          : (request.headers.get('x-ui4a-principal') ?? undefined),
      requestedScope:
        url.searchParams.get('scope') ?? url.searchParams.get('policyScope') ?? undefined,
      headerScope: request.headers.get('x-ui4a-policy-scope') ?? undefined,
      authorizedScopes: options.authorizedPolicyScopes,
      defaultScope: options.defaultPolicyScope,
    });
    const actor = options.untrusted?.actor === 'agent' ? 'agent' : 'human';
    return {
      authorizationMode: local.authorizationMode,
      actor,
      principal: local.principal,
      scopes: local.authorizedScopes,
      policyScope: local.effectiveScope,
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
  const policyScope = resolveCredentialPolicyScope(
    identity,
    credential.claims,
    options.authorizedPolicyScopes,
    options.defaultPolicyScope,
  );
  return {
    authorizationMode: 'credential',
    actor: identity.actor === 'human' ? 'human' : 'agent',
    principal: identity.principal,
    scopes: identity.scopes,
    policyScope,
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
      humanApprovalEligible: identity.humanApprovalEligible,
      ...(identity.delegation === undefined ? {} : { delegation: { ...identity.delegation } }),
    },
  };
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
    'delegation_malformed',
    'delegation_too_deep',
    'delegation_actor_not_allowed',
    'delegation_scope_exceeded',
  ]);
  return Response.json(
    { error: { code: error.code } },
    { status: forbidden.has(error.code) ? 403 : 401 },
  );
}
