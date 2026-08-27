import { getDb, getEngine } from '../../../engine/service';
import { getAgentDefinitionCatalogForScopes } from '../../../engine/agent/agent-definitions';
import {
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';
import { filterSitemapForPolicyScopes } from './sitemap-scope-union';

// GET /.well-known/ui4a.json — 应用 sitemap 端点(spec FR4):
// 从 flow 常量纯推导的"应用交互拓扑完整声明"(界面清单/流程拓扑/每节点
// action schema/版本号=内容 hash 短码),boot 时生成后缓存——定义不变则不变。
// agent 的第一跳:先读 sitemap 再沿 surfaces 导航。
// 多 policy scope 用户(如 granted=[default, publishing]):发现文档 = 已授予
// scope 的并集(逐 scope 过滤后合并去重),消除"冻结单一 scope"漏掉其他已授权
// 应用入口的问题;effectiveScope 类单值语义不在此响应内,身份解析的默认 scope
// 只决定 granted 集合的成员,不决定内容取舍。

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const authorizedPolicyScopes = Object.keys(engine.getSnapshot().applications ?? {});
    const identity = await resolveTrustedRequestIdentity(
      request ?? new Request('http://localhost:3100/.well-known/ui4a.json'),
      {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes,
      },
    );
    const principal = identity.principal;
    // D51:发现文档 = 授予集合的并集(identity.grantedApplications 收窄到本引擎
    // 已登记 application——凭据里携带的未知应用名不参与发现)。
    const granted = [...new Set(identity.grantedApplications)].filter((scope) =>
      authorizedPolicyScopes.includes(scope),
    );
    const agents = await getAgentDefinitionCatalogForScopes(db, principal, granted);
    const sitemap = engine.getSitemap();
    return Response.json({
      protocolVersion: '1',
      ...(identity.authorizationMode === 'credential'
        ? filterSitemapForPolicyScopes(sitemap, granted)
        : sitemap),
      agents,
    });
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    return Response.json({ error: 'sitemap 数据库不可用' }, { status: 503 });
  }
}
