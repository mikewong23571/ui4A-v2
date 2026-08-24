import { createProductionAgentTokenProvider, type ProductionAgentTokenProvider } from '@ui4a/agent';

import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';

export {
  createProductionAgentTokenProvider,
  ProductionAgentTokenError,
  type AgentCredentialResult,
  type ProductionAgentTokenErrorCode,
  type ProductionAgentTokenProvider,
  type ProductionAgentTokenProviderOptions,
} from '@ui4a/agent';

let provider: ProductionAgentTokenProvider | undefined;

/** Lazily composes the Web process Agent credential provider from canonical deployment config. */
export function getProductionAgentTokenProvider(): ProductionAgentTokenProvider {
  if (provider !== undefined) return provider;

  const config = runWebProductionDeploymentPreflight();
  if (config === undefined) {
    throw new Error('production Agent credentials require the production deployment profile');
  }
  const oidc = config.settings.auth.oidc;
  provider = createProductionAgentTokenProvider({
    tokenEndpoint: `${oidc.issuer}/protocol/openid-connect/token`,
    audience: oidc.audience,
    clientId: oidc.agentClientId,
    clientSecret: config.secrets[oidc.agentClientSecretRef]!,
    registeredClientIds: [oidc.agentClientId],
    allowedScopes: oidc.agentScopes,
    clock: Date.now,
    fetcher: globalThis.fetch,
  });
  return provider;
}
