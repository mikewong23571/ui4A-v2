import type { ClientViewReport } from '@ui4a/shared';

import type { TrustedRequestAuditContext } from '../auth/request-identity';
import { ensurePresenceTables, loadPresenceForPrincipal } from '../db/presence';
import type { PresentationTrustedContext } from './presentation/broker';
import { getDb } from './service';
import { assembleSituation, grantedPolicyScopes, type Situation } from './situation';

/**
 * Chat → Presentation 可信上下文(T22 口径):policyScope 仍是身份解析的冻结
 * fallback;grantedPolicyScopes 携带全部已授予 scope(identity.policyScope 并入
 * 去重,与 entity/route.ts 同口径)——目标 rel 在身份解析后才出现,覆盖选择由
 * Broker 授权点按 rel 完成。无 identity(local profile)维持单 scope local-demo。
 */
export function presentationContextForIdentity(
  identity: TrustedRequestAuditContext | undefined,
): PresentationTrustedContext {
  if (identity === undefined) return { policyScope: 'local-demo' };
  return {
    policyScope: identity.policyScope,
    grantedPolicyScopes: [
      ...new Set([...grantedPolicyScopes(identity.scopes), identity.policyScope]),
    ],
  };
}

export async function situationForChat(args: {
  principal: string;
  identity?: TrustedRequestAuditContext;
  clientView?: ClientViewReport;
}): Promise<Situation> {
  const explicit =
    args.clientView === undefined
      ? undefined
      : {
          site: args.clientView.presence.site,
          scope: args.clientView.presence.scope,
          thread: args.clientView.presence.thread,
          focus: args.clientView.presence.focus,
        };
  const defaults = { site: 'workstation', scope: args.identity?.policyScope ?? 'default' };
  const grantedScopes = args.identity
    ? [...grantedPolicyScopes(args.identity.scopes), args.identity.policyScope]
    : ['default'];
  try {
    const db = getDb();
    await ensurePresenceTables(db);
    return assembleSituation({
      principal: args.principal,
      grantedScopes: [...new Set(grantedScopes)],
      presence: await loadPresenceForPrincipal(db, args.principal),
      explicit,
      defaults,
    });
  } catch {
    // Presence is auxiliary; Chat remains available when its projection is unavailable.
    return assembleSituation({
      principal: args.principal,
      grantedScopes: [...new Set(grantedScopes)],
      explicit,
      defaults,
    });
  }
}
