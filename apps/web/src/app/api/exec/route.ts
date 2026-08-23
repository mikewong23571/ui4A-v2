import {
  getDb,
  getEngine,
  isMetaRel,
  LlmArtifactConfigurationError,
} from '../../../engine/service';
import { executeCapabilityRunAction, isCapabilityRunRel } from '../../../engine/capability-runs';

import { parseExecBody, rejectionStatus } from '../exec-request';

// POST /api/exec — 引擎裁决端点(spec FR4;T3 Phase B 起含确认门):
// - 请求 {rel, action, params?, actor?, principal?, channel?}(actor 缺省 human);
// - 通过 → 200 {entity: 受影响实体的新投影}(append 时为新实例);
// - 挂起(确认门:策略判定需人类确认;rel 亦可为 confirmation:<id> 之外的
//   任何业务实体)→ 202 {status:'suspended', confirmation:{rel, …摘录}}
//   ——动作未生效,等待 confirmation:<id> 上的 approve/reject(也是普通 exec);
// - 拒绝 → undeclared 400 / guard-failed|schema-invalid 422,body {layer, reason, detail?}
//   ——与日志 action-rejected 事件同源(同一 verdict 对象,service 落库 detail.layer);
// - meta/ rel → 404(跨站规则:T4 起 meta rel 须经 /_meta/api/exec,进入定义层
//   必须显式意图);
// - 请求形状非法 → 400;db 不可达 → 503。
// exec 经服务层串行队列(单 atom);params 出处 HTTP 层不区分,一律记 intent。

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const parsed = parseExecBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  if (isMetaRel(parsed.request.rel)) {
    return Response.json(
      { error: 'meta/ rel 须经 /_meta/api/exec(跨站规则:进入定义层必须显式意图)' },
      { status: 404 },
    );
  }

  try {
    const db = getDb();
    const resolvedRequest = {
      ...parsed.request,
      principal:
        parsed.request.principal ?? request.headers.get('x-ui4a-principal') ?? 'local-user',
    };
    if (isCapabilityRunRel(resolvedRequest.rel)) {
      const outcome = await executeCapabilityRunAction(
        db,
        resolvedRequest,
        request.headers.get('x-ui4a-policy-scope') ?? 'development',
      );
      return outcome.kind === 'accepted'
        ? Response.json({ entity: outcome.entity })
        : Response.json({ layer: 'guard-failed', reason: outcome.reason }, { status: 422 });
    }
    const engine = await getEngine(db);
    const outcome = await engine.exec(resolvedRequest);
    if (outcome.kind === 'accepted') {
      return Response.json({ entity: outcome.entity });
    }
    if (outcome.kind === 'suspended') {
      // 202 Accepted:动作已被受理但挂起(非拒绝)——等待人类在确认实体上裁决。
      return Response.json(
        {
          status: 'suspended',
          confirmation: {
            rel: `confirmation:${outcome.confirmation.id}`,
            ...outcome.confirmation,
          },
        },
        { status: 202 },
      );
    }
    const response: Record<string, unknown> = { layer: outcome.layer, reason: outcome.reason };
    if (outcome.detail !== undefined) {
      response.detail = outcome.detail;
    }
    return Response.json(response, { status: rejectionStatus(outcome.layer) });
  } catch (error) {
    if (error instanceof LlmArtifactConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    // db 层故障(pg 连接类错误 code 为 ECONNREFUSED/ETIMEDOUT 等,AggregateError
    // 的 message 为空,必须按 code 分类)→ 503;引擎内部不变式破坏如实 500 带原始
    // 信息,不伪装成基础设施故障(产品指南:如实,不粉饰)。
    const err = error as { code?: string; message?: string };
    const dbFailure =
      typeof err.code === 'string' &&
      /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|28P01|3D000/.test(err.code);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      dbFailure ? { error: 'exec 数据库不可用' } : { error: `exec 引擎内部错误: ${message}` },
      { status: dbFailure ? 503 : 500 },
    );
  }
}
