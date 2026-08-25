import { contentVersion } from '@ui4a/engine';

import { getDb, getEngine } from '../../../../../engine/service';
import { getAgentDefinitionCatalog } from '../../../../../engine/agent-definitions';
import {
  metaContextFromRequest,
  type MetaRequestContext,
} from '../../../../../engine/meta-authorization';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../../../../../auth/request-identity';

// GET /_meta/.well-known/ui4a.json — meta 站点 sitemap 端点(T4 Phase B,spec 决定 6):
// 定义层交互拓扑的声明(meta rel 面:self/flows/activations + 每个定义实体),
// 版本号 = surfaces 内容 hash 短码(定义新增/激活即变化)。
// 跨站规则:业务站 sitemap 不携带任何 _meta 入口,进入定义层必须显式意图
// (直接访问 /api/meta/* 为同一处理器的内部别名;canonical URL 恒 /_meta/*)。
// production profile(T22 验证修复):接入 application credential(Browser Session
// 或 Bearer,ui4a:read);effectiveScope 取 credential policy scope(?scope= 只能在
// granted 集合内选择),authorizedScopes 收窄为 granted policy scopes;local profile
// 行为不变(self-reported)。

export const dynamic = 'force-dynamic';

function grantedPolicyScopes(
  scopes: readonly string[],
  authorizedScopes: readonly string[],
): string[] {
  return [
    ...new Set(
      scopes
        .map((scope) =>
          scope.startsWith('ui4a:policy:') ? scope.slice('ui4a:policy:'.length) : scope,
        )
        .filter((scope) => authorizedScopes.includes(scope)),
    ),
  ];
}

export async function GET(request?: Request) {
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const current = engine.getMetaSitemap();
    const authorizedScopes = Object.keys(engine.getSnapshot().applications ?? {});
    let context: MetaRequestContext;
    if (request !== undefined && requestIdentityProfile() === 'production') {
      const identity = await resolveTrustedRequestIdentity(request, {
        plane: 'meta',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: authorizedScopes,
        defaultPolicyScope: 'publishing',
      });
      const granted = grantedPolicyScopes(identity.scopes, authorizedScopes);
      context = {
        principal: identity.principal,
        effectiveScope: identity.policyScope,
        authorizedScopes: granted.length > 0 ? granted : [identity.policyScope],
        authorizationMode: identity.authorizationMode,
      };
    } else {
      context = metaContextFromRequest(request, authorizedScopes);
    }
    const agents = await getAgentDefinitionCatalog(db, context.principal, context.effectiveScope);
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
      effectiveScope: context.effectiveScope,
      authorizedScopes: context.authorizedScopes,
      authorizationMode: context.authorizationMode,
    });
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    const message = error instanceof Error ? error.message : String(error);
    if (/not authorized|conflicting/.test(message)) {
      return Response.json({ error: message }, { status: 403 });
    }
    return Response.json({ error: 'meta sitemap 数据库不可用' }, { status: 503 });
  }
}
