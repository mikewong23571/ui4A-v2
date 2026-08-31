import type { ClientViewReport } from '@ui4a/shared';

import type { TrustedRequestAuditContext } from '../auth/request-identity';
import { ensurePresenceTables, loadPresenceForPrincipal } from '@ui4a/db/presence';
import type { PresentationTrustedContext } from './presentation/broker';
import { getDb, getEngine } from './service';
import { assembleSituation, type Situation } from './situation';

/**
 * Chat → Presentation 可信上下文(D51):授权按授予集合 × 事实归属在 Broker
 * 咽喉点判定,上下文不再携带会话冻结 scope。无 identity(local profile)维持
 * 本地信任域标记 ['local-demo']。
 */
export function presentationContextForIdentity(
  identity: TrustedRequestAuditContext | undefined,
): PresentationTrustedContext {
  if (identity === undefined) return { grantedApplications: ['local-demo'] };
  return {
    principal: identity.principal,
    grantedApplications: identity.grantedApplications,
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
  // D51:授予集合直接来自凭证;显式 ?scope= 导航偏好只作候选之一,不产生默认回退。
  const defaults = { site: 'workstation' };
  let grantedScopes = args.identity ? [...args.identity.grantedApplications] : ['default'];
  try {
    const db = getDb();
    if (args.identity === undefined) {
      grantedScopes = Object.keys((await getEngine(db)).getSnapshot().applications ?? {});
    }
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
