/**
 * agent-definition Draft 激活(T17 起的行为,自 execute.ts 按功能边界拆出;零行为变化)。
 *
 * 锁内经 registry port 重读快照:active ref 未变、候选/制品/checks 齐备、eval
 * evidence payload 在场,然后把原子激活(事件数组 + 投影钩子)整体交给
 * acceptDraftWithCoreEvent。定义即提案:激活永远是人类的决定。
 */
import {
  mechanicalAgentDefinitionDiff,
  resolveRegisteredAgentDefinition,
  type ExecRequest,
} from '@ui4a/engine';
import type { AtomicCoreMutationPlan } from '@ui4a/db/drafts';
import type { DbExecutor } from '@ui4a/db/events';
import type { DraftAggregate, JsonValue } from '@ui4a/shared';

import { type AgentDefinitionDraftRegistryPort, validateAgentCandidate } from './views';

/** Revalidated agent-definition activation; runs inside the accept transaction and Draft locks. */
export async function planAgentDefinitionActivation(input: {
  client: DbExecutor;
  locked: DraftAggregate;
  payload: unknown;
  commandId: string;
  draftId: string;
  request: ExecRequest;
  agentDefinitions: AgentDefinitionDraftRegistryPort;
}): Promise<AtomicCoreMutationPlan> {
  const { locked, payload, commandId, draftId, request, agentDefinitions } = input;
  if (locked.target === undefined) throw new Error('Draft target is missing');
  const registry = await agentDefinitions.readSnapshot({
    db: input.client,
    owner: locked.owner,
    policyScope: locked.policyScope,
  });
  const currentRef = registry.activeByName.get(locked.target);
  if (currentRef !== locked.baseVersion) {
    throw new Error(
      `draft stale: base ${locked.baseVersion ?? '(none)'}, current ${currentRef ?? '(none)'}`,
    );
  }
  const validation = validateAgentCandidate(payload, locked.target, registry);
  if (
    !validation.valid ||
    validation.value === undefined ||
    validation.artifact === undefined ||
    validation.checks === undefined
  ) {
    throw new Error('draft is no longer valid');
  }
  const beforeEntry = currentRef === undefined ? undefined : registry.definitions.get(currentRef);
  const beforeArtifact =
    currentRef === undefined
      ? undefined
      : resolveRegisteredAgentDefinition(currentRef, registry.definitions);
  const mechanical = mechanicalAgentDefinitionDiff({
    ...(beforeEntry === undefined ? {} : { beforeSource: beforeEntry.source }),
    afterSource: validation.value,
    ...(beforeArtifact === undefined ? {} : { beforeEffective: beforeArtifact.definition }),
    afterEffective: validation.artifact.definition,
  });
  const evalRefs = validation.artifact.definition.evaluationPolicy.evalSuiteRefs;
  const evalPayloads: Record<string, JsonValue> = {};
  for (const ref of evalRefs) {
    const evidence = registry.evalEvidencePayloads.get(ref);
    if (evidence === undefined) {
      throw new Error(`draft is no longer valid: eval evidence ${ref} payload is missing`);
    }
    evalPayloads[ref] = evidence;
  }
  return agentDefinitions.prepareAtomicActivation({
    client: input.client,
    commandId,
    draftId,
    draftVersion: locked.activeVersion,
    owner: locked.owner,
    policyScope: locked.policyScope,
    ...(currentRef === undefined ? {} : { expectedBaseRef: currentRef }),
    payloadHash: locked.versions[locked.activeVersion]!.payloadHash,
    schemaRef: locked.versions[locked.activeVersion]!.schemaRef,
    source: validation.value,
    artifact: validation.artifact,
    evalEvidence: { refs: evalRefs, payloads: evalPayloads },
    checks: validation.checks,
    diff: mechanical,
    requestedBy: {
      actor: locked.versions[locked.activeVersion]!.provenance.actor,
      principal: locked.owner,
    },
    decidedBy: { actor: 'human', principal: request.principal! },
  });
}
