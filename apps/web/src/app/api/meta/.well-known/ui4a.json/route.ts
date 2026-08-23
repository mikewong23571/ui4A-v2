import { contentVersion } from '@ui4a/engine';

import { getDb, getEngine } from '../../../../../engine/service';
import { getAgentDefinitionCatalog } from '../../../../../engine/agent-definitions';

// GET /_meta/.well-known/ui4a.json — meta 站点 sitemap 端点(T4 Phase B,spec 决定 6):
// 定义层交互拓扑的声明(meta rel 面:self/flows/activations + 每个定义实体),
// 版本号 = surfaces 内容 hash 短码(定义新增/激活即变化)。
// 跨站规则:业务站 sitemap 不携带任何 _meta 入口,进入定义层必须显式意图
// (直接访问 /api/meta/* 为同一处理器的内部别名;canonical URL 恒 /_meta/*)。

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const current = engine.getMetaSitemap();
    const principal = request?.headers.get('x-ui4a-principal') ?? 'local-user';
    const policyScope = request?.headers.get('x-ui4a-policy-scope') ?? 'publishing';
    const agents = await getAgentDefinitionCatalog(db, principal, policyScope);
    const surfaces = [
      ...current.surfaces,
      { rel: 'meta/drafts', title: 'Governed Drafts', collection: true },
      { rel: 'meta/agent-definitions', title: 'Specialized Agents', collection: true },
      ...agents.map((agent) => ({
        rel: `meta/agent-definition:${agent.ref}`,
        title: agent.name,
      })),
    ];
    return Response.json({
      protocolVersion: '1',
      ...current,
      version: contentVersion(surfaces),
      surfaces,
    });
  } catch {
    return Response.json({ error: 'meta sitemap 数据库不可用' }, { status: 503 });
  }
}
