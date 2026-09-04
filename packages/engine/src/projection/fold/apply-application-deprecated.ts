/**
 * application-deprecated 重放(T52/D71.1):受治理应用停用的 fold 级联。
 *
 * 三步级联(确定性,载荷即真相):
 * ① applications 删除该 name 键(停用即出局;键缺失时删除为幂等 no-op,
 *    且不物化空表——与 applications「仅在场时携带」同口径,D71.5 烧毁集
 *    以 deprecated(log) 为独立真相源,不依赖装载序);
 * ② deprecatedApplications 审计集留痕(name + 可选 reason + 事件 seq;
 *    纯层无时钟,序号用 seq——见 state.ts);
 * ③ definitions 中 app === name 的条目(归一化口径:app 缺省 → 'default',
 *    与 invariants 的 app-known 同口径)级联置 status:'deprecated'——仅条目
 *    状态,版本/定义全文保留;lifecycle 实例节点不动(app 停用无逐 flow
 *    迁移,复活路径由 Phase 2 烧毁集守卫封堵,D71.8)。
 *
 * app-known 不变式因此保持成立:级联置废的条目不再是活跃定义,不进入
 * 激活求值;新候选引用停用 app 由 app-known fail-closed。
 * 幂等:同一事件(或同名重复停用)重复 fold 防御性幂等,审计首写为准
 * (与 applyApplicationSeeded 同风格)。
 */
import type { ApplicationDeprecatedDetail, LogEvent } from './log-event';
import type { DeprecatedApplicationAudit, FoldSnapshot } from './state';

export function applyApplicationDeprecated(snapshot: FoldSnapshot, event: LogEvent): FoldSnapshot {
  const detail = event.detail as Partial<ApplicationDeprecatedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.name !== 'string' ||
    detail.name === '' ||
    typeof detail.commandId !== 'string' ||
    detail.commandId === ''
  ) {
    throw new Error(
      `重放失败:seq=${event.seq} application-deprecated 缺少 detail 载荷(name/commandId;日志完整性)`,
    );
  }
  if (detail.reason !== undefined && typeof detail.reason !== 'string') {
    throw new Error(
      `重放失败:seq=${event.seq} application-deprecated detail.reason 必须为字符串(日志完整性)`,
    );
  }
  if (snapshot.deprecatedApplications?.[detail.name] !== undefined) {
    return snapshot; // 幂等:重复停用不覆盖(审计首写为准;boot/增量重放安全)。
  }
  const audit: DeprecatedApplicationAudit = {
    name: detail.name,
    ...(detail.reason !== undefined ? { reason: detail.reason } : {}),
    seq: event.seq,
  };
  const definitions = { ...(snapshot.definitions ?? {}) };
  for (const [flowName, entry] of Object.entries(definitions)) {
    if ((entry.definition.app ?? 'default') === detail.name) {
      definitions[flowName] = { ...entry, status: 'deprecated' };
    }
  }
  // 不可变删键:键缺失时删除为幂等 no-op;表缺省不物化空表
  // (与 applications「仅在场时携带」同口径)。
  const applications =
    snapshot.applications !== undefined ? { ...snapshot.applications } : undefined;
  if (applications !== undefined) delete applications[detail.name];
  return {
    ...snapshot,
    ...(applications !== undefined ? { applications } : {}),
    deprecatedApplications: { ...(snapshot.deprecatedApplications ?? {}), [detail.name]: audit },
    definitions,
  };
}
