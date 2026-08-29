import { CollectionQueryError } from '../../../engine/service-collection-query';
import { getDb, getEngine, isMetaRel } from '../../../engine/service';
import type { RawCollectionQuery } from '@ui4a/engine';
import {
  enrichEntityWithAgentRuns,
  getAgentRunEntity,
  isAgentRunRel,
} from '../../../engine/agent/agent-runs';
import {
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';
import {
  assertReachable,
  assertThreadOwner,
  filterEntityForGrantedApplications,
  filterThreadEntityForPrincipal,
} from '../../../auth/application-scope';

// GET /api/entity?rel=… — Siren 实体端点(spec FR3):
// - 已知 rel(实例或集合)→ 200 四件组装 properties/actions/links/guard-results;
// - 集合实体经 entities[] 携带子实体与直达 href(B2 点名导航);
// - 未知 rel → 404;缺 rel → 400;db 不可达(启动失败)→ 503;重放完整性破坏 → 500;
// - meta/ rel → 404(T4 跨站规则:定义平面须经 /_meta/api/entity,不混站);
// - 读路径增量 fold(T3 Phase C):返回前同步 worker 等外部写者追加的事件(spec 决定 4)。

export const dynamic = 'force-dynamic';

/**
 * 集合读面查询原始参数(T38):机械提取(offset 分页;filter.<dimension>=<value>
 * 过滤请求对,保请求序),判定全部在引擎层。其余查询参数(如 ?scope= 导航
 * 偏好)原样不解析。
 */
function rawCollectionQuery(url: URL): RawCollectionQuery | undefined {
  const offset = url.searchParams.get('offset') ?? undefined;
  const filter: Array<{ dimension: string; value: string }> = [];
  for (const [key, value] of url.searchParams) {
    if (key.startsWith('filter.')) {
      filter.push({ dimension: key.slice('filter.'.length), value });
    }
  }
  if (offset === undefined && filter.length === 0) return undefined;
  return { offset: offset ?? undefined, filter };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rel = url.searchParams.get('rel');
  if (rel === null || rel === '') {
    return Response.json({ error: '缺少必填查询参数 rel' }, { status: 400 });
  }
  if (isMetaRel(rel)) {
    return Response.json(
      { error: 'meta/ rel 须经 /_meta/api/entity(跨站规则:进入定义层必须显式意图)' },
      { status: 404 },
    );
  }

  try {
    const db = getDb();
    const engine = await getEngine(db);
    const snapshot = engine.getSnapshot();
    const sitemap = engine.getSitemap();
    const identity = await resolveTrustedRequestIdentity(request, {
      plane: 'business',
      requiredScopes: ['ui4a:read'],
      authorizedPolicyScopes: Object.keys(snapshot.applications ?? {}),
    });
    const principal = identity.principal;
    // D51 授权口径:凭证授予的应用集合 × 事实归属(受众谓词),不再装配会话 scope。
    const audienceContext = { snapshot, sitemap, plane: 'business' as const };
    assertThreadOwner(snapshot, rel, principal);
    if (identity.authorizationMode === 'credential') {
      assertReachable(audienceContext, rel, identity.grantedApplications);
    }
    const projected = isAgentRunRel(rel)
      ? await getAgentRunEntity(db, rel, principal)
      : await engine.getEntity(rel, rawCollectionQuery(url));
    const principalScoped =
      projected === undefined || isAgentRunRel(rel)
        ? projected
        : filterThreadEntityForPrincipal(projected, snapshot, rel, principal);
    const entity =
      principalScoped === undefined || isAgentRunRel(rel)
        ? principalScoped
        : await enrichEntityWithAgentRuns(db, principalScoped, principal);
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
    );
  } catch (error) {
    // 集合读面查询拒绝(T38):结构化 layer/reason 透出(拒绝即教育)。
    if (error instanceof CollectionQueryError) {
      return Response.json(
        {
          error: error.rejection.message,
          layer: error.rejection.layer,
          reason: error.rejection.reason,
        },
        { status: 400 },
      );
    }
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    // db 层故障(pg 连接类错误 code ECONNREFUSED/ETIMEDOUT 等)→ 503;
    // 增量 fold 的日志完整性错误如实 500 带原始信息,不伪装成基础设施故障
    //(与 /api/exec 同口径;产品指南:如实,不粉饰)。
    const err = error as { code?: string; message?: string };
    const dbFailure =
      typeof err.code === 'string' &&
      /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|28P01|3D000/.test(err.code);
    const message = error instanceof Error ? error.message : String(error);
    if (/not authorized|conflicting/.test(message)) {
      return Response.json({ error: message }, { status: 403 });
    }
    return Response.json(
      dbFailure ? { error: 'entity 数据库不可用' } : { error: `entity 读取失败: ${message}` },
      { status: dbFailure ? 503 : 500 },
    );
  }
}
