import { DELEGATIONS_REL } from '@ui4a/engine';

import { toDelegationRow } from '../../../delegations/projection';
import { getDb, getEngine } from '../../../engine/service';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';

import { apiErrorResponse } from '../http';

// GET /api/delegations — 委托舰队列表(T5 Phase B / spec 架构决定 5)。
// 数据源:事件日志(engine 的 delegations fold 增量投影——单写者、可重放;
// worker 写入免重启可见)。Temporal 只用于 dispatch,读路径零 Temporal 依赖。
// 响应 {delegations: DelegationRow[]}(时间无关摘要:goal/status/步数/成功数,
// 不含时间戳);空舰队是合法状态(空数组,非 404)。
// production profile(T22 验证修复):接入 application credential(Browser Session
// 或 Bearer,ui4a:read);舰队为全局只读投影,不做 per-principal 过滤;
// local profile 行为不变。

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const engine = await getEngine(getDb());
    if (requestIdentityProfile() === 'production') {
      await resolveTrustedRequestIdentity(request, {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
      });
    }
    const entity = await engine.getEntity(DELEGATIONS_REL);
    if (entity === undefined || entity.entities === undefined) {
      return Response.json({ error: 'delegations 集合不可投影(引擎漂移)' }, { status: 500 });
    }
    return Response.json({ delegations: entity.entities.map(toDelegationRow) });
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    return apiErrorResponse(error, 'delegations');
  }
}
