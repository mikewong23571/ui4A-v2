/**
 * application-lifecycle deprecate 裁决分支(T52 Phase 3;D71.2/D71.6)。
 *
 * executeMeta 对 rel 前缀 meta/application:<name> 的派发落点:三层裁决与效果
 * 已由 executeWithGates 完成(flows 注入 APPLICATION_LIFECYCLE 常量伪流),
 * 本模块在 verdict 通过后补停用语义——追加 application-deprecated 伴随事件
 * (detail = name/reason?/commandId,形状见 projection/fold/log-event)并对
 * 在线快照施加与 fold 级联(applyApplicationDeprecated)同口径的事实级联:
 * applications 删该键 + app === name 的定义条目置废。
 *
 * deprecatedApplications 审计表是 **fold 侧专属物化**:审计条目携带事件 seq
 * (日志层分配),纯引擎无从得知——在线路径不预物化,fold 是唯一物化点,
 * 防止双写漂移(在线/重放逐表一致口径见 application-lifecycle 测试)。
 * default 地板不在本模块:guard(application-not-default)在裁决层拒绝(I6),
 * 这里没有也不允许特判分支。
 */
import type { EngineSnapshot } from '@ui4a/shared';

import type { EngineEvent } from '../../execution/effects';
import type { ExecRequest } from '../../execution/judge';
import type { ApplicationDeprecatedDetail } from '../../projection/fold/log-event';
import type { MetaOutcome } from '../meta';

/**
 * deprecate 治理命令标识:确定性铸造(exec 路径无调用方命令 id——那是 Draft
 * 命令回执的机制;停用经状态机单次成功,第二次即 stale,稳定 mint 即可唯一
 * 标识这次成功的治理命令;fold 只校验在场不消费)。
 */
export function applicationDeprecateCommandId(applicationName: string): string {
  return `application-deprecate:${applicationName}`;
}

/**
 * meta/application:<name> 的 deprecate 伴随事件(rel/action/actor 等请求字段
 * 的取法镜像 meta.ts definitionEvent 的惯例)。
 */
function applicationDeprecatedEvent(
  request: ExecRequest,
  detail: ApplicationDeprecatedDetail,
): EngineEvent {
  return {
    kind: 'application-deprecated',
    rel: request.rel,
    action: request.action,
    actor: request.actor ?? 'human',
    principal: request.principal,
    channel: request.channel,
    ...(request.identity !== undefined ? { identity: request.identity } : {}),
    detail,
  };
}

/**
 * 在线事实级联(fold 的 applyApplicationDeprecated 同口径,审计表除外):
 * ① applications 删除该 name 键(表不在场则不物化——与 applications
 * 「仅在场时携带」同口径);② definitions 中 app === name(缺省归一化为
 * 'default')的条目置 status:'deprecated'(仅状态,版本/全文保留)。
 */
function cascadeApplicationDeprecation(
  snapshot: EngineSnapshot,
  applicationName: string,
): EngineSnapshot {
  const applications =
    snapshot.applications !== undefined ? { ...snapshot.applications } : undefined;
  if (applications !== undefined) delete applications[applicationName];
  const definitions = { ...(snapshot.definitions ?? {}) };
  for (const [flowName, entry] of Object.entries(definitions)) {
    if ((entry.definition.app ?? 'default') === applicationName) {
      definitions[flowName] = { ...entry, status: 'deprecated' };
    }
  }
  return {
    ...snapshot,
    ...(applications !== undefined ? { applications } : {}),
    definitions,
  };
}

/**
 * 裁决通过后的停用落态:原子产出事件对的后半(action-executed 已由
 * executeWithGates 产出)+ 在线事实级联。reason 可选:空串视同未提供。
 */
export function deprecateApplication(
  verdict: Extract<MetaOutcome, { kind: 'executed' }>,
  request: ExecRequest,
  applicationName: string,
): Extract<MetaOutcome, { kind: 'executed' }> {
  const reason = request.params?.reason;
  const detail: ApplicationDeprecatedDetail = {
    name: applicationName,
    commandId: applicationDeprecateCommandId(applicationName),
    ...(typeof reason === 'string' && reason !== '' ? { reason } : {}),
  };
  return {
    kind: 'executed',
    snapshot: cascadeApplicationDeprecation(verdict.snapshot, applicationName),
    events: [...verdict.events, applicationDeprecatedEvent(request, detail)],
  };
}
