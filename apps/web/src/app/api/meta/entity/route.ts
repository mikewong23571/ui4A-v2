import { getDb, getEngine, isMetaRel } from '../../../../engine/service';
import {
  getDraftMetaEntity,
  getDraftMetaEntityForScopes,
  isDraftMetaRel,
} from '../../../../engine/drafts/drafts';
import {
  agentDefinitionDraftRegistryPort,
  getAgentDefinitionMetaEntity,
  getAgentDefinitionMetaEntityForScopes,
  isAgentDefinitionMetaRel,
} from '../../../../engine/agent/agent-definitions';
import {
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../../auth/request-identity';
import {
  assertReachable,
  filterEntityForGrantedApplications,
} from '../../../../auth/application-scope';
import { declaredApplication } from '../../../../engine/situation';

// GET /_meta/api/entity?rel=… — meta 站点 Siren 实体端点(T4 Phase B,spec 决定 6):
// - rel 以 meta/ 前缀路由到同一引擎的 meta 投影(同日志同串行队列;快照即真相);
// - href 前缀 /_meta(站点自洽:导航留在定义层);
// - 跨站规则:非 meta rel → 404(业务 rel 须经业务站 /api/entity,不混站);
// - 未知 meta rel → 404;缺 rel → 400;db 不可达 → 503。

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('rel');
  if (rel === null || rel === '') {
    return Response.json({ error: '缺少必填查询参数 rel' }, { status: 400 });
  }
  if (!isMetaRel(rel)) {
    return Response.json(
      { error: `实体 "${rel}" 不在 meta 站点(跨站规则:业务 rel 须经 /api/entity)` },
      { status: 404 },
    );
  }

  try {
    const db = getDb();
    const engine = await getEngine(db);
    const snapshot = engine.getSnapshot();
    const sitemap = engine.getSitemap();
    const authorizedPolicyScopes = Object.keys(snapshot.applications ?? {});
    const identity = await resolveTrustedRequestIdentity(request, {
      plane: 'meta',
      requiredScopes: ['ui4a:read'],
      authorizedPolicyScopes,
    });
    // D51:授权 = 授予集合 × meta 归属;effectiveScope 只作展示槽位(Draft 目录
    // 默认目标/响应头),不参与判权。
    const audienceContext = { snapshot, sitemap, plane: 'meta' as const };
    if (identity.authorizationMode === 'credential') {
      assertReachable(audienceContext, rel, identity.grantedApplications);
    }
    const effectiveScope = declaredApplication(identity, authorizedPolicyScopes);
    const grantedScopes = identity.grantedApplications.filter((scope) =>
      authorizedPolicyScopes.includes(scope),
    );
    const entity = isDraftMetaRel(rel)
      ? effectiveScope === undefined
        ? await getDraftMetaEntityForScopes(
            db,
            engine,
            rel,
            identity.principal,
            grantedScopes,
            agentDefinitionDraftRegistryPort,
          )
        : await getDraftMetaEntity(
            db,
            engine,
            rel,
            identity.principal,
            effectiveScope,
            agentDefinitionDraftRegistryPort,
          )
      : isAgentDefinitionMetaRel(rel)
        ? effectiveScope === undefined
          ? await getAgentDefinitionMetaEntityForScopes(db, rel, identity.principal, grantedScopes)
          : await getAgentDefinitionMetaEntity(db, rel, identity.principal, effectiveScope)
        : await engine.getMetaEntity(rel);
    if (entity === undefined) {
      return Response.json({ error: `实体 "${rel}" 不存在` }, { status: 404 });
    }
    return Response.json(
      identity.authorizationMode === 'credential'
        ? filterEntityForGrantedApplications(entity, {
            ...audienceContext,
            grantedApplications: identity.grantedApplications,
          })
        : entity,
      {
        headers: {
          ...(identity.policyScope !== undefined
            ? { 'x-ui4a-effective-scope': identity.policyScope }
            : {}),
          'x-ui4a-authorization-mode': identity.authorizationMode,
        },
      },
    );
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    const err = error as { code?: string; message?: string };
    const dbFailure =
      typeof err.code === 'string' &&
      /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|28P01|3D000/.test(err.code);
    const message = error instanceof Error ? error.message : String(error);
    if (/not authorized|conflicting/.test(message)) {
      return Response.json({ error: message }, { status: 403 });
    }
    return Response.json(
      dbFailure
        ? { error: 'meta entity 数据库不可用' }
        : { error: `meta entity 读取失败: ${message}` },
      { status: dbFailure ? 503 : 500 },
    );
  }
}
