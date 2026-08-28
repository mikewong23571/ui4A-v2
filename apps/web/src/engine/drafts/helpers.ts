import {
  validateAgentDefinitionDraft,
  validateFlowDraft,
  type ExecRequest,
  type JudgeLayer,
  type SirenEntity,
} from '@ui4a/engine';
import { seedGuardRegistry, type DraftValidation } from '@ui4a/shared';

import { getDraftByOwner } from '@ui4a/db/drafts';
import { appendEvent, type DbExecutor } from '@ui4a/db/events';
import type { EngineRuntime } from '../service';
import { codingExecutorProfileRegistryFromEnvironment } from '../agent/coding-executor-config';

import {
  projectExactDraft,
  type AgentDefinitionDraftRegistryPort,
  type DraftMetaOutcome,
} from './views';
export function rejected(layer: JudgeLayer, reason: string, detail?: unknown): DraftMetaOutcome {
  return detail === undefined
    ? { kind: 'rejected', layer, reason }
    : { kind: 'rejected', layer, reason, detail };
}

export function stringParam(request: ExecRequest, name: string): string | undefined {
  const value = request.params?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function registries(snapshot: ReturnType<EngineRuntime['getSnapshot']>) {
  return {
    guards: seedGuardRegistry,
    applications: new Set(Object.keys(snapshot.applications ?? {})),
    capabilities: new Set(Object.keys(snapshot.capabilities ?? {})),
    capabilityDefinitions: snapshot.capabilities ?? {},
    executorProfiles: codingExecutorProfileRegistryFromEnvironment(),
  };
}

export function persistedValidation(
  validation:
    ReturnType<typeof validateFlowDraft> | ReturnType<typeof validateAgentDefinitionDraft>,
): DraftValidation {
  return {
    valid: validation.valid,
    issues: validation.issues,
    ...(validation.validatedAgainst === undefined
      ? {}
      : { validatedAgainst: validation.validatedAgainst }),
  };
}

export async function rejectionEvent(
  db: DbExecutor,
  request: ExecRequest,
  outcome: DraftMetaOutcome,
) {
  if (outcome.kind !== 'rejected') return;
  await appendEvent(db, {
    kind: 'action-rejected',
    rel: request.rel,
    action: request.action,
    actor: request.actor,
    principal: request.principal,
    channel: request.channel,
    reason: outcome.reason,
    detail: { layer: outcome.layer, judge: outcome.detail, domain: 'draft' },
  });
}

export async function concurrentDecisionRejection(
  db: DbExecutor,
  request: ExecRequest,
  error: unknown,
): Promise<DraftMetaOutcome | undefined> {
  const message = error instanceof Error ? error.message : String(error);
  if (!/draft is (?:not pending|terminal)|draft version conflict/.test(message)) return undefined;
  const outcome = rejected('guard-failed', `draft decision conflict: ${message}`);
  await rejectionEvent(db, request, outcome);
  return outcome;
}

export async function projectForOwner(
  db: DbExecutor,
  engine: EngineRuntime,
  draftId: string,
  owner: string,
  agentDefinitions?: AgentDefinitionDraftRegistryPort,
): Promise<SirenEntity> {
  const found = await getDraftByOwner(db, draftId, owner);
  if (found === undefined) throw new Error('draft disappeared after command');
  return projectExactDraft(db, engine, found.aggregate, found.payload, agentDefinitions);
}

/** Server adapter for declared Draft/activation Siren actions. */
