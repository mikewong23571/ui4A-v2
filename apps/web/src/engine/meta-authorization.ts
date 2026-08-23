export const META_LOCAL_AUTHORIZATION_MODE = 'self-reported-local-demo' as const;

export interface MetaRequestContext {
  principal: string;
  requestedScope?: string;
  effectiveScope: string;
  authorizedScopes: string[];
  authorizationMode: typeof META_LOCAL_AUTHORIZATION_MODE;
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
  const fallback = authorizedScopes.includes('publishing') ? 'publishing' : authorizedScopes[0]!;
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
): MetaRequestContext {
  if (request === undefined) return resolveMetaRequestContext({ authorizedScopes });
  const url = new URL(request.url);
  return resolveMetaRequestContext({
    principal: request.headers.get('x-ui4a-principal') ?? undefined,
    requestedScope:
      url.searchParams.get('scope') ?? url.searchParams.get('policyScope') ?? undefined,
    headerScope: request.headers.get('x-ui4a-policy-scope') ?? undefined,
    authorizedScopes,
  });
}
