import { parsePresenceChange } from '@ui4a/shared';

import {
  appendPresenceChange,
  ensurePresenceTables,
  PresenceRateLimitError,
} from '../../../db/presence';
import {
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';
import { getDb, getEngine } from '../../../engine/service';
import { grantedPolicyScopes } from '../../../engine/situation';

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
    // R10 口径对齐:允许集与消费方(chat-situation.ts、api/entity/route.ts)一致,
    // 服务端解析出的 policyScope 追加在 granted 声明之后。
    const authorizedScopes = [...grantedPolicyScopes(identity.scopes), identity.policyScope];
    if (
      change.kind === 'scope' &&
      typeof change.value === 'string' &&
      !authorizedScopes.includes(change.value)
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
