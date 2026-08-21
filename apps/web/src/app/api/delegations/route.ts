import { DELEGATIONS_REL } from '@ui4a/engine';

import { toDelegationRow } from '../../../delegations/projection';
import { getDb, getEngine } from '../../../engine/service';

import { apiErrorResponse } from '../http';

// GET /api/delegations — 委托舰队列表(T5 Phase B / spec 架构决定 5)。
// 数据源:事件日志(engine 的 delegations fold 增量投影——单写者、可重放;
// worker 写入免重启可见)。Temporal 只用于 dispatch,读路径零 Temporal 依赖。
// 响应 {delegations: DelegationRow[]}(时间无关摘要:goal/status/步数/成功数,
// 不含时间戳);空舰队是合法状态(空数组,非 404)。

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const engine = await getEngine(getDb());
    const entity = await engine.getEntity(DELEGATIONS_REL);
    if (entity === undefined || entity.entities === undefined) {
      return Response.json({ error: 'delegations 集合不可投影(引擎漂移)' }, { status: 500 });
    }
    return Response.json({ delegations: entity.entities.map(toDelegationRow) });
  } catch (error) {
    return apiErrorResponse(error, 'delegations');
  }
}
