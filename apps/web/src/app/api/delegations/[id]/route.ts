import { delegationRel } from '@ui4a/engine';

import { loadDelegationEvents, projectDelegationDetail } from '../../../../delegations/projection';
import { getDb, getEngine } from '../../../../engine/service';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../../../../auth/request-identity';

import { apiErrorResponse } from '../../http';

// GET /api/delegations/[id] — 委托详情(T5 Phase B / spec 架构决定 5)。
// 状态/计数取 engine fold 快照(日志完整性由折叠层强制);逐步轨迹读该委托的
// 事件流(rel=delegation:<id>,事件历史即轨迹);messages 与 inline 聊天的
// trailToMessages 逐条等值(projection 复用同一 stepToMessage)。
// 404 口径:未知委托,或派发后首事件尚未落库(statusUrl 轮询的短暂窗口)。
// production profile(T22 验证修复):接入 application credential(Browser Session
// 或 Bearer,ui4a:read);详情为全局只读投影,不做 per-principal 过滤;
// local profile 行为不变。

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (id === '') {
    return Response.json({ error: '缺少委托 id' }, { status: 400 });
  }
  try {
    const engine = await getEngine(getDb());
    if (requestIdentityProfile() === 'production') {
      await resolveTrustedRequestIdentity(request, {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
      });
    }
    const entity = await engine.getEntity(delegationRel(id));
    if (entity === undefined) {
      return Response.json({ error: `委托 "${id}" 不存在(或首事件尚未落库)` }, { status: 404 });
    }
    const events = await loadDelegationEvents(getDb(), id);
    return Response.json(projectDelegationDetail(entity, events));
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    return apiErrorResponse(error, 'delegation 详情');
  }
}
