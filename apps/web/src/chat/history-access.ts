import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../auth/request-identity';
import { getDb, getEngine } from '../engine/service';

/** Production chat history is private to the credential principal; local demo keeps its open view. */
export async function chatHistoryPrincipal(request: Request): Promise<string | undefined> {
  if (requestIdentityProfile() !== 'production') return undefined;
  const engine = await getEngine(getDb());
  const identity = await resolveTrustedRequestIdentity(request, {
    plane: 'business',
    requiredScopes: ['ui4a:read'],
    authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
    defaultPolicyScope: 'default',
  });
  return identity.principal;
}

export function chatHistoryReadError(error: unknown): Response {
  return (
    authenticationErrorResponse(error) ??
    Response.json({ error: 'events 数据库不可用' }, { status: 503 })
  );
}
