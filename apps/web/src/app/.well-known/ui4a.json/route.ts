import { getDb, getEngine } from '../../../engine/service';
import { getAgentDefinitionCatalog } from '../../../engine/agent-definitions';
import {
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';
import { filterSitemapForPolicyScope } from '../../../auth/application-scope';

// GET /.well-known/ui4a.json — 应用 sitemap 端点(spec FR4):
// 从 flow 常量纯推导的"应用交互拓扑完整声明"(界面清单/流程拓扑/每节点
// action schema/版本号=内容 hash 短码),boot 时生成后缓存——定义不变则不变。
// agent 的第一跳:先读 sitemap 再沿 surfaces 导航。

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const identity = await resolveTrustedRequestIdentity(
      request ?? new Request('http://localhost:3100/.well-known/ui4a.json'),
      {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
        defaultPolicyScope: 'publishing',
      },
    );
    const principal = identity.principal;
    const policyScope = identity.policyScope;
    const agents = await getAgentDefinitionCatalog(db, principal, policyScope);
    const sitemap = engine.getSitemap();
    return Response.json({
      protocolVersion: '1',
      ...(identity.authorizationMode === 'credential'
        ? filterSitemapForPolicyScope(sitemap, policyScope)
        : sitemap),
      agents,
    });
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    return Response.json({ error: 'sitemap 数据库不可用' }, { status: 503 });
  }
}
