import { parsePresenceChange } from '@ui4a/shared';

import {
  appendPresenceChange,
  ensurePresenceTables,
  PresenceRateLimitError,
} from '../../../../db/presence';
import {
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../../auth/request-identity';
import { getDb, getEngine } from '../../../../engine/service';

export const dynamic = 'force-dynamic';

/** POST /api/presence — append one bounded, server-owned presence change point. */
export async function POST(request: Request): Promise<Response> {
  let change;
  try {
    change = parsePresenceChange(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Presence change invalid' },
      { status: 400 },
    );
  }
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const identity = await resolveTrustedRequestIdentity(request, {
      plane: 'business',
      requiredScopes: ['ui4a:write'],
      authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
      defaultPolicyScope: 'default',
    });
    if (
      change.kind === 'scope' &&
      change.value !== null &&
      !identity.scopes.includes(change.value)
    ) {
      return Response.json({ error: { code: 'scope_insufficient' } }, { status: 403 });
    }
    await ensurePresenceTables(db);
    return Response.json(
      await appendPresenceChange(db, change, {
        principal: identity.principal,
        actor: identity.actor,
        channel: identity.channel,
      }),
    );
  } catch (error) {
    if (error instanceof PresenceRateLimitError) {
      return Response.json({ error: { code: error.code } }, { status: 429 });
    }
    return (
      authenticationErrorResponse(error) ??
      Response.json({ error: 'presence 数据库不可用' }, { status: 503 })
    );
  }
}
