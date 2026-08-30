import { getDb, getEngine, isMetaRel } from '../../../../engine/service';
import { executeDraftMeta, isDraftMetaRel } from '../../../../engine/drafts/drafts';
import { agentDefinitionDraftRegistryPort } from '../../../../engine/agent/agent-definitions';
import {
  applyTrustedIdentity,
  authenticationErrorResponse,
  requireHumanApprovalScope,
  resolveTrustedRequestIdentity,
} from '../../../../auth/request-identity';
import { assertReachable } from '../../../../auth/application-scope';
import { declaredOrFirstGrantedApplication } from '../../../../engine/situation';

import { parseExecBody, rejectionStatus } from '../../exec-request';

// POST /_meta/api/exec — meta 平面裁决端点(T4 Phase B,spec 决定 6):
// - 编辑动词(add-node/add-action/submit/revise/deprecate)与 approve/reject 过
//   同一引擎(executeMeta:同一三层裁决/lifecycle 自举)、同一事件日志、同一
//   串行队列(与业务 exec 单 atom);
// - 通过 → 200 {entity: 定义实体/激活实体的新投影};拒绝 → 422/400
//   {layer, reason, detail?}(与 action-rejected 留痕同源,I6);
// - 跨站规则:非 meta rel → 404(业务动作须经 /api/exec);
// - 请求形状非法 → 400;db 不可达 → 503。

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
  if (!isMetaRel(parsed.request.rel)) {
    return Response.json(
      { error: '非 meta/ rel 须经业务站 /api/exec(跨站规则:_meta 只服务定义平面)' },
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
      requiredScopes: ['ui4a:write'],
      untrusted: parsed.request,
      authorizedPolicyScopes,
    });
    if (['approve', 'reject'].includes(parsed.request.action)) {
      requireHumanApprovalScope(identity);
    }
    // D51:授权按授予集合 × meta 归属判定;effectiveScope 只作 Draft 目标默认槽位。
    if (identity.authorizationMode === 'credential') {
      assertReachable(
        { snapshot, sitemap, plane: 'meta' },
        parsed.request.rel,
        identity.grantedApplications,
      );
    }
    const effectiveScope =
      declaredOrFirstGrantedApplication(identity, authorizedPolicyScopes) ??
      authorizedPolicyScopes[0]!;
    const metaRequest = applyTrustedIdentity(parsed.request, identity);
    const outcome = isDraftMetaRel(parsed.request.rel)
      ? await executeDraftMeta(db, engine, metaRequest, {
          policyScope: effectiveScope,
          agentDefinitions: agentDefinitionDraftRegistryPort,
        })
      : await engine.exec(metaRequest);
    if (outcome.kind === 'accepted') {
      return Response.json({ entity: outcome.entity });
    }
    if (outcome.kind === 'suspended') {
      // 理论不可达:lifecycle 动作无 requires-confirmation 声明;保持与业务端点
      // 同构的 202 语义以防未来声明(挂起即等待确认实体裁决)。
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
    const conflict = /conflict|stale|version changed/.test(message);
    const tooLarge = /payload rejected|byte limit|count limit/.test(message);
    return Response.json(
      dbFailure
        ? { error: 'meta exec 数据库不可用' }
        : { error: `meta exec 引擎内部错误: ${message}` },
      { status: dbFailure ? 503 : conflict ? 409 : tooLarge ? 413 : 500 },
    );
  }
}
