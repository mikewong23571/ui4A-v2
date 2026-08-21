import { getDb, getEngine, isMetaRel } from '../../../engine/service';

// GET /api/entity?rel=… — Siren 实体端点(spec FR3):
// - 已知 rel(实例或集合)→ 200 四件组装 properties/actions/links/guard-results;
// - 集合实体经 entities[] 携带子实体与直达 href(B2 点名导航);
// - 未知 rel → 404;缺 rel → 400;db 不可达(启动失败)→ 503;重放完整性破坏 → 500;
// - meta/ rel → 404(T4 跨站规则:定义平面须经 /_meta/api/entity,不混站);
// - 读路径增量 fold(T3 Phase C):返回前同步 worker 等外部写者追加的事件(spec 决定 4)。

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get('rel');
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
    const engine = await getEngine(getDb());
    const entity = await engine.getEntity(rel);
    if (entity === undefined) {
      return Response.json({ error: `实体 "${rel}" 不存在` }, { status: 404 });
    }
    return Response.json(entity);
  } catch (error) {
    // db 层故障(pg 连接类错误 code ECONNREFUSED/ETIMEDOUT 等)→ 503;
    // 增量 fold 的日志完整性错误如实 500 带原始信息,不伪装成基础设施故障
    //(与 /api/exec 同口径;产品指南:如实,不粉饰)。
    const err = error as { code?: string; message?: string };
    const dbFailure =
      typeof err.code === 'string' && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|28P01|3D000/.test(err.code);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      dbFailure ? { error: 'entity 数据库不可用' } : { error: `entity 读取失败: ${message}` },
      { status: dbFailure ? 503 : 500 },
    );
  }
}
