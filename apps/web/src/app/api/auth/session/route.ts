import { getDb, getEngine } from '../../../../engine/service';
import {
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../../auth/request-identity';
import { browserLoginPolicyScopes, GOVERNANCE_LOGIN_SCOPE } from '../../../../auth/activation-disclosure';

// GET /api/auth/session — 当前会话授权事实投影(D70.3,T51):「我的授权」面板的
// 唯一数据源。复用 resolveTrustedRequestIdentity,零新授权输入;只读、不含任何
// 可变更授权的控件语义。**不返回已安装应用全集**——该事实仅经授予集合(含
// D66.4 治理展开)对主体可得;授予集合为空沿用结构化拒绝口径(scope_insufficient)。

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const authorizedPolicyScopes = Object.keys(engine.getSnapshot().applications ?? {});
    const identity = await resolveTrustedRequestIdentity(
      request ?? new Request('http://localhost:3100/api/auth/session'),
      {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes,
      },
    );
    const browserLoginScopes = browserLoginPolicyScopes();
    return Response.json({
      authorizationMode: identity.authorizationMode,
      actor: identity.actor,
      principal: identity.principal,
      scopes: [...identity.scopes],
      grantedApplications: [...identity.grantedApplications],
      governanceExpansion: identity.scopes.includes(GOVERNANCE_LOGIN_SCOPE),
      ...(browserLoginScopes === undefined ? {} : { browserLoginScopes: [...browserLoginScopes] }),
    });
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    return Response.json({ error: 'session 投影暂不可用' }, { status: 503 });
  }
}
