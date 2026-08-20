import { getDb, getEngine } from '../../../engine/service';

// GET /api/entity?rel=… — Siren 实体端点(spec FR3):
// - 已知 rel(实例或集合)→ 200 四件组装 properties/actions/links/guard-results;
// - 集合实体经 entities[] 携带子实体与直达 href(B2 点名导航);
// - 未知 rel → 404;缺 rel → 400;db 不可达(启动失败)→ 503。
// 快照为内存物化态:boot 后读取不触库。

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('rel');
  if (rel === null || rel === '') {
    return Response.json({ error: '缺少必填查询参数 rel' }, { status: 400 });
  }

  try {
    const engine = await getEngine(getDb());
    const entity = engine.getEntity(rel);
    if (entity === undefined) {
      return Response.json({ error: `实体 "${rel}" 不存在` }, { status: 404 });
    }
    return Response.json(entity);
  } catch {
    return Response.json({ error: 'entity 数据库不可用' }, { status: 503 });
  }
}
