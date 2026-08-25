/**
 * 定义事件族重放(T4:与在线 executeMeta 路径同构)。
 * 载荷即真相:不重新求值不变式,重放确定性以日志为准;
 * 转移由前置 action-executed 重放,此处核对 + 条目/activation 同步。
 */
import { metaActivationRel, metaFlowRel } from '@ui4a/shared';
import type {
  DefinitionEntry,
  DefinitionStatus,
  EngineSnapshot,
  InstanceSnapshot,
} from '@ui4a/shared';

import type {
  DefinitionActivatedDetail,
  DefinitionDeprecatedDetail,
  DefinitionRejectedDetail,
  DefinitionRevisedDetail,
  DefinitionSeededDetail,
  DefinitionSubmittedDetail,
} from '../../definition/meta';
import type { LogEvent } from './log-event';

/** definition-seeded 重放:建立 definitions 条目 + lifecycle 实例(幂等:已存在跳过)。
 *  同时沉淀版本历史(v1 全文),并对先于定义入日志的既有实例回溯盖出生版本戳
 *  (旧库迁移口径:迁移时在途实例视为出生于迁移落定的活跃版本)。 */
export function applyDefinitionSeeded(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionSeededDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.name !== 'string' ||
    typeof detail.version !== 'number' ||
    typeof detail.status !== 'string' ||
    detail.definition === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-seeded 缺少 detail 载荷(日志完整性)`);
  }
  const definitions = { ...(snapshot.definitions ?? {}) };
  if (definitions[detail.name] !== undefined) {
    return snapshot; // 幂等:重复 seed 不覆盖(boot 重放安全)。
  }
  const status = detail.status as DefinitionStatus;
  const entry: DefinitionEntry = {
    name: detail.name,
    version: detail.version,
    status,
    definition: detail.definition,
  };
  definitions[detail.name] = entry;
  const instances = { ...snapshot.instances };
  const rel = metaFlowRel(detail.name);
  if (instances[rel] === undefined) {
    instances[rel] = { rel, flow: 'definition-lifecycle', node: status, fields: {} };
  }
  // 迁移序回溯盖戳:该 flow 既有实例(定义入日志前出生)补 bornVersion。
  for (const [instanceRel, instance] of Object.entries(instances)) {
    if (instance.flow === detail.name && instance.bornVersion === undefined) {
      instances[instanceRel] = { ...instance, bornVersion: detail.version };
    }
  }
  return {
    ...snapshot,
    instances,
    definitions,
    definitionVersions: {
      ...(snapshot.definitionVersions ?? {}),
      [detail.name]: {
        ...(snapshot.definitionVersions?.[detail.name] ?? {}),
        [detail.version]: detail.definition,
      },
    },
  };
}

/** definitions 条目定位(定义事件重放的公共前置;缺条目 = 日志漂移)。 */
function definitionEntry(snapshot: EngineSnapshot, event: LogEvent, name: string): DefinitionEntry {
  const entry = snapshot.definitions?.[name];
  if (entry === undefined) {
    throw new Error(`重放失败:seq=${event.seq} 定义 "${name}" 不在 definitions 表(日志与状态漂移)`);
  }
  return entry;
}

/** lifecycle 实例节点核对(转移已由前置 action-executed 重放;此处只核对)。 */
function lifecycleNodeOf(
  snapshot: EngineSnapshot,
  event: LogEvent,
  name: string,
): InstanceSnapshot {
  const instance = snapshot.instances[metaFlowRel(name)];
  if (instance === undefined) {
    throw new Error(`重放失败:seq=${event.seq} lifecycle 实例 "${metaFlowRel(name)}" 不存在(漂移)`);
  }
  return instance;
}

/** definition-revised 重放:条目 → draft,bornBy=当前版本(工作副本即当前定义)。 */
export function applyDefinitionRevised(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionRevisedDetail> | undefined;
  if (detail === undefined || typeof detail.name !== 'string') {
    throw new Error(`重放失败:seq=${event.seq} definition-revised 缺少 detail.name(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'draft') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-revised 时实例不在 draft(在 ${instance.node};日志完整性)`,
    );
  }
  return {
    ...snapshot,
    definitions: {
      ...snapshot.definitions,
      [detail.name]: { ...entry, status: 'draft', bornBy: entry.version },
    },
  };
}

/** definition-deprecated 重放:条目 → deprecated。 */
export function applyDefinitionDeprecated(
  snapshot: EngineSnapshot,
  event: LogEvent,
): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionDeprecatedDetail> | undefined;
  if (detail === undefined || typeof detail.name !== 'string') {
    throw new Error(`重放失败:seq=${event.seq} definition-deprecated 缺少 detail.name(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'deprecated') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-deprecated 时实例不在 deprecated(在 ${instance.node};日志完整性)`,
    );
  }
  return {
    ...snapshot,
    definitions: { ...snapshot.definitions, [detail.name]: { ...entry, status: 'deprecated' } },
  };
}

/**
 * definition-submitted 重放(载荷即真相:不重新求值不变式——在线路径的
 * 求值输入已随 definition-seeded/edited 链重放,注册表随时间可变,重放
 * 确定性以日志为准,与 confirmation-requested 同口径)。
 * passed → pending-approval + activation 物化;fail → 回 draft。
 * 前置 action-executed(submit)已把实例迁到 validating,此处核对。
 */
export function applyDefinitionSubmitted(
  snapshot: EngineSnapshot,
  event: LogEvent,
): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionSubmittedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail.name !== 'string' ||
    typeof detail.passed !== 'boolean' ||
    !Array.isArray(detail.checks)
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-submitted 缺少 detail 载荷(日志完整性)`);
  }
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'validating') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-submitted 时实例不在 validating(在 ${instance.node};日志完整性)`,
    );
  }
  const entry = definitionEntry(snapshot, event, detail.name);

  if (detail.passed) {
    const payload = detail.activation;
    if (
      payload === undefined ||
      typeof payload.id !== 'string' ||
      typeof payload.version !== 'number' ||
      typeof payload.artifact !== 'string' ||
      payload.definition === undefined ||
      payload.requestedBy === undefined
    ) {
      throw new Error(
        `重放失败:seq=${event.seq} definition-submitted(passed)缺少 activation 载荷(日志完整性)`,
      );
    }
    const rel = metaActivationRel(payload.id);
    if (snapshot.activations?.[rel] !== undefined) {
      throw new Error(`重放失败:seq=${event.seq} 激活 "${rel}" 重复物化(日志完整性)`);
    }
    // 机械 diff 从载荷还原(载荷即真相,不重算);older 日志(diff 字段引入前)
    // 可缺省——投影按缺 diff 处理,不破坏旧日志重放。
    if (
      payload.diff !== undefined &&
      (typeof payload.diff !== 'object' ||
        payload.diff === null ||
        (payload.diff as { algorithm?: unknown }).algorithm !== 'deep-object-diff')
    ) {
      throw new Error(`重放失败:seq=${event.seq} activation.diff 载荷形状非法(日志完整性)`);
    }
    const activation = {
      id: payload.id,
      flow: detail.name,
      status: 'pending-approval' as const,
      version: payload.version,
      artifact: payload.artifact,
      checks: detail.checks,
      definition: payload.definition,
      requestedBy: payload.requestedBy,
      ...(payload.diff !== undefined ? { diff: payload.diff } : {}),
    };
    return {
      ...snapshot,
      instances: {
        ...snapshot.instances,
        [metaFlowRel(detail.name)]: { ...instance, node: 'pending-approval' },
      },
      definitions: {
        ...snapshot.definitions,
        [detail.name]: { ...entry, status: 'pending-approval' },
      },
      activations: { ...(snapshot.activations ?? {}), [rel]: activation },
    };
  }

  return {
    ...snapshot,
    instances: {
      ...snapshot.instances,
      [metaFlowRel(detail.name)]: { ...instance, node: 'draft' },
    },
    definitions: { ...snapshot.definitions, [detail.name]: { ...entry, status: 'draft' } },
  };
}

/**
 * definition-activated 重放:approve 落态——条目 {status: active,
 * version(激活落实的新版本), definition(草稿全文)};activation → approved
 * (decidedBy 留痕)。前置 action-executed(approve)已迁实例到 active,此处核对。
 */
export function applyDefinitionActivated(
  snapshot: EngineSnapshot,
  event: LogEvent,
): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionActivatedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail.name !== 'string' ||
    typeof detail.version !== 'number' ||
    typeof detail.activationId !== 'string' ||
    detail.definition === undefined ||
    detail.decidedBy === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-activated 缺少 detail 载荷(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'active') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-activated 时实例不在 active(在 ${instance.node};日志完整性)`,
    );
  }
  const activationRel = metaActivationRel(detail.activationId);
  const activation = snapshot.activations?.[activationRel];
  if (activation === undefined) {
    throw new Error(`重放失败:seq=${event.seq} 激活 "${activationRel}" 不存在(日志与状态漂移)`);
  }
  if (activation.status !== 'pending-approval') {
    throw new Error(
      `重放失败:seq=${event.seq} 激活 "${activationRel}" 已是 ${activation.status}(重复裁决)`,
    );
  }
  return {
    ...snapshot,
    definitions: {
      ...snapshot.definitions,
      [detail.name]: {
        ...entry,
        status: 'active',
        version: detail.version,
        definition: detail.definition,
      },
    },
    // 版本历史沉淀(与在线 decide() 同构):旧版本保留,仅活跃指针移动。
    definitionVersions: {
      ...(snapshot.definitionVersions ?? {}),
      [detail.name]: {
        ...(snapshot.definitionVersions?.[detail.name] ?? {}),
        [detail.version]: detail.definition,
      },
    },
    activations: {
      ...(snapshot.activations ?? {}),
      [activationRel]: { ...activation, status: 'approved' as const, approvedBy: detail.decidedBy },
    },
  };
}

