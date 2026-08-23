import { getDb, getEngine } from '../../../engine/service';
import { getAgentDefinitionCatalog } from '../../../engine/agent-definitions';

// GET /.well-known/ui4a.json — 应用 sitemap 端点(spec FR4):
// 从 flow 常量纯推导的"应用交互拓扑完整声明"(界面清单/流程拓扑/每节点
// action schema/版本号=内容 hash 短码),boot 时生成后缓存——定义不变则不变。
// agent 的第一跳:先读 sitemap 再沿 surfaces 导航。

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const principal = request?.headers.get('x-ui4a-principal') ?? 'local-user';
    const policyScope = request?.headers.get('x-ui4a-policy-scope') ?? 'publishing';
    const agents = await getAgentDefinitionCatalog(db, principal, policyScope);
    return Response.json({ protocolVersion: '1', ...engine.getSitemap(), agents });
  } catch {
    return Response.json({ error: 'sitemap 数据库不可用' }, { status: 503 });
  }
}
