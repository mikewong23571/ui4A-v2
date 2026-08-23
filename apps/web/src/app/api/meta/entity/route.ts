import { getDb, getEngine, isMetaRel } from '../../../../engine/service';
import { getDraftMetaEntity, isDraftMetaRel } from '../../../../engine/drafts';

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
    const url = new URL(request.url);
    const principal = request.headers.get('x-ui4a-principal') ?? 'local-user';
    const policyScope =
      request.headers.get('x-ui4a-policy-scope') ?? url.searchParams.get('policyScope') ?? 'publishing';
    const entity = isDraftMetaRel(rel)
      ? await getDraftMetaEntity(db, engine, rel, principal, policyScope)
      : await engine.getMetaEntity(rel);
    if (entity === undefined) {
      return Response.json({ error: `实体 "${rel}" 不存在` }, { status: 404 });
    }
    return Response.json(entity);
  } catch (error) {
    const err = error as { code?: string; message?: string };
    const dbFailure =
      typeof err.code === 'string' && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|28P01|3D000/.test(err.code);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      dbFailure
        ? { error: 'meta entity 数据库不可用' }
        : { error: `meta entity 读取失败: ${message}` },
      { status: dbFailure ? 503 : 500 },
    );
  }
}
