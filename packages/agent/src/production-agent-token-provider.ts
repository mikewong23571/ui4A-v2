const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';

export type ProductionAgentTokenErrorCode =
  | 'agent_token_endpoint_invalid'
  | 'agent_client_invalid'
  | 'agent_client_unknown'
  | 'agent_client_secret_invalid'
  | 'agent_audience_invalid'
  | 'agent_allowed_scopes_invalid'
  | 'agent_subject_token_invalid'
  | 'agent_scope_exceeded'
  | 'agent_deployment_override_forbidden'
  | 'agent_token_endpoint_unavailable'
  | 'agent_token_response_invalid';

export class ProductionAgentTokenError extends Error {
  readonly code: ProductionAgentTokenErrorCode;

  constructor(code: ProductionAgentTokenErrorCode) {
    super(code);
    this.name = 'ProductionAgentTokenError';
    this.code = code;
  }
}

export interface AgentCredentialResult {
  authorizationHeader: string;
  expiresAtMs: number;
}

export interface ProductionAgentTokenProvider {
  getClientCredential(): Promise<AgentCredentialResult>;
  exchangeDelegatedCredential(input: {
    subjectToken: string;
    requestedScopes: string[];
    untrustedTaskOverrides?: Record<string, unknown>;
  }): Promise<AgentCredentialResult>;
}

export interface ProductionAgentTokenProviderOptions {
  tokenEndpoint: string;
  audience: string;
  clientId: string;
  clientSecret: string;
  registeredClientIds: string[];
  allowedScopes: string[];
  clock: () => number;
  fetcher: typeof fetch;
}

interface AgentTokenResponse {
  accessToken: string;
  expiresInSeconds: number;
  scopes: string[];
}

function fail(code: ProductionAgentTokenErrorCode): never {
  throw new ProductionAgentTokenError(code);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value === value.trim();
}

function configuredScopes(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((scope) => nonEmpty(scope) && /^\S+$/.test(scope))
  ) {
    return undefined;
  }
  const scopes = [...value] as string[];
  return new Set(scopes).size === scopes.length ? scopes : undefined;
}

function validTokenEndpoint(value: string): boolean {
  if (!nonEmpty(value)) return false;
  try {
    const endpoint = new URL(value);
    return (
      endpoint.protocol === 'https:' &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      endpoint.hash === ''
    );
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokenResponse(
  value: unknown,
  issuedTokenTypeRequired: boolean,
): AgentTokenResponse | undefined {
  if (!record(value)) return undefined;
  const issuedTokenTypeValid =
    value.issued_token_type === ACCESS_TOKEN_TYPE ||
    (!issuedTokenTypeRequired && value.issued_token_type === undefined);
  if (
    !nonEmpty(value.access_token) ||
    !issuedTokenTypeValid ||
    value.token_type !== 'Bearer' ||
    typeof value.expires_in !== 'number' ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    !nonEmpty(value.scope)
  ) {
    return undefined;
  }
  const scopes = value.scope.trim().split(/\s+/);
  if (new Set(scopes).size !== scopes.length) return undefined;
  return {
    accessToken: value.access_token,
    expiresInSeconds: value.expires_in,
    scopes,
  };
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

/**
 * Creates the production-only confidential Agent credential boundary.
 *
 * The provider fixes every grant-shaping field from deployment-owned options. Returned access
 * tokens remain opaque: API request authentication is the sole authority for their claims.
 */
export function createProductionAgentTokenProvider(
  options: ProductionAgentTokenProviderOptions,
): ProductionAgentTokenProvider {
  if (!validTokenEndpoint(options.tokenEndpoint)) fail('agent_token_endpoint_invalid');
  if (!nonEmpty(options.clientId)) fail('agent_client_invalid');
  if (
    !Array.isArray(options.registeredClientIds) ||
    !options.registeredClientIds.includes(options.clientId)
  ) {
    fail('agent_client_unknown');
  }
  if (
    !nonEmpty(options.clientSecret) ||
    options.clientSecret === options.clientId ||
    options.clientSecret === options.audience
  ) {
    fail('agent_client_secret_invalid');
  }
  if (!nonEmpty(options.audience)) fail('agent_audience_invalid');
  const allowedScopes = configuredScopes(options.allowedScopes);
  if (allowedScopes === undefined) fail('agent_allowed_scopes_invalid');
  const allowedScopeSet = new Set(allowedScopes);
  const authorization = basicAuthorization(options.clientId, options.clientSecret);
  const tokenEndpoint = options.tokenEndpoint;
  const audience = options.audience;
  const clock = options.clock;
  const fetcher = options.fetcher;

  async function requestCredential(
    parameters: URLSearchParams,
    maximumScopes: ReadonlySet<string>,
    issuedTokenTypeRequired: boolean,
  ): Promise<AgentCredentialResult> {
    let response: Response;
    try {
      response = await fetcher(tokenEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: parameters,
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      return fail('agent_token_endpoint_unavailable');
    }
    if (!response.ok) return fail('agent_token_endpoint_unavailable');

    let rawPayload: unknown;
    try {
      rawPayload = await response.json();
    } catch {
      return fail('agent_token_response_invalid');
    }
    const payload = tokenResponse(rawPayload, issuedTokenTypeRequired);
    if (payload === undefined || payload.scopes.some((scope) => !maximumScopes.has(scope))) {
      return fail('agent_token_response_invalid');
    }
    const now = clock();
    const expiresAtMs = now + payload.expiresInSeconds * 1_000;
    if (!Number.isFinite(now) || !Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      return fail('agent_token_response_invalid');
    }
    return {
      authorizationHeader: `Bearer ${payload.accessToken}`,
      expiresAtMs,
    };
  }

  return {
    getClientCredential() {
      return requestCredential(
        new URLSearchParams({
          grant_type: 'client_credentials',
          audience,
          scope: allowedScopes.join(' '),
        }),
        allowedScopeSet,
        false,
      );
    },

    exchangeDelegatedCredential(input) {
      if (input.untrustedTaskOverrides !== undefined) {
        if (!record(input.untrustedTaskOverrides)) {
          return Promise.reject(
            new ProductionAgentTokenError('agent_deployment_override_forbidden'),
          );
        }
        if (Object.keys(input.untrustedTaskOverrides).length > 0) {
          return Promise.reject(
            new ProductionAgentTokenError('agent_deployment_override_forbidden'),
          );
        }
      }
      if (!nonEmpty(input.subjectToken)) {
        return Promise.reject(new ProductionAgentTokenError('agent_subject_token_invalid'));
      }
      const requestedScopes = configuredScopes(input.requestedScopes);
      if (
        requestedScopes === undefined ||
        requestedScopes.some((scope) => !allowedScopeSet.has(scope))
      ) {
        return Promise.reject(new ProductionAgentTokenError('agent_scope_exceeded'));
      }
      return requestCredential(
        new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: input.subjectToken,
          subject_token_type: ACCESS_TOKEN_TYPE,
          requested_token_type: ACCESS_TOKEN_TYPE,
          audience,
          scope: requestedScopes.join(' '),
        }),
        new Set(requestedScopes),
        true,
      );
    },
  };
}
