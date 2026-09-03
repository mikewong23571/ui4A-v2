/**
 * flow-definition Draft 激活(T17 起的行为,自 execute.ts 按功能边界拆出;
 * T48 Phase 4 / D67.3 增 genesis 分支)。
 *
 * flow 级事务锁内重读核心日志后分两路:
 * - 修订(baseVersion 在场):目标版本未变、候选仍通过声明校验、归属仍在
 *   policy scope 内,才产 definition-candidate-applied 单事件计划;
 * - genesis(baseVersion 缺席,D67.3):target 仍不存在(同名双写者竞态判
 *   stale)、候选重验有效、名等于 target、归属仍在该 Draft 的 policy scope,
 *   才产与启动 bootstrap 同种的 definition-seeded 出生事件(flowSeedEvent
 *   同一构造器;人类决策审计由同事务的 draft-accepted 承载)。
 *
 * 两路均由 acceptDraftWithCoreEvent 与 draft-accepted 原子落库(统一数组合同)。
 */
import {
  contentVersion,
  flowSeedEvent,
  fold,
  mechanicalFlowDiff,
  validateDefinition,
  validateFlowDraft,
  type DefinitionCandidateAppliedDetail,
  type ExecRequest,
} from '@ui4a/engine';
import { readLog, type DbExecutor } from '@ui4a/db/events';
import type { AtomicCoreMutationPlan } from '@ui4a/db/drafts';
import type { DefinitionEntry, DraftAggregate, EngineSnapshot } from '@ui4a/shared';

import { registries } from './helpers';

/** Revalidated flow candidate application; runs inside the accept transaction and Draft locks. */
export async function planFlowDefinitionActivation(input: {
  client: DbExecutor;
  locked: DraftAggregate;
  payload: unknown;
  commandId: string;
  draftId: string;
  request: ExecRequest;
}): Promise<AtomicCoreMutationPlan> {
  const { client, locked, payload, commandId, draftId, request } = input;
  if (locked.target === undefined) throw new Error('Draft target is missing');
  const target = locked.target;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`flow:${target}`]);
  const core = fold(await readLog(client), { flows: {} });
  const entry = core.definitions?.[target];
  if (locked.baseVersion === undefined) {
    return planFlowGenesisActivation({ locked, payload, core, target, entry });
  }
  if (entry === undefined || String(entry.version) !== locked.baseVersion)
    throw new Error('draft stale: target version changed');
  const validation = validateFlowDraft(payload, registries(core));
  if (!validation.valid || validation.value === undefined)
    throw new Error('draft is no longer valid');
  if ((validation.value.app ?? 'default') !== locked.policyScope) {
    throw new Error('draft target moved outside policy scope');
  }
  const checks = validateDefinition(validation.value, registries(core));
  const active = core.definitionVersions?.[target]?.[entry.version] ?? entry.definition;
  const mechanical = mechanicalFlowDiff(active, validation.value);
  const detail: DefinitionCandidateAppliedDetail = {
    schemaVersion: 1,
    commandId,
    name: target,
    baseVersion: entry.version,
    version: entry.version + 1,
    activationId: `draft-${draftId}`,
    draftId,
    draftVersion: locked.activeVersion,
    payloadHash: locked.versions[locked.activeVersion]!.payloadHash,
    policyScope: locked.policyScope,
    artifact: contentVersion(validation.value),
    definition: validation.value,
    checks,
    diff: mechanical.diff,
    requestedBy: {
      actor: locked.versions[locked.activeVersion]!.provenance.actor,
      principal: locked.owner,
    },
    decidedBy: { actor: 'human', principal: request.principal },
  };
  return {
    events: [
      {
        domain: 'core',
        kind: 'definition-candidate-applied',
        rel: `meta/flow:${target}`,
        action: 'approve-draft',
        actor: 'human',
        principal: request.principal,
        channel: request.channel,
        detail,
      },
    ],
  };
}

/**
 * genesis 激活(D67.3):锁内重验(有效 / 名等于 target / 归属在 Draft 的
 * policy scope / target 仍不存在——竞态即 stale)后,复用 bootstrap 的
 * flowSeedEvent 产 definition-seeded 出生事件(v1/active,fold 建 definitions
 * 条目与 lifecycle 实例,sitemap 随快照生长)。
 */
function planFlowGenesisActivation(input: {
  locked: DraftAggregate;
  payload: unknown;
  core: EngineSnapshot;
  target: string;
  entry: DefinitionEntry | undefined;
}): AtomicCoreMutationPlan {
  const { locked, payload, core, target, entry } = input;
  // 双写者竞态:批准前 target 已被任何路径创建 → 与修订版本漂移同判 stale。
  if (entry !== undefined) {
    throw new Error(`draft stale: flow ${target} is created concurrently`);
  }
  const validation = validateFlowDraft(payload, registries(core));
  if (!validation.valid || validation.value === undefined)
    throw new Error('draft is no longer valid');
  if (validation.value.name !== target) throw new Error('draft target/name mismatch');
  if ((validation.value.app ?? 'default') !== locked.policyScope) {
    throw new Error('draft target moved outside policy scope');
  }
  return { events: [flowSeedEvent(validation.value)] };
}