/** definition-rejected 重放:条目 → rejected;activation → rejected(reason 留痕)。 */
export function applyDefinitionRejected(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<DefinitionRejectedDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail.name !== 'string' ||
    typeof detail.activationId !== 'string' ||
    detail.decidedBy === undefined ||
    typeof detail.reason !== 'string'
  ) {
    throw new Error(`重放失败:seq=${event.seq} definition-rejected 缺少 detail 载荷(日志完整性)`);
  }
  const entry = definitionEntry(snapshot, event, detail.name);
  const instance = lifecycleNodeOf(snapshot, event, detail.name);
  if (instance.node !== 'rejected') {
    throw new Error(
      `重放失败:seq=${event.seq} definition-rejected 时实例不在 rejected(在 ${instance.node};日志完整性)`,
    );
  }
  const activationRel = metaActivationRel(detail.activationId);
  const activation = snapshot.activations?.[activationRel];
  if (activation === undefined || activation.status !== 'pending-approval') {
    throw new Error(`重放失败:seq=${event.seq} 激活 "${activationRel}" 不存在或已决策(日志完整性)`);
  }
  return {
    ...snapshot,
    definitions: { ...snapshot.definitions, [detail.name]: { ...entry, status: 'rejected' } },
    activations: {
      ...(snapshot.activations ?? {}),
      [activationRel]: {
        ...activation,
        status: 'rejected' as const,
        rejectedReason: detail.reason,
      },
    },
  };
}
