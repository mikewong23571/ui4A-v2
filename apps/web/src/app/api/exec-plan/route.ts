import { getDb, getEngine, isMetaRel } from '../../../engine/service';
import {
  applyTrustedIdentity,
  authenticationErrorResponse,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';
import { assertRelInPolicyScope } from '../../../auth/application-scope';

import { parsePlanBody } from '../exec-request';

// POST /api/exec-plan — 批量裁决端点(T6 / arch-brief §9.4:一次决策输出整段
// 计划,引擎单事务逐步模拟,每步完整三层裁决 + 确认门):
// - 请求 {steps: [{rel, action, params?…}…], actor?, principal?, channel?}
//   (计划级 actor/principal/channel 是各步默认值,步级声明优先);
// - 全过 → 200 {plan:'completed', results, entities};
// - 中拒 → 200 {plan:'rejected', results(截断分步报告), entities}
//   ——口径:请求被完整处理,拒绝是步级数据而非 HTTP 错误(分步报告在 body,
//   与日志 action-rejected/plan-executed 事件同源);append-only:前序已生效;
// - 中挂 → 202 {plan:'suspended', results, entities, confirmation 摘录}
//   ——挂起步产出 confirmation:<id>,剩余步不执行(计划依赖前序);随后经
//   /api/exec 的人类裁决(approve/reject)决定挂起步,计划不自动续跑;
// - meta/ rel 步 → 404(跨站规则:进入定义层必须显式意图,与 /api/exec 一致);
// - confirmation: rel 步 → 引擎 undeclared 拒(审批不委托:plan 是 agent 侧
//   批量,人类裁决入口只走单步 /api/exec);
// - 空 steps / 步骤形状非法 → 400(engine 侧空计划口径为平凡完成,合同层拒绝);
// - db 不可达 → 503。
// 计划整个一次入服务层串行队列(单事务):一次决策 = 一条 plan-executed 记录
// + 各步伴随事件,日志连续无缺口。

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const parsed = parsePlanBody(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.steps.some((step) => isMetaRel(step.rel))) {
    return Response.json(
      { error: 'meta/ rel 须经 /_meta/api/exec(跨站规则:进入定义层必须显式意图)' },
      { status: 404 },
    );
  }

  try {
    const engine = await getEngine(getDb());
    const identity = await resolveTrustedRequestIdentity(request, {
      plane: 'business',
      requiredScopes: ['ui4a:write'],
      untrusted: parsed.steps[0],
      authorizedPolicyScopes: Object.keys(engine.getSnapshot().applications ?? {}),
      defaultPolicyScope: 'development',
    });
    if (identity.authorizationMode === 'credential') {
      for (const step of parsed.steps) {
        assertRelInPolicyScope({
          snapshot: engine.getSnapshot(),
          sitemap: engine.getSitemap(),
          rel: step.rel,
          policyScope: identity.policyScope,
          plane: 'business',
        });
      }
    }
    const outcome = await engine.execPlan(
      parsed.steps.map((step) => applyTrustedIdentity(step, identity)),
    );
    if (outcome.kind === 'plan-suspended') {
      // 202 Accepted:计划被受理但挂起(非拒绝)——等待人类裁决,剩余步不续跑。
      return Response.json(
        {
          plan: 'suspended',
          results: outcome.results,
          entities: outcome.entities,
          confirmation: {
            rel: `confirmation:${outcome.confirmation.id}`,
            ...outcome.confirmation,
          },
        },
        { status: 202 },
      );
    }
    return Response.json({
      plan: outcome.kind === 'plan-completed' ? 'completed' : 'rejected',
      results: outcome.results,
      entities: outcome.entities,
    });
  } catch (error) {
    const authentication = authenticationErrorResponse(error);
    if (authentication !== undefined) return authentication;
    // db 层故障 → 503;引擎内部不变式破坏如实 500(与 /api/exec 同口径)。
    const err = error as { code?: string; message?: string };
    const dbFailure =
      typeof err.code === 'string' &&
      /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|28P01|3D000/.test(err.code);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      dbFailure
        ? { error: 'exec-plan 数据库不可用' }
        : { error: `exec-plan 引擎内部错误: ${message}` },
      { status: dbFailure ? 503 : 500 },
    );
  }
}
