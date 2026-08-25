export const META_LOCAL_AUTHORIZATION_MODE = 'self-reported-local-demo' as const;

export type MetaAuthorizationMode = typeof META_LOCAL_AUTHORIZATION_MODE | 'credential';

export interface MetaRequestContext {
  principal: string;
  requestedScope?: string;
  effectiveScope: string;
  authorizedScopes: string[];
  authorizationMode: MetaAuthorizationMode;
}

/**
 * Local-demo authorization adapter. The authorized set is supplied by server-owned application
 * state; browser/header values can select within it but cannot add to it.
 */
export function resolveMetaRequestContext(input: {
  principal?: string;
  requestedScope?: string;
  headerScope?: string;
  authorizedScopes: readonly string[];
  defaultScope?: string;
}): MetaRequestContext {
  const authorizedScopes = [...new Set(input.authorizedScopes)];
  if (authorizedScopes.length === 0) throw new Error('no authorized Meta scopes');
  if (
    input.requestedScope !== undefined &&
    input.headerScope !== undefined &&
    input.requestedScope !== input.headerScope
  ) {
    throw new Error('conflicting Meta scope claims');
  }
  const requestedScope = input.requestedScope ?? input.headerScope;
  const preferred = input.defaultScope ?? 'publishing';
  const fallback = authorizedScopes.includes(preferred) ? preferred : authorizedScopes[0]!;
  const effectiveScope = requestedScope ?? fallback;
  if (!authorizedScopes.includes(effectiveScope)) {
    throw new Error(`Meta scope is not authorized: ${effectiveScope}`);
  }
  return {
    principal: input.principal ?? 'local-user',
    ...(requestedScope === undefined ? {} : { requestedScope }),
    effectiveScope,
    authorizedScopes,
    authorizationMode: META_LOCAL_AUTHORIZATION_MODE,
  };
}

export function metaContextFromRequest(
  request: Request | undefined,
  authorizedScopes: readonly string[],
  defaultScope?: string,
): MetaRequestContext {
  if (request === undefined) return resolveMetaRequestContext({ authorizedScopes, defaultScope });
  const url = new URL(request.url);
  return resolveMetaRequestContext({
    principal: request.headers.get('x-ui4a-principal') ?? undefined,
    requestedScope:
      url.searchParams.get('scope') ?? url.searchParams.get('policyScope') ?? undefined,
    headerScope: request.headers.get('x-ui4a-policy-scope') ?? undefined,
    authorizedScopes,
    defaultScope,
  });
}
