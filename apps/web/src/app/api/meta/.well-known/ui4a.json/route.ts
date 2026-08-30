import { contentVersion } from '@ui4a/engine';

import { getDb, getEngine } from '../../../../../engine/service';
import { getAgentDefinitionCatalogForScopes } from '../../../../../engine/agent/agent-definitions';
import { metaContextFromRequest } from '../../../../../engine/meta-authorization';
import { filterMetaSitemapForGrantedApplications } from '../../../../../engine/meta-sitemap-authorization';
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
// 或 Bearer,ui4a:read);D51:发现内容按授予并集返回,effectiveScope 只作显式
// 导航偏好的展示槽位;local profile 行为不变(self-reported)。

export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  try {
    const db = getDb();
    const engine = await getEngine(db);
    const current = engine.getMetaSitemap();
    const authorizedScopes = Object.keys(engine.getSnapshot().applications ?? {});
    const credentialRequest = request !== undefined && requestIdentityProfile() === 'production';
    let context: {
      principal: string;
      effectiveScope?: string;
      authorizedScopes: string[];
      authorizationMode: 'self-reported-local-demo' | 'credential';
    };
    if (credentialRequest) {
      const identity = await resolveTrustedRequestIdentity(request, {
        plane: 'meta',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: authorizedScopes,
      });
      // D51:发现内容(surfaces/authorizedScopes/Agent 目录)恒按授予并集返回;
      // effectiveScope 只是显式 ?scope= 的导航偏好展示槽位,不冻结内容取舍。
      const granted = identity.grantedApplications.filter((scope) =>
        authorizedScopes.includes(scope),
      );
      const effectiveScope =
        identity.policyScope !== undefined && granted.includes(identity.policyScope)
          ? identity.policyScope
          : undefined;
      context = {
        principal: identity.principal,
        ...(effectiveScope === undefined ? {} : { effectiveScope }),
        authorizedScopes: granted,
        authorizationMode: identity.authorizationMode,
      };
    } else {
      context = metaContextFromRequest(request, authorizedScopes);
    }
    // Agent Definition 目录与 sitemap 内容同为 granted 并集语义:逐 authorizedScope
    // 取目录后按 name 合并去重(多 scope 用户能看到所有已授权应用的 Agent),而不是
    // 冻结在 effectiveScope 单 scope 上。
    const agents = await getAgentDefinitionCatalogForScopes(
      db,
      context.principal,
      context.authorizedScopes,
    );
    const disclosed = credentialRequest
      ? filterMetaSitemapForGrantedApplications(
          current,
          engine.getSitemap(),
          context.authorizedScopes,
        )
      : current;
    const surfaces = [
      ...disclosed.surfaces,
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
      // effectiveScope 只是显式 ?scope= 的导航偏好展示槽位(D51);发现内容
      // (surfaces/authorizedScopes)为授予并集,不被它冻结。
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
