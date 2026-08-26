import type { ClientViewReport } from '@ui4a/shared';

import type { TrustedRequestAuditContext } from '../auth/request-identity';
import { ensurePresenceTables, loadPresenceForPrincipal } from '../db/presence';
import { getDb } from './service';
import { assembleSituation, grantedPolicyScopes, type Situation } from './situation';

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
