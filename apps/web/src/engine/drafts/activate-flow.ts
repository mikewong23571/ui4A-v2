/**
 * flow-definition Draft 激活(T17 起的行为,自 execute.ts 按功能边界拆出;零行为变化)。
 *
 * flow 级事务锁内重读核心日志:目标版本未变、候选仍通过声明校验、归属仍在
 * policy scope 内,才产 definition-candidate-applied 单事件计划(统一数组合同),
 * 由 acceptDraftWithCoreEvent 与 draft-accepted 原子落库。
 */
import {
  contentVersion,
  fold,
  mechanicalFlowDiff,
  validateDefinition,
  validateFlowDraft,
  type DefinitionCandidateAppliedDetail,
  type ExecRequest,
} from '@ui4a/engine';
import { readLog, type DbExecutor } from '@ui4a/db/events';
import type { AtomicCoreMutationPlan } from '@ui4a/db/drafts';
import type { DraftAggregate } from '@ui4a/shared';

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
