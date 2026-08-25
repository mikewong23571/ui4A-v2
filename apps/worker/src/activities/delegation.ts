/**
 * delegation activities(T5 Phase A / spec 架构决定 1):
 * - startDelegation / finishDelegation:委托首尾事件落 PG(幂等);
 * - loadSitemap:agent 静态上下文,循环外取一次;
 * - agentStep:决策+执行合一的单步核心(见 delegation.ts;llm 决策的网络
 *   调用因此天然在 activity 内,workflow 重放确定性)。
 */
import {
  createBoundedBearerFetch,
  createProductionAgentTokenProvider,
  resolveLlmConfig,
  type AgentDriver,
  type FetchLike,
  type ProductionAgentTokenProvider,
  type SitemapSummary,
} from '@ui4a/agent';
import type { ProductionDeploymentConfig } from '@ui4a/shared';

import type { DbExecutor } from '../../../web/src/db/events';

import {
  fetchSitemap,
  recordDelegationFinish,
  recordDelegationStart,
  runAgentStep,
} from '../delegation';
import type {
  AgentStepArgs,
  AgentStepResult,
  DelegationFinishArgs,
  DelegationStartArgs,
} from '../workflows';
import { workerDb } from '../worker-db';
import { productionAgentActivityConfig } from './production-config';

/** delegation activity 注册表(workflow 经 proxyActivities 按名调用)。 */
export interface DelegationActivities {
  startDelegation(args: DelegationStartArgs): Promise<{ seq: number; deduplicated: boolean }>;
  loadSitemap(args: { baseUrl: string }): Promise<SitemapSummary | undefined>;
  agentStep(args: AgentStepArgs): Promise<AgentStepResult>;
  finishDelegation(args: DelegationFinishArgs): Promise<{ seq: number; deduplicated: boolean }>;
}

const PRODUCTION_AGENT_CONTRACT_PATHS = [
  '/.well-known/ui4a.json',
  '/api/entity',
  '/api/exec',
  '/api/exec-plan',
] as const;

export interface ProductionAgentActivityDeps {
  config: ProductionDeploymentConfig;
  credentialProvider: Pick<ProductionAgentTokenProvider, 'getClientCredential'>;
  fetchImpl: FetchLike;
  db: DbExecutor;
  driver?: AgentDriver;
}

export class ProductionAgentActivityAuthenticationError extends Error {
  readonly code = 'agent_activity_credential_unavailable';

  constructor() {
    super('agent_activity_credential_unavailable');
    this.name = 'ProductionAgentActivityAuthenticationError';
  }
}

function requireCanonicalAgentActivityOrigin(
  config: ProductionDeploymentConfig,
  suppliedBaseUrl: string,
): string {
  const canonicalOrigin = config.settings.service.publicOrigin;
  if (suppliedBaseUrl !== canonicalOrigin) {
    throw new Error('agent_activity_base_url_must_equal_canonical_origin');
  }
  return canonicalOrigin;
}

async function productionAgentFetch(
  deps: ProductionAgentActivityDeps,
  suppliedBaseUrl: string,
): Promise<FetchLike> {
  const origin = requireCanonicalAgentActivityOrigin(deps.config, suppliedBaseUrl);
  let authorizationHeader: string;
  try {
    ({ authorizationHeader } = await deps.credentialProvider.getClientCredential());
  } catch {
    throw new ProductionAgentActivityAuthenticationError();
  }
  return createBoundedBearerFetch({
    origin,
    authorizationHeader,
    allowedPaths: PRODUCTION_AGENT_CONTRACT_PATHS,
    fetch: deps.fetchImpl,
  });
}

/** Production Activity core: the credential exists only in the bounded Fetch closure. */
export async function loadSitemapWithProductionAuth(
  deps: ProductionAgentActivityDeps,
  args: { baseUrl: string },
): Promise<SitemapSummary | undefined> {
  const authenticatedFetch = await productionAgentFetch(deps, args.baseUrl);
  return fetchSitemap(args.baseUrl, authenticatedFetch);
}

/** Production Activity core: verified Bearer identity replaces all self-reported identity fields. */
export async function agentStepWithProductionAuth(
  deps: ProductionAgentActivityDeps,
  args: AgentStepArgs,
): Promise<AgentStepResult> {
  const authenticatedFetch = await productionAgentFetch(deps, args.baseUrl);
  return runAgentStep(
    {
      db: deps.db,
      fetchImpl: authenticatedFetch,
      ...(deps.driver === undefined ? {} : { driver: deps.driver }),
      selfReportedIdentity: false,
    },
    args,
  );
}

function productionAgentActivityDeps(
  config: ProductionDeploymentConfig,
): ProductionAgentActivityDeps {
  const oidc = config.settings.auth.oidc;
  return {
    config,
    credentialProvider: createProductionAgentTokenProvider({
      tokenEndpoint: `${oidc.issuer}/protocol/openid-connect/token`,
      audience: oidc.audience,
      clientId: oidc.agentClientId,
      clientSecret: config.secrets[oidc.agentClientSecretRef]!,
      registeredClientIds: [oidc.agentClientId],
      allowedScopes: oidc.agentScopes,
      clock: Date.now,
      fetcher: fetch,
    }),
    fetchImpl: fetch,
    db: workerDb(process.env, config),
  };
}

export async function startDelegation(
  args: DelegationStartArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return recordDelegationStart(workerDb(), { ...args, model: resolveLlmConfig().model });
}

export async function loadSitemap(args: { baseUrl: string }): Promise<SitemapSummary | undefined> {
  const config = productionAgentActivityConfig();
  if (config !== undefined) {
    return loadSitemapWithProductionAuth(productionAgentActivityDeps(config), args);
  }
  return fetchSitemap(args.baseUrl, fetch);
}

export async function agentStep(args: AgentStepArgs): Promise<AgentStepResult> {
  const config = productionAgentActivityConfig();
  if (config !== undefined) {
    return agentStepWithProductionAuth(productionAgentActivityDeps(config), args);
  }
  return runAgentStep({ db: workerDb(), fetchImpl: fetch }, args);
}

export async function finishDelegation(
  args: DelegationFinishArgs,
): Promise<{ seq: number; deduplicated: boolean }> {
  return recordDelegationFinish(workerDb(), args);
}
